import { sourceLimitReason } from './limits'
import {
  parseDocument,
  parseAllDocuments,
  visit as visitYaml,
  isMap,
  isNode,
  isSeq,
  isScalar,
  Document,
  Scalar,
  YAMLMap,
  YAMLSeq,
} from 'yaml'

export type Path = (string | number)[]

export interface YamlError {
  message: string
  line?: number
  col?: number
  pos?: [number, number]
}

export type ValueKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'

/** Detect the editor "kind" of a JS value produced by doc.toJSON(). */
export function kindOf(value: unknown): ValueKind {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

/** Default empty value for a given kind, used when (re)typing a field. */
export function defaultForKind(kind: ValueKind): unknown {
  switch (kind) {
    case 'string':
      return ''
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object':
      return {}
    case 'null':
    default:
      return null
  }
}

export interface ConvertKindResult {
  value: unknown
  preserved: boolean
  message?: string
}

function parseConvertibleNumber(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  const integerLike = !/[.eE]/.test(text)
  if (integerLike && !Number.isSafeInteger(n)) return null
  return n
}

function lostValueMessage(kind: ValueKind, fallback: string): string {
  const labels: Record<ValueKind, string> = {
    string: '文本',
    number: '数字',
    boolean: '开关',
    null: '空值',
    object: '分组',
    array: '列表',
  }
  return `当前值无法安全转为${labels[kind]}，已${fallback}。可撤销。`
}

/** Convert a value to another field kind, keeping a representable value when safe. */
export function convertValueToKind(value: unknown, kind: ValueKind): ConvertKindResult {
  const from = kindOf(value)
  if (from === kind) return { value, preserved: true }

  if (kind === 'string') {
    if (from === 'number' && typeof value === 'number' && Number.isFinite(value)) return { value: String(value), preserved: true }
    if (from === 'boolean') return { value: value ? 'true' : 'false', preserved: true }
    if (from === 'null') return { value: '', preserved: true }
    return { value: '', preserved: false, message: lostValueMessage('string', '清空') }
  }

  if (kind === 'number') {
    if (from === 'string' && typeof value === 'string') {
      const parsed = parseConvertibleNumber(value)
      if (parsed !== null) return { value: parsed, preserved: true }
      if (value.trim() === '') return { value: 0, preserved: true }
      return { value: 0, preserved: false, message: lostValueMessage('number', '设为 0') }
    }
    return { value: 0, preserved: false, message: lostValueMessage('number', '设为 0') }
  }

  if (kind === 'boolean') {
    if (from === 'string' && typeof value === 'string') {
      const text = value.trim().toLowerCase()
      if (text === 'true') return { value: true, preserved: true }
      if (text === 'false') return { value: false, preserved: true }
    }
    if (from === 'number' && (value === 0 || value === 1)) return { value: Boolean(value), preserved: true }
    return { value: false, preserved: false, message: lostValueMessage('boolean', '设为关') }
  }

  if (kind === 'null') {
    return { value: null, preserved: value == null, message: value == null ? undefined : '已将当前值设为空值。可撤销。' }
  }

  if (kind === 'object') {
    return { value: {}, preserved: false, message: lostValueMessage('object', '创建空分组') }
  }

  return { value: [], preserved: false, message: lostValueMessage('array', '创建空列表') }
}

function docFrom(src: string): Document {
  return parseDocument(src, { keepSourceTokens: false })
}

/** Parse YAML text into a plain JS value plus the first error (if any). */
export function parse(src: string): { value: unknown; error: YamlError | null } {
  const limit = sourceLimitReason(src)
  if(limit)return {value:null,error:{message:limit}}
  let doc: Document
  try {doc=docFrom(src)} catch(e) {return {value:null,error:{message:`解析器安全退出：${String(e)}`}}}
  let error: YamlError | null = null
  if (doc.errors.length > 0) {
    const e = doc.errors[0]
    error = {
      message: e.message,
      line: e.linePos?.[0]?.line,
      col: e.linePos?.[0]?.col,
      pos: e.pos as [number, number],
    }
  }
  const resolved = resolveDocument(doc)
  return { value: resolved.value, error: (error || resolved.error) ? sourcePosition((error || resolved.error)!,src) : null }
}

/** Unknown positions stay unknown; a parser-provided EOF caret is still valid. */
export function diagnosticRange(error: YamlError, source: string): [number,number] | null {
 const pos=error.pos
 return pos && Number.isInteger(pos[0]) && Number.isInteger(pos[1]) && pos[0]>=0 && pos[1]>=pos[0] && pos[1]<=source.length ? pos : null
}
function sourcePosition(error: YamlError, source: string): YamlError {
 // YAML may represent a missing EOF token with an end one character past input.
 if(error.pos && Number.isInteger(error.pos[0]) && Number.isInteger(error.pos[1]) && error.pos[0]>=0 && error.pos[0]<=source.length && error.pos[1]>=error.pos[0])error={...error,pos:[error.pos[0],Math.min(error.pos[1],source.length)]}
 const pos=diagnosticRange(error,source)
 if(!pos)return {message:error.message}
 const prefix=source.slice(0,pos[0])
 return {...error,pos,line:prefix.split('\n').length,col:pos[0]-prefix.lastIndexOf('\n')}
}
class SemanticIssue extends Error {
 pos?: [number,number]
 constructor(message:string,range?: readonly number[] | null){super(message);if(range)this.pos=[range[0],range[1]]}
}
/** Shared semantic checks: parse errors alone do not detect unresolved aliases. */
function resolveDocument(doc: Document): { value: unknown; error: YamlError | null } {
  let error: YamlError | null = null
  let value: unknown = null
  try {
    if (doc.warnings.some(w => w.code === 'TAG_RESOLVE_FAILED')) throw new SemanticIssue('包含未识别的 YAML 标签；为避免语义丢失，请仅在源码中编辑。',doc.warnings.find(w=>w.code==='TAG_RESOLVE_FAILED')?.pos)
    visitYaml(doc, {
      Alias(_key,node){if(!node.resolve(doc))throw new SemanticIssue(`Unresolved alias: ${node.source}（未定义别名）`,node.range)},
      Map(_key, node) { for (const pair of node.items) if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new SemanticIssue('非文本或复合映射键仅支持源码编辑，禁止有损表单转换。',isNode(pair.key)?pair.key.range:undefined) },
      Scalar(_key, node) { if (typeof node.value === 'number' && (!Number.isFinite(node.value) || (Number.isInteger(node.value) && !Number.isSafeInteger(node.value)))) throw new SemanticIssue('非有限数字或超出安全整数范围，仅支持源码保留。',node.range) },
    })
    value = doc.toJS({ maxAliasCount: 100 })
    const ancestors = new Set<unknown>()
    let count = 0
    const visit = (v: unknown, depth: number) => {
      if (++count > 20000 || depth > 60) throw new Error('文档过于复杂（最多 20000 节点、60 层）')
      if (v && typeof v === 'object') {
        if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error('集合、二进制等复杂 YAML 类型仅支持源码编辑。')
        if (ancestors.has(v)) throw new Error('循环 YAML 别名不能以表单展示，请在源码中编辑')
        ancestors.add(v); for (const child of Object.values(v)) visit(child, depth + 1); ancestors.delete(v)
      }
    }
    visit(value, 0)
  } catch (e) {
    error = error || { message: e instanceof Error ? e.message : String(e), ...(e instanceof SemanticIssue && e.pos ? {pos:e.pos} : {}) }
    value = null
  }
  return { value, error }
}

/** Collect every error and warning with position info (for the test panel). */
export function diagnostics(src: string): YamlError[] {
  const limit=sourceLimitReason(src)
  if(limit)return [{message:limit}]
  let docs: ReturnType<typeof parseAllDocuments>
  try { docs=parseAllDocuments(src) } catch(e) { return [{message:`解析器安全退出：${String(e)}`}] }
  return docs.flatMap((doc) => {
    const found: YamlError[] = [...doc.errors, ...doc.warnings.filter(w=>doc.errors.length>0 || w.code!=='TAG_RESOLVE_FAILED')].map((e) => ({
      message: e.message, line: e.linePos?.[0]?.line, col: e.linePos?.[0]?.col, pos: e.pos as [number, number],
    }))
    if (doc.errors.length === 0) {
      const semanticError = resolveDocument(doc).error
      if (semanticError) {
        found.push(sourcePosition(semanticError,src))
      }
    }
    return found.map(error=>sourcePosition(error,src))
  })
}

/** Pretty-print / normalise the document while keeping comments. */
export function format(src: string): string {
  if (parse(src).error) return src
  const doc = docFrom(src)
  if (doc.errors.length > 0) return src
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/** Set (or create) the value at `path`, preserving comments elsewhere. */
export function setAtPath(src: string, path: Path, value: unknown): string {
  const doc = docFrom(src)
  if (path.length === 0) {
    doc.contents = doc.createNode(value)
  } else {
    doc.setIn(path, value)
  }
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/** Delete the value at `path` (a map key or a seq index). */
export function deleteAtPath(src: string, path: Path): string {
  const doc = docFrom(src)
  doc.deleteIn(path)
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/** Append `value` to the sequence located at `path`. */
export function addItem(src: string, path: Path, value: unknown): string {
  const doc = docFrom(src)
  const node = path.length === 0 ? doc.contents : doc.getIn(path, true)
  if (isSeq(node)) {
    ;(node as YAMLSeq).add(doc.createNode(value))
  } else if (path.length === 0) {
    doc.contents = doc.createNode([value])
  } else {
    doc.setIn(path, [value])
  }
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/** Move the item at `index` within the sequence at `path` by `delta` slots. */
export function moveItem(src: string, path: Path, index: number, delta: number): string {
  const doc = docFrom(src)
  const node = path.length === 0 ? doc.contents : doc.getIn(path, true)
  if (!isSeq(node)) return src
  const seq = node as YAMLSeq
  const target = index + delta
  if (index < 0 || index >= seq.items.length) return src
  if (target < 0 || target >= seq.items.length) return src
  const [item] = seq.items.splice(index, 1)
  seq.items.splice(target, 0, item)
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/**
 * Reorder a child within its parent container (map or sequence) at
 * `parentPath`, moving the entry at `from` to index `to`. Works for both
 * array items and object fields, preserving comments and formatting.
 */
export function reorderChildren(
  src: string,
  parentPath: Path,
  from: number,
  to: number,
): string {
  if (from === to) return src
  const doc = docFrom(src)
  const node = parentPath.length === 0 ? doc.contents : doc.getIn(parentPath, true)
  let items: unknown[] | null = null
  if (isSeq(node)) items = (node as YAMLSeq).items
  else if (isMap(node)) items = (node as YAMLMap).items
  if (!items) return src
  if (from < 0 || from >= items.length) return src
  if (to < 0 || to >= items.length) return src
  const [moved] = items.splice(from, 1)
  items.splice(to, 0, moved)
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/**
 * Move several children (at indices `from`) within their parent container to
 * land contiguously starting before the original item at index `to`. Keeps
 * the relative order of the moved items. Works for both maps and sequences.
 */
export function reorderManyChildren(
  src: string,
  parentPath: Path,
  from: number[],
  to: number,
): string {
  if (from.length === 0) return src
  const doc = docFrom(src)
  const node = parentPath.length === 0 ? doc.contents : doc.getIn(parentPath, true)
  let items: unknown[] | null = null
  if (isSeq(node)) items = (node as YAMLSeq).items
  else if (isMap(node)) items = (node as YAMLMap).items
  if (!items) return src
  const len = items.length
  const fromSet = [...new Set(from)].filter((i) => i >= 0 && i < len).sort((a, b) => a - b)
  if (fromSet.length === 0) return src
  const anchor = items[Math.min(Math.max(to, 0), len - 1)]
  const moved = fromSet.map((i) => items![i])
  const movedSet = new Set(moved)
  const remaining = items.filter((it) => !movedSet.has(it))
  let insertAt = remaining.indexOf(anchor)
  if (insertAt < 0 || movedSet.has(anchor)) insertAt = remaining.length
  remaining.splice(insertAt, 0, ...moved)
  items.length = 0
  items.push(...remaining)
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/** Add a new key/value pair to the map located at `path`. */
export function addKey(src: string, path: Path, key: string, value: unknown): string {
  const doc = docFrom(src)
  const node = path.length === 0 ? doc.contents : doc.getIn(path, true)
  if (isMap(node)) {
    if ((node as YAMLMap).has(key)) return src
    ;(node as YAMLMap).set(key, doc.createNode(value))
  } else if (path.length === 0) {
    const m: Record<string, unknown> = {}
    m[key] = value
    doc.contents = doc.createNode(m)
  } else {
    const m: Record<string, unknown> = {}
    m[key] = value
    doc.setIn(path, m)
  }
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/**
 * Rename a key inside the map at `mapPath`, keeping its value, comments and
 * position in the map.
 */
export function renameKey(
  src: string,
  mapPath: Path,
  oldKey: string,
  newKey: string,
): string {
  if (oldKey === newKey) return src
  const doc = docFrom(src)
  const node = mapPath.length === 0 ? doc.contents : doc.getIn(mapPath, true)
  if (!isMap(node)) return src
  const map = node as YAMLMap
  if (map.has(newKey)) return src
  const item = map.items.find((i) => {
    const k = i.key
    return (isScalar(k) ? k.value : k) === oldKey
  })
  if (!item) return src
  if (isScalar(item.key)) {
    ;(item.key as Scalar).value = newKey
  } else {
    item.key = doc.createNode(newKey)
  }
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/** One atomic pass; optional raw text preserves string fields during UI batch replacement. */
export function setAtPaths(src: string, paths: Path[], value: unknown, stringReplacement?: string): string {
  if (paths.length === 0) return src
  const doc = docFrom(src)
  for (const path of paths) {
    const current = path.length ? doc.getIn(path) : isScalar(doc.contents) ? doc.contents.value : doc.contents
    const replacement = stringReplacement !== undefined && typeof current === 'string' ? stringReplacement : value
    if (path.length === 0) doc.contents = doc.createNode(replacement)
    else doc.setIn(path, replacement)
  }
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/**
 * Delete every path in `paths` in a single document pass. Paths are removed
 * deepest-and-last-first so earlier array indices stay valid while deleting.
 */
export function deleteAtPaths(src: string, paths: Path[]): string {
  if (paths.length === 0) return src
  const doc = docFrom(src)
  const ordered = [...paths].sort((a, b) => {
    const len = b.length - a.length
    if (len !== 0) return len
    const ai = a[a.length - 1]
    const bi = b[b.length - 1]
    if (typeof ai === 'number' && typeof bi === 'number') return bi - ai
    return 0
  })
  for (const path of ordered) {
    if (path.length > 0) doc.deleteIn(path)
  }
  return doc.toString({ indent: 2, lineWidth: 0 })
}

/** Read a value at a path from text (used by the test/assertion engine). */
export function getAtPath(src: string, path: Path): unknown {
  const { value, error } = parse(src)
  if (error) return undefined
  let current = value
  for (const key of path) {
    if (current == null || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

/** Parse a dotted / bracketed path string like `a.b[0].c` into a Path. */
export function parsePathString(input: string): Path {
  if (input === '$') return []
  if (input.startsWith('/')) return input.slice(1).split('/').map(p => p.replace(/~1/g,'/').replace(/~0/g,'~'))
  if (input.trim().startsWith('[')) {
    const path: unknown = JSON.parse(input)
    if (!Array.isArray(path) || !path.every(p => typeof p === 'string' || (typeof p === 'number' && Number.isInteger(p) && p >= 0))) throw new Error('路径数组只允许文本键或非负整数索引')
    return path as Path
  }
  const out: Path = []
  const tokens = input
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  for (const t of tokens) {
    if (/^\d+$/.test(t)) out.push(Number(t))
    else out.push(t)
  }
  return out
}
