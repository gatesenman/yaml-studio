import { useEffect, useMemo, useRef } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { linter } from '@codemirror/lint'
import { diagnostics, diagnosticRange } from '../lib/yaml'
import { StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { useStore } from '../store'
import { buildLocMap } from '../lib/locate'
import { pathKey } from '../lib/locate'
import { editorViewRef } from '../lib/editorView'

/** Effect carrying the 1-based line range to highlight (or null to clear). */
const setHighlight = StateEffect.define<{ start: number; end: number } | null>()

const activeLine = Decoration.line({ class: 'cm-link-active' })

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        if (!e.value) return Decoration.none
        const ranges = []
        for (let ln = e.value.start; ln <= e.value.end; ln++) {
          if (ln >= 1 && ln <= tr.state.doc.lines) {
            ranges.push(activeLine.range(tr.state.doc.line(ln).from))
          }
        }
        next = Decoration.set(ranges, true)
      }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** Effect carrying search hit ranges + the active hit index. */
const setSearchHits =
  StateEffect.define<{ hits: { from: number; to: number }[]; active: number } | null>()

const searchMark = Decoration.mark({ class: 'cm-search-hit' })
const searchMarkActive = Decoration.mark({ class: 'cm-search-hit cm-search-hit-active' })

const searchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setSearchHits)) {
        if (!e.value || e.value.hits.length === 0) return Decoration.none
        const len = tr.state.doc.length
        const ranges = e.value.hits
          .map((h, i) => ({ h, i }))
          .filter(({ h }) => h.from < h.to && h.to <= len)
          .map(({ h, i }) =>
            (i === e.value!.active ? searchMarkActive : searchMark).range(
              h.from,
              h.to,
            ),
          )
        next = Decoration.set(ranges, true)
      }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

export function YamlSourceEditor() {
  const source = useStore((s) => s.source)
  const sourceTarget=useStore(s=>s.sourceTarget)
  const setSource = useStore((s) => s.setSource)
  const error = useStore((s) => s.error)
  const activePath = useStore((s) => s.activePath)
  const activeOrigin = useStore((s) => s.activeOrigin)
  const setActivePath = useStore((s) => s.setActivePath)
  const activeSegment = useStore((s) => s.activeSegment)
  const docOffset = useStore((s) => s.docOffset)
  const searchHits = useStore((s) => s.searchHits)
  const activeHit = useStore((s) => s.activeHit)

  const ref = useRef<ReactCodeMirrorRef>(null)
  const ownedView=useRef<EditorView|null>(null)
  useEffect(()=>()=>{if(editorViewRef.current===ownedView.current)editorViewRef.current=null},[])
  // The locate map is built for the active document; line/char offsets shift
  // its results into full-source coordinates so highlighting lines up even
  // for documents after a `---` separator.
  const locMap = useMemo(() => buildLocMap(activeSegment), [activeSegment])
  const lineShift = docOffset.startLine - 1
  const charShift = docOffset.startOffset

  const extensions = useMemo(
    () => [yaml(), highlightField, searchField, EditorView.domEventHandlers({focus:()=>{useStore.getState().endFieldEdit();return false}}), linter(view => diagnostics(view.state.doc.toString()).filter(d=>diagnosticRange(d,view.state.doc.toString())).map(d => ({ from:d.pos![0], to:d.pos![1], severity: 'error' as const, message: d.message }))) ],
    [],
  )

  // Editor cursor -> form: map the caret offset back to a path.
  const onUpdate = (vu: ViewUpdate) => {
    if (!vu.selectionSet) return
    const userMoved = vu.transactions.some(
      (t) => t.isUserEvent('select') || t.isUserEvent('input'),
    )
    if (!userMoved) return
    const offset = vu.state.selection.main.head - charShift
    if (offset < 0) {
      setActivePath(null, 'editor')
      return
    }
    setActivePath(locMap.offsetToPath(offset), 'editor')
  }

  // Form (or compact pane) selection -> editor: highlight + scroll into view.
  useEffect(() => {
    const view = ref.current?.view
    if (!view) return
    const loc = activePath ? locMap.byPath.get(pathKey(activePath)) : undefined
    if (!loc) {
      view.dispatch({ effects: setHighlight.of(null) })
      return
    }
    const start = loc.startLine + lineShift
    const end = loc.endLine + lineShift
    const effects: StateEffect<unknown>[] = [
      setHighlight.of({ start, end }),
    ]
    if (activeOrigin !== 'editor') {
      const line = view.state.doc.line(Math.min(start, view.state.doc.lines))
      effects.push(EditorView.scrollIntoView(line.from, { y: 'center' }))
    }
    view.dispatch({ effects })
  }, [activePath, activeOrigin, locMap, lineShift])

  // Defer until App has revealed the source pane on narrow screens.
  useEffect(()=>{
    if(!sourceTarget || sourceTarget.source!==source)return
    const frame=requestAnimationFrame(()=>{
      const view=ref.current?.view
      if(!view || view.state.doc.toString()!==sourceTarget.source)return
      const {from,to}=sourceTarget
      view.dispatch({selection:{anchor:from,head:to},effects:[setHighlight.of({start:view.state.doc.lineAt(from).number,end:view.state.doc.lineAt(to).number}),EditorView.scrollIntoView(from,{y:'center'})]})
      view.focus()
    })
    return ()=>cancelAnimationFrame(frame)
  },[sourceTarget,source])

  // Search panel hits -> editor: paint yellow highlights and scroll to active.
  useEffect(() => {
    const view = ref.current?.view
    if (!view) return
    const effects: StateEffect<unknown>[] = [
      setSearchHits.of({ hits: searchHits, active: activeHit }),
    ]
    const cur = searchHits[activeHit]
    if (cur && cur.to <= view.state.doc.length) {
      effects.push(EditorView.scrollIntoView(cur.from, { y: 'center' }))
    }
    view.dispatch({ effects })
  }, [searchHits, activeHit])

  return (
    <div className="pane source-pane">
      <div className="pane-header">
        <span className="pane-icon pane-icon-code" aria-hidden>{'</>'}</span>
        <span className="pane-title">YAML 源码</span>
        {error ? (
          <span className="badge badge-error" title={error.message}>
            {error.line ? `第 ${error.line+docOffset.startLine-1} 行错误` : '解析/安全限制'}
          </span>
        ) : (
          <span className="badge badge-ok">语法正确</span>
        )}
      </div>
      <div className="editor-wrap">
        <CodeMirror
          ref={ref}
          value={source}
          height="100%"
          theme="dark"
          extensions={extensions}
          onChange={(val) => setSource(val)}
          onUpdate={onUpdate}
          onCreateEditor={(view) => {
            editorViewRef.current = view
            ownedView.current=view
          }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            // Undo/redo is handled globally by the store so source + form
            // edits share a single history stack.
            history: false,
          }}
        />
      </div>
    </div>
  )
}
