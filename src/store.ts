import { create } from 'zustand'
import {
  parse,
  diagnosticRange,
  setAtPath,
  deleteAtPath,
  setAtPaths,
  deleteAtPaths,
  addItem,
  moveItem,
  reorderChildren as reorderChildrenYaml,
  reorderManyChildren as reorderManyChildrenYaml,
  addKey,
  renameKey,
  format as formatYaml,
  diagnostics,
  type Path,
  type YamlError,
} from './lib/yaml'
import { pathKey, analyzeAnchors, type AnchorMeta } from './lib/locate'
import { splitDocuments, replaceSegment } from './lib/multidoc'
import { compileSchema, type JsonSchema } from './lib/schemaHints'

const SAMPLE = `# 欢迎使用 YAML Studio
# 左侧编辑源码，右侧编辑表单，双向实时联动
app:
  name: my-service
  version: 1.0.0
  enabled: true
  replicas: 3
  tags:
    - web
    - backend
  resources:
    cpu: "500m"
    memory: 256Mi
  env:
    LOG_LEVEL: info
    DEBUG: false
`

const DRAFT_KEY = 'yaml-studio.draft'
const SESSION_KEY = 'yaml-studio.session-v2'
const COLLAPSE_KEY = 'yaml-studio.collapsed'
const SCHEMA_KEY = 'yaml-studio.schema'
/** Max source snapshots kept in the undo stack. */
const HISTORY_LIMIT = 200
function trimHistory(items: string[]): string[] {
  let chars = 0, i = items.length
  while (i > 0 && items.length - i < HISTORY_LIMIT && chars + items[i - 1].length <= 4 * 1024 * 1024) chars += items[--i].length
  return items.slice(i)
}
/** Consecutive editor edits within this window collapse into one undo step. */
const COALESCE_MS = 400

function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

interface StoreState {
  applySource: (text: string, expected: string, documentId: number) => boolean
  baselineConfirmed: boolean
  documentId: number
  replaceActiveSegment: (text: string, expected: string, index: number, documentId: number) => boolean
  notice: string
  setNotice: (message: string) => void
  importFile: (name: string, content: string) => void
  fieldEditToken: number | null
  beginFieldEdit: (path: Path) => number
  endFieldEdit: (token?: number) => void
  setFieldValue: (path: Path, value: unknown, token: number) => boolean
  sourceTarget: {from:number;to:number;source:string;sequence:number} | null
  navigateToSource: (error: YamlError, expected: string) => boolean
  source: string
  fileName: string
  filePath: string | null
  dirty: boolean
  parsed: unknown
  error: YamlError | null
  /** Source text as it was last loaded / saved (baseline for diff preview). */
  savedSource: string

  /** Active document index within a multi-document (`---`) stream. */
  docIndex: number
  /** Number of documents in the current stream (1 for a normal file). */
  docCount: number
  /** Active document's own text (the slice the form edits). */
  activeSegment: string
  /** Active document's position within the full source. */
  docOffset: { startLine: number; startOffset: number }
  /** Anchor (`&`) / alias (`*`) positions in the active document. */
  anchorMeta: AnchorMeta
  streamIssueCount: number
  otherIssueCount: number

  /** Undo / redo stacks of full source snapshots. */
  past: string[]
  future: string[]

  /** Collapsed nodes by path key (persisted across sessions). */
  collapsed: Record<string, boolean>

  /** Multi-selected entries by path key (for batch drag / delete). */
  selected: string[]

  /** Custom JSON Schema text + compiled object for field hints/validation. */
  schemaText: string
  schemaObj: JsonSchema | null

  /** Source-text ranges matched by the search panel (full-source offsets). */
  searchHits: { from: number; to: number }[]
  /** Index of the currently focused search hit (-1 = none). */
  activeHit: number

