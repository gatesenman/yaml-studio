import { useFieldEdit } from '../lib/fieldEdit'
import { buildCompactRows } from '../lib/compactRows'
import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '../store'
import { pathKey } from '../lib/locate'
import { editorViewRef } from '../lib/editorView'
import { type Path, type ValueKind } from '../lib/yaml'

/** Must match the editor line-height enforced in App.css (.cm-line). */
const LINE_PX = 20



/** Inline value editor used inside a single aligned row. */
function CompactValue({
  path,
  value,
  kind,
}: {
  path: Path
  value: unknown
  kind: ValueKind
}) {
  const setValueAt = useStore((s) => s.setValueAt)
  const edit=useFieldEdit(path)

  if (kind === 'boolean') {
    return (
      <label className="c-switch">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => setValueAt(path, e.target.checked)}
        />
        <span>{value ? 'true' : 'false'}</span>
      </label>
    )
  }
  if (kind === 'null') {
    return <span className="c-null">~</span>
  }
  return (
    <input
      className="c-value"
      data-document-field="true"
      onFocus={edit.begin}
      onBlur={edit.end}
      type="text"
      inputMode={kind === 'number' ? 'decimal' : undefined}
      value={value == null ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value
        if (kind === 'number') {
          const n = Number(raw)
          if (raw.trim() !== '' && !Number.isNaN(n)) edit.write(n)
        } else {
          edit.write(raw)
        }
      }}
    />
  )
}

function CompactKey({ mapPath, name }: { mapPath: Path; name: string }) {
  const renameObjectKey = useStore((s) => s.renameObjectKey)
  return (
    <input
      className="c-key"
      defaultValue={name}
      key={name}
      onBlur={(e) => {
        const next = e.target.value.trim()
        if (next && next !== name) renameObjectKey(mapPath, name, next)
        else e.target.value = name
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function FormCompactMode() {
  const source = useStore((s) => s.source)
  const activeSegment = useStore((s) => s.activeSegment)
  const docOffset = useStore((s) => s.docOffset)
  const parsed = useStore((s) => s.parsed)
  const error = useStore((s) => s.error)
  const activePath = useStore((s) => s.activePath)
  const activeOrigin = useStore((s) => s.activeOrigin)
  const setActivePath = useStore((s) => s.setActivePath)

  // Scan within the active document (local line numbers); render against the
  // full source so other documents show as read-only context lines.
  const fullLines = useMemo(() => error ? [] : source.split('\n'), [source,error])
  const lineShift = docOffset.startLine - 1
  const scrollRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  const rowByLine=useMemo(()=>error ? new Map() : buildCompactRows(activeSegment,parsed),[error,activeSegment,parsed])

  // Editor selection -> scroll active row into view.
  useEffect(() => {
    if (activeOrigin !== 'editor' || !activePath) return
    const el = scrollRef.current?.querySelector('.c-row.c-active')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activePath, activeOrigin])

  // Two-way scroll sync with the source editor.
  useEffect(() => {
    const sc = scrollRef.current
    const view = editorViewRef.current
    if (!sc || !view) return
    const cm = view.scrollDOM

    const onCm = () => {
      if (syncing.current) return
      syncing.current = true
      sc.scrollTop = cm.scrollTop
      requestAnimationFrame(() => (syncing.current = false))
    }
    cm.addEventListener('scroll', onCm)
    return () => cm.removeEventListener('scroll', onCm)
  }, [])

  const onCompactScroll = () => {
    const sc = scrollRef.current
    const view = editorViewRef.current
    if (!sc || !view || syncing.current) return
    syncing.current = true
    view.scrollDOM.scrollTop = sc.scrollTop
    requestAnimationFrame(() => (syncing.current = false))
  }

  const rows: React.ReactNode[] = []
  const fullCount = fullLines.length
  for (let ln = 1; ln <= fullCount; ln++) {
    const localLn = ln - lineShift
    const row = localLn >= 1 ? rowByLine.get(localLn) : undefined
    if (!row) {
      const raw = fullLines[ln - 1] ?? ''
      rows.push(
        <div className="c-row c-raw" key={ln} style={{ height: LINE_PX }}>
          <span className="c-gutter">{ln}</span>
          <span className="c-rawtext">{raw === '' ? '\u00a0' : raw}</span>
        </div>,
      )
      continue
    }
    const active = pathKey(activePath) === pathKey(row.path)
    const pad = row.indent * 8
    rows.push(
      <div
        className={active ? 'c-row c-edit c-active' : 'c-row c-edit'}
        key={ln}
        style={{ height: LINE_PX }}
        onMouseEnter={() => setActivePath(row.path, 'form')}
        onFocusCapture={() => setActivePath(row.path, 'form')}
      >
        <span className="c-gutter">{ln}</span>
        <span className="c-fields" style={{ paddingLeft: pad }}>
          {row.seqMark && <span className="c-dash">-</span>}
          {(row.kind === 'pair-head' || row.kind === 'pair-scalar') && (
            <>
              <CompactKey mapPath={row.mapPath} name={row.key} />
              <span className="c-colon">:</span>
            </>
          )}
          {row.kind === 'pair-scalar' && (
            <CompactValue path={row.path} value={row.value} kind={row.valueKind} />
          )}
          {row.kind === 'item-scalar' && (
            <CompactValue path={row.path} value={row.value} kind={row.valueKind} />
          )}
        </span>
      </div>,
    )
  }

  return (
    <div className="pane form-pane compact-pane">
      <div className="pane-header">
        <span className="pane-icon pane-icon-form" aria-hidden>≣</span>
        <span className="pane-title">紧凑对齐</span>
        <span className="pane-hint">逻辑行对齐（长行横向滚动）；共享行请用源码/卡片</span>
      </div>
      {error && (
        <div className="form-error">
          已暂停紧凑编辑：{error.message}。完整源码未修改。
        </div>
      )}
      <div className="compact-scroll" ref={scrollRef} onScroll={onCompactScroll}>
        {rows}
      </div>
    </div>
  )
}