  /** Path currently highlighted across both panes (pure UI, not persisted). */
  activePath: Path | null
  /** Which pane drove the current selection (so the other pane auto-scrolls). */
  activeOrigin: 'form' | 'editor' | null
  /** Whether the right pane uses the compact line-aligned layout (mode B). */
  alignMode: boolean

  setSource: (src: string) => void
  setFileName: (name: string) => void
  reset: (src?: string) => void
  formatSource: () => void

  /** Load content opened from disk (double-click / open dialog). */
  loadFile: (path: string, content: string) => void
  /** Mark current source as persisted to the given path. */
  markSaved: (path: string | null, snapshot?: string) => void

  undo: () => void
  redo: () => void

  toggleCollapsed: (key: string) => void
  setCollapsed: (key: string, value: boolean) => void

  toggleSelected: (key: string) => void
  clearSelected: () => void

  setSchemaText: (text: string) => void

  setSearch: (hits: { from: number; to: number }[], active: number) => void

  setActivePath: (path: Path | null, origin?: 'form' | 'editor') => void
  setAlignMode: (on: boolean) => void
  setDocIndex: (index: number) => void

  setValueAt: (path: Path, value: unknown) => void
  setValueAtMany: (paths: Path[], value: unknown, stringReplacement?: string) => void
  deleteMany: (paths: Path[]) => void
  deleteAt: (path: Path) => void
  addArrayItem: (path: Path, value: unknown) => void
  moveArrayItem: (path: Path, index: number, delta: number) => void
  addObjectKey: (path: Path, key: string, value: unknown) => void
  renameObjectKey: (mapPath: Path, oldKey: string, newKey: string) => void
  reorderChildren: (parentPath: Path, from: number, to: number) => void
  reorderManyChildren: (parentPath: Path, from: number[], to: number) => void
}

interface Derived {
  parsed: unknown
  error: YamlError | null
  docIndex: number
  docCount: number
  activeSegment: string
  docOffset: { startLine: number; startOffset: number }
  anchorMeta: AnchorMeta
  streamIssueCount: number
  otherIssueCount: number
}

/** Parse the active document out of a (possibly multi-document) stream. */
function derive(src: string, wantIndex: number): Derived {
  const segs = splitDocuments(src)
  const docCount = segs.length
  const docIndex = Math.min(Math.max(wantIndex, 0), docCount - 1)
  const seg = segs[docIndex]
  const { value, error } = parse(seg.text)
  let anchorMeta: AnchorMeta = { anchors: {}, aliases: {}, byName: {}, names: [] }
  try {
    anchorMeta = analyzeAnchors(seg.text)
  } catch {
    /* ignore */
  }
  const issues = diagnostics(src)
  const segStart = seg.startOffset
  const segEnd = docIndex + 1 < segs.length ? segs[docIndex + 1].startOffset : src.length
  const otherIssueCount = issues.filter((item) => {
    const at = item.pos?.[0]
    return typeof at === 'number' && (at < segStart || at >= segEnd)
  }).length
  const currentHasIssue = Boolean(error) || issues.some((item) => {
    const at = item.pos?.[0]
    return at === undefined || (at >= segStart && at < segEnd)
  })
  return {
    parsed: value,
    error,
    docIndex,
    docCount,
    activeSegment: seg.text,
    docOffset: { startLine: seg.startLine, startOffset: seg.startOffset },
    anchorMeta,
    streamIssueCount: issues.length || (currentHasIssue ? 1 : 0),
    otherIssueCount,
  }
}

function loadInitial(): string {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    if (session && typeof session.source === 'string') return session.source
  } catch { /* fall back to legacy draft */ }
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw != null) return raw
  } catch {
    /* ignore */
  }
  return SAMPLE
}

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    if (raw) { const value = JSON.parse(raw); if (value && typeof value === 'object' && !Array.isArray(value)) return value }
  } catch {
    /* ignore */
  }
  return {}
}

function loadSchemaText(): string {
  try {
    return localStorage.getItem(SCHEMA_KEY) ?? ''
  } catch {
    return ''
  }
}

function persist(src: string) {
  try {
    localStorage.setItem(DRAFT_KEY, src)
  } catch {
    /* ignore */
  }
}

const initialSource = loadInitial()
function restoredName(): string {
  try { const name = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}').fileName; return typeof name === 'string' ? name : 'untitled.yaml' }
  catch { return 'untitled.yaml' }
}

/** Tracks edit coalescing so rapid typing becomes a single undo step. */
let lastEditAt = 0
let lastWasType = false

export const useStore = create<StoreState>((set, get) => {
  let nextFieldToken=0
  let field: {token:number;key:string;documentId:number;docIndex:number;lastSource:string;snapshotted:boolean} | null=null
  const endFieldEdit=(token?:number)=>{
    if(token!==undefined && field?.token!==token)return
    lastWasType=false
    if(field){field=null;set({fieldEditToken:null})}
  }

  /**
   * Apply a structural mutation: snapshot the current source onto the undo
   * stack (each call is one discrete undo step), then commit the new source.
   */
  const commit = (newSrc: string, token?:number) => {
    const prev = get().source
    const grouped=token!==undefined && field?.token===token && field.lastSource===prev
    if(!grouped)endFieldEdit()
    if (newSrc === prev) return
    const snapshot=!grouped || !field!.snapshotted
    if(grouped){field!.snapshotted=true;field!.lastSource=newSrc}
    lastWasType = false
    persist(newSrc)
    set((s) => ({
      source: newSrc, sourceTarget:null,
      dirty: !s.baselineConfirmed || newSrc !== s.savedSource,
      past: snapshot ? trimHistory([...s.past, prev]) : s.past,
      future: [], selected: [],
      ...derive(newSrc, s.docIndex),
    }))
  }

  /** Run a single-document mutation against the active segment, then splice. */
  const segMutate = (fn: (segText: string) => string, token?:number): boolean => {
    if(token!==undefined && (!field || field.token!==token || field.documentId!==get().documentId || field.docIndex!==get().docIndex || field.lastSource!==get().source))return false
    if(token===undefined)endFieldEdit()
    const { source, docIndex } = get()
    const segs = splitDocuments(source)
    const seg = segs[docIndex] ?? segs[0]
    if (get().error) { get().setNotice('请先修复 YAML 语法错误，再编辑表单。'); return false }
    try {
      const newSeg = fn(seg.text)
      if (newSeg === seg.text) return true
      const candidate = parse(newSeg)
      if (candidate.error) { get().setNotice(`操作未应用：${candidate.error.message}`); return false }
      commit(replaceSegment(source, docIndex, newSeg),token)
      return true
    } catch (error) { get().setNotice(`操作失败：${String(error)}`);return false }
  }

  return {
    fieldEditToken:null,
    sourceTarget:null,
    endFieldEdit,
    beginFieldEdit:(path)=>{
      endFieldEdit()
      const state=get(),token=++nextFieldToken
      field={token,key:pathKey(path),documentId:state.documentId,docIndex:state.docIndex,lastSource:state.source,snapshotted:false}
      set({fieldEditToken:token});return token
    },
    setFieldValue:(path,value,token)=>{
      if(field?.token!==token || field.key!==pathKey(path))return false
      return segMutate(seg=>setAtPath(seg,path,value),token)
    },
    navigateToSource:(error,expected)=>{
      const state=get(),pos=diagnosticRange(error,expected)
      if(state.source!==expected || !pos)return false
      endFieldEdit()
      const segs=splitDocuments(expected)
      const index=Math.max(0,segs.findIndex((seg,i)=>pos[0]>=seg.startOffset && (i===segs.length-1 || pos[0]<segs[i+1].startOffset)))
      set({...derive(expected,index),activePath:null,sourceTarget:{from:pos[0],to:pos[1],source:expected,sequence:(state.sourceTarget?.sequence||0)+1}});return true
    },
    applySource: (text,expected,documentId) => {
      if(get().source!==expected || get().documentId!==documentId){get().setNotice('工作区已变化，未应用旧结果。');return false}
      commit(text);return true
    },
    baselineConfirmed: initialSource === SAMPLE,
    documentId: 1,
    replaceActiveSegment: (text, expected, index, documentId) => {
      const state = get()
      if (state.source !== expected || state.docIndex !== index || state.documentId !== documentId) {
        state.setNotice('文档或选中文档已变化，未应用旧操作结果。'); return false
      }
      if (splitDocuments(text).length !== 1 || parse(text).error) {
        state.setNotice('转换结果必须是有效的单个 YAML 文档。'); return false
      }
      commit(replaceSegment(state.source, index, text)); return true
    },
    notice: '', 
    setNotice: (notice) => set({ notice }),
    importFile: (name, content) => {
      get().reset(content)
      set({ fileName: basename(name), dirty: true, savedSource: content, baselineConfirmed: false })
    },
    source: initialSource,
    fileName: restoredName(),
    filePath: null,
    dirty: initialSource !== SAMPLE,
    savedSource: initialSource,
    past: [],
    future: [],
    collapsed: loadCollapsed(),
    selected: [],
    schemaText: loadSchemaText(),
    schemaObj: compileSchema(loadSchemaText()),
    searchHits: [],
    activeHit: -1,
    activePath: null,
    activeOrigin: null,
    alignMode: false,
    ...derive(initialSource, 0),

    setActivePath: (path, origin = 'form') => {
      if(origin==='editor' && get().fieldEditToken!==null)endFieldEdit()
      if (pathKey(path) === pathKey(get().activePath) && get().activeOrigin === origin) return
      set({ activePath: path, activeOrigin: origin })
    },

    setAlignMode: (on) => set({ alignMode: on }),

    setDocIndex: (index) => {
      endFieldEdit()
      set((s) => ({
        activePath: null,
        activeOrigin: null,
        selected: [], searchHits: [], activeHit: -1,
        ...derive(s.source, index),
      }))
    },

    // Editor typing: coalesce consecutive edits into one undo step.
    setSource: (src) => {
      const prev = get().source
      if (src === prev) return
      if(field)endFieldEdit()
      const now = Date.now()
      const shouldSnapshot = !lastWasType || now - lastEditAt > COALESCE_MS
      lastWasType = true
      lastEditAt = now
      persist(src)
      set((s) => ({
        source: src, sourceTarget:null,
        dirty: !s.baselineConfirmed || src !== s.savedSource,
        past: shouldSnapshot
          ? trimHistory([...s.past, prev])
          : s.past,
        future: [],
        ...derive(src, s.docIndex),
      }))
    },

    setFileName: (name) => {endFieldEdit();set({ fileName: basename(name), filePath: null, dirty: true })},

    reset: (src = '') => {
      endFieldEdit()
      lastWasType = false
      persist(src)
      set({
        baselineConfirmed: true,
        documentId: get().documentId + 1,
        source: src, sourceTarget:null,
        fileName: 'untitled.yaml',
        filePath: null,
        dirty: false,
        savedSource: src,
        past: [],
        future: [],
        activePath: null,
        activeOrigin: null,
        searchHits: [], activeHit: -1, selected: [],
        ...derive(src, 0),
      })
    },

    loadFile: (path, content) => {
      endFieldEdit()
      lastWasType = false
      persist(content)
      set({
        baselineConfirmed: true,
        documentId: get().documentId + 1,
        source: content, sourceTarget:null,
        fileName: basename(path),
        filePath: path,
        dirty: false,
        savedSource: content,
        past: [],
        future: [],
        activePath: null,
        activeOrigin: null,
        searchHits: [], activeHit: -1, selected: [],
        ...derive(content, 0),
      })
    },

    markSaved: (path, snapshot = get().source) => {
      endFieldEdit()
      set((s) => ({
        baselineConfirmed: true,
        filePath: path,
        fileName: path ? basename(path) : s.fileName,
        dirty: s.source !== snapshot,
        savedSource: snapshot,
      }))
    },

    undo: () => {
      endFieldEdit()
      const { past, future, source } = get()
      if (past.length === 0) return
      const prev = past[past.length - 1]
      lastWasType = false
      persist(prev)
      set((s) => ({
        source: prev, sourceTarget:null,
        dirty: !s.baselineConfirmed || prev !== s.savedSource,
        past: past.slice(0, -1),
        future: trimHistory([...future].reverse().concat(source)).reverse(),
        ...derive(prev, s.docIndex),
      }))
    },

    redo: () => {
      endFieldEdit()
      const { past, future, source } = get()
      if (future.length === 0) return
      const next = future[0]
      lastWasType = false
      persist(next)
      set((s) => ({
        source: next, sourceTarget:null,
        dirty: !s.baselineConfirmed || next !== s.savedSource,
        past: trimHistory([...past, source]),
        future: future.slice(1),
        ...derive(next, s.docIndex),
      }))
    },

    toggleCollapsed: (key) =>
      set((s) => {
        const next = { ...s.collapsed, [key]: !s.collapsed[key] }
        if (!next[key]) delete next[key]
        try {
          localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return { collapsed: next }
      }),

    setCollapsed: (key, value) =>
      set((s) => {
        const next = { ...s.collapsed }
        if (value) next[key] = true
        else delete next[key]
        try {
          localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return { collapsed: next }
      }),

    toggleSelected: (key) =>
      set((s) => ({
        selected: s.selected.includes(key)
          ? s.selected.filter((k) => k !== key)
          : [...s.selected, key],
      })),

    clearSelected: () => set({ selected: [] }),

    setSchemaText: (text) => {
      try {
        localStorage.setItem(SCHEMA_KEY, text)
      } catch {
        /* ignore */
      }
      set({ schemaText: text, schemaObj: compileSchema(text) })
    },

    setSearch: (hits, active) => set({ searchHits: hits, activeHit: active }),

    formatSource: () => segMutate((seg) => formatYaml(seg)),

    setValueAt: (path, value) => segMutate((seg) => setAtPath(seg, path, value)),

    setValueAtMany: (paths, value, stringReplacement) =>
      segMutate((seg) => setAtPaths(seg, paths, value, stringReplacement)),

    deleteMany: (paths) => segMutate((seg) => deleteAtPaths(seg, paths)),

    deleteAt: (path) => segMutate((seg) => deleteAtPath(seg, path)),

    addArrayItem: (path, value) => segMutate((seg) => addItem(seg, path, value)),

    moveArrayItem: (path, index, delta) =>
      segMutate((seg) => moveItem(seg, path, index, delta)),

    addObjectKey: (path, key, value) =>
      segMutate((seg) => addKey(seg, path, key, value)),

    renameObjectKey: (mapPath, oldKey, newKey) =>
      segMutate((seg) => renameKey(seg, mapPath, oldKey, newKey)),

    reorderChildren: (parentPath, from, to) =>
      segMutate((seg) => reorderChildrenYaml(seg, parentPath, from, to)),

    reorderManyChildren: (parentPath, from, to) =>
      segMutate((seg) => reorderManyChildrenYaml(seg, parentPath, from, to)),
  }
})

// A recovered session is deliberately detached from its old disk path: saving
// after a restart must go through Save As, never overwrite a stale file silently.
useStore.subscribe((state, prev) => {
  if (state.source === prev.source && state.fileName === prev.fileName) return
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ source: state.source, fileName: state.fileName }))
  } catch { if (state.notice !== '草稿保存失败：本地存储空间不足或不可用，请及时导出。')
    useStore.setState({ notice: '草稿保存失败：本地存储空间不足或不可用，请及时导出。' }) }
})
export { SAMPLE }
