import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { searchYaml, isAliasPath, type Match } from '../lib/search'
import { interpretScalarInput, type ValueKind } from '../lib/yaml'
import { notify } from '../lib/fileActions'
import { generateYaml, loadAiSettings } from '../lib/ai'

const KIND_LABELS: Record<ValueKind, string> = {
  string: '文本',
  number: '数字',
  boolean: '开关',
  null: '空值',
  object: '分组',
  array: '列表',
}


/** Inline editor for a single matched scalar value. */
function InlineValue({ match }: { match: Match }) {
  const setValueAt = useStore((s) => s.setValueAt)
  const [local, setLocal] = useState(
    match.value == null ? '' : String(match.value),
  )
  const focused = useRef(false)
  const aliases=useStore(s=>s.anchorMeta.aliases)

  useEffect(() => {
    if (!focused.current) setLocal(match.value == null ? '' : String(match.value))
  }, [match.value])

  if(isAliasPath(match.path,aliases))return <span className="sp-nested-note">引用值只读，请编辑锚点定义。</span>

  if (match.kind === 'boolean') {
    return (
      <label className="switch sp-switch">
        <input
          type="checkbox"
          aria-label={`${match.label} 的值`}
          checked={Boolean(match.value)}
          onChange={(e) => setValueAt(match.path, e.target.checked)}
        />
        <span className="switch-slider" />
      </label>
    )
  }

  if (match.kind === 'object' || match.kind === 'array') {
    return <span className="sp-nested-note">（容器，展开后在表单里编辑）</span>
  }

  return (
    <input
      className="field-input sp-value-input"
      aria-label={`${match.label} 的值`}
      value={local}
      placeholder={match.kind === 'null' ? '空值' : ''}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        if(match.kind==='string'){setValueAt(match.path,local);return}
        if(match.kind==='number'){
          const n=Number(local)
          if(!local.trim()||!Number.isFinite(n)||(Number.isInteger(n)&&!Number.isSafeInteger(n))){notify('请输入安全范围内的有效数字；原值已保留。');setLocal(String(match.value));return}
          setValueAt(match.path,n);return
        }
        const parsed = interpretScalarInput(local)
        if (parsed.numericUnsafe) {
          notify('该输入无法安全识别为数字，已按文本保留以免丢失精度。可撤销。')
          setValueAt(match.path, String(local))
          return
        }
        setValueAt(match.path, parsed.value)
      }}
      onChange={(e) => setLocal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function SearchPanel({
  open,
  onClose,
  onOpenSettings,
}: {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
}) {
  const parsed = useStore((s) => s.parsed)
  const aliases=useStore(s=>s.anchorMeta.aliases)
  const activeSegment = useStore((s) => s.activeSegment)
  const docOffset = useStore((s) => s.docOffset)
  const docCount = useStore((s) => s.docCount)
  const docIndex = useStore((s) => s.docIndex)
  const setValueAtMany = useStore((s) => s.setValueAtMany)
  const deleteMany = useStore((s) => s.deleteMany)

  const setSearch = useStore((s) => s.setSearch)

  const [query, setQuery] = useState('')
  const [inKeys, setInKeys] = useState(true)
  const [inValues, setInValues] = useState(true)
  const [useRegex, setUseRegex] = useState(false)
  const [hitIndex, setHitIndex] = useState(0)
  const [regexError, setRegexError] = useState('')
  const [batchValue, setBatchValue] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [deleteConfirm,setDeleteConfirm]=useState<{source:string;docIndex:number;documentId:number;paths:(string|number)[][]}|null>(null)
  const [aiResult,setAiResult] = useState('')
  const aiRequest = useRef<AbortController | null>(null)
  const aiBase = useRef({source:'',documentId:0})
  useEffect(() => { if(!open) { setDeleteConfirm(null); aiRequest.current?.abort(); aiRequest.current=null;setAiLoading(false);setAiResult('') } return () => {aiRequest.current?.abort();aiRequest.current=null} },[open])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const matches = useMemo(
    () =>
      open ? searchYaml(parsed, query, {
        keys: inKeys,
        values: inValues,
      }) : [],
    [open, parsed, query, inKeys, inValues],
  )

  // Untrusted regex runs off the UI thread with a hard termination deadline.
  const [regexHits, setRegexHits] = useState<{from:number;to:number}[] | {error:string}>([])
  useEffect(() => {
    if (!open || !useRegex || !query) { setRegexHits([]); return }
    if (typeof Worker === 'undefined') { setRegexHits({error:'当前环境不支持安全的正则工作线程，请使用普通查询。'}); return }
    const worker = new Worker(new URL('../lib/regex.worker.ts', import.meta.url), {type:'module'})
    setRegexHits([])
    const timer = setTimeout(() => { worker.terminate(); setRegexHits({error:'正则查询超过 250 毫秒，已安全终止。请简化表达式。'}) },250)
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); setRegexHits(event.data.error ? {error:event.data.error} : event.data.hits) }
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); setRegexHits({error:'正则查询工作线程失败。'}) }
    worker.postMessage({source:activeSegment,query})
    return () => { clearTimeout(timer); worker.terminate() }
  },[open,useRegex,query,activeSegment])

  const hits = Array.isArray(regexHits) ? regexHits : []

  // Push the current hits + active index into the store so the editor paints
  // and scrolls. Clear when the panel closes or regex mode is off.
  useEffect(() => {
    if (!open || !useRegex) {
      setSearch([], -1)
      return
    }
    setRegexError(Array.isArray(regexHits) ? '' : regexHits.error)
    const idx = hits.length ? Math.min(hitIndex, hits.length - 1) : -1
    const offset = docOffset.startOffset
    setSearch(hits.map((hit) => ({ from: hit.from + offset, to: hit.to + offset })), idx)
    // `hits` is derived from `regexHits`; `setSearch` is a stable store action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, useRegex, regexHits, hitIndex, docOffset.startOffset])

  useEffect(() => {
    setHitIndex(0)
  }, [query, useRegex])

  useEffect(() => {
    return () => setSearch([], -1)
  }, [setSearch])

  const gotoHit = (delta: number) => {
    if (hits.length === 0) return
    setHitIndex((i) => (i + delta + hits.length) % hits.length)
  }

  const hasReadOnly=matches.some(m=>isAliasPath(m.path,aliases))
  const scalarMatches = useMemo(
    () => matches.filter((m) => m.kind !== 'object' && m.kind !== 'array'),
    [matches],
  )

  if (!open) return null

  const applyBatch = () => {
    if (useRegex || hasReadOnly || scalarMatches.length === 0 || matches.length > 300) return
    const parsed = interpretScalarInput(batchValue)
    if (parsed.numericUnsafe) {
      const strings = scalarMatches.filter((m) => m.kind === 'string')
      if (strings.length === 0) {
        notify('该值无法安全识别为数字，已取消批量修改以免丢失精度。')
        return
      }
      setValueAtMany(strings.map((m) => m.path), batchValue, batchValue)
      notify(`该值无法安全识别为数字，仅更新了 ${strings.length} 个文本字段，未改写数字等非文本字段。`)
      return
    }
    setValueAtMany(
      scalarMatches.map((m) => m.path),
      parsed.value,
      batchValue,
    )
  }

  const deleteAll = () => {
    if (useRegex || hasReadOnly || matches.length === 0 || matches.length > 300) return
    const state=useStore.getState()
    setDeleteConfirm({source:state.source,docIndex:state.docIndex,documentId:state.documentId,paths:matches.map(m=>m.path)})
  }

  const runAi = async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setAiError('');setAiResult('')
    const controller=new AbortController();aiRequest.current?.abort();aiRequest.current=controller
    aiBase.current={source:useStore.getState().source,documentId:useStore.getState().documentId}
    try {
      const yaml = await generateYaml(aiPrompt, loadAiSettings(), aiBase.current.source,controller.signal)
      if(aiRequest.current===controller && !controller.signal.aborted)setAiResult(yaml)
    } catch (e) {
      if(!controller.signal.aborted && aiRequest.current===controller)setAiError((e as Error).message)
    } finally {
      if(aiRequest.current===controller){aiRequest.current=null;setAiLoading(false)}
    }
  }

  return (
    <aside className="search-panel">
      {deleteConfirm && <section role="alertdialog" aria-label="确认批量删除" className="batch-confirm"><p>确认删除 {deleteConfirm.paths.length} 个匹配项？此操作可撤销。</p><button className="btn" onClick={()=>setDeleteConfirm(null)}>取消删除</button><button className="btn btn-danger" onClick={()=>{
        const state=useStore.getState();if(state.source!==deleteConfirm.source||state.docIndex!==deleteConfirm.docIndex||state.documentId!==deleteConfirm.documentId)notify('工作区已变化，已取消旧的批量删除。');else deleteMany(deleteConfirm.paths);setDeleteConfirm(null)
      }}>确认删除</button></section>}
      {hasReadOnly && <p className="settings-note">匹配中包含别名引用，只读值不能批量修改或删除。请缩小查询或编辑锚点定义。</p>}
      {useRegex && <p className="settings-note">正则模式仅定位全文；结构化批量修改与删除已禁用。最多定位 5000 处。</p>}
      {matches.length > 300 && <p className="settings-note">结果较多，仅展示前 300 项。请缩小查询后再修改。</p>}
      {aiResult && <div className="sp-ai-preview"><label>AI 全文件修改预览<textarea className="convert-text" readOnly value={aiResult}/></label><button className="btn" onClick={() => {
        const state=useStore.getState();if(state.source!==aiBase.current.source||state.documentId!==aiBase.current.documentId){setAiError('工作区已变化，请重新生成；未应用旧结果。');return}if(state.applySource(aiResult,aiBase.current.source,aiBase.current.documentId))setAiResult('')
      }}>确认应用 AI 结果</button></div>}
      {docCount > 1 && <p className="settings-note">查询、高亮与批量修改仅针对当前文档（第 {docIndex + 1}/{docCount} 份）。可在源码上方切换文档后再查其他文档。</p>}
      <div className="sp-header">
        <span className="pane-icon pane-icon-form" aria-hidden>🔍</span>
        <span className="pane-title">查询与批量修改</span>
        <button className="btn btn-icon" onClick={onClose} title="关闭 (Esc)">
          ×
        </button>
      </div>

      <div className="sp-search">
        <input
          ref={inputRef}
          className="field-input sp-query"
          placeholder="按键名或值搜索…（留空显示全部元素）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
          }}
        />
        <div className="sp-toggles">
          <label className={inKeys ? 'sp-chip on' : 'sp-chip'}>
            <input
              type="checkbox"
              checked={inKeys}
              onChange={(e) => setInKeys(e.target.checked)}
            />
            键名
          </label>
          <label className={inValues ? 'sp-chip on' : 'sp-chip'}>
            <input
              type="checkbox"
              checked={inValues}
              onChange={(e) => setInValues(e.target.checked)}
            />
            值
          </label>
          <label className={useRegex ? 'sp-chip on' : 'sp-chip'}>
            <input
              type="checkbox"
              checked={useRegex}
              onChange={(e) => setUseRegex(e.target.checked)}
            />
            正则
          </label>
          {!useRegex && (
            <span className="sp-count">
              {matches.length} 个匹配
              {scalarMatches.length !== matches.length &&
                `（${scalarMatches.length} 个可改值）`}
            </span>
          )}
        </div>
        {useRegex && (
          <div className="sp-regex-nav">
            {regexError ? (
              <span className="sp-regex-err">⚠ 无效正则：{regexError}</span>
            ) : (
              <span className="sp-count">
                {hits.length > 0 ? `第 ${hitIndex + 1} / ${hits.length} 处` : '无匹配'}
              </span>
            )}
            <button
              className="btn btn-sm"
              disabled={hits.length === 0}
              onClick={() => gotoHit(-1)}
              title="上一处"
            >
              ↑ 上一处
            </button>
            <button
              className="btn btn-sm"
              disabled={hits.length === 0}
              onClick={() => gotoHit(1)}
              title="下一处"
            >
              ↓ 下一处
            </button>
          </div>
        )}
      </div>

      <div className="sp-results">
        {useRegex ? <div className="sp-empty">正则定位结果已高亮在源码中。</div> : matches.length === 0 ? (
          <div className="sp-empty">没有匹配的元素</div>
        ) : (
          matches.slice(0, 300).map((m, i) => (
            <div className="sp-row" key={`${m.label}#${i}`}>
              <div className="sp-row-top">
                <span className={`type-badge type-${m.kind} sp-kind`}>
                  {KIND_LABELS[m.kind]}
                </span>
                <span className="sp-path" title={m.label}>
                  {m.label}
                </span>
              </div>
              <div className="sp-row-edit">
                <InlineValue match={m} />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="sp-batch">
        <div className="sp-section-title">批量修改</div>
        <div className="sp-batch-row">
          <input
            className="field-input"
            placeholder="把上面可改值统一设为…"
            title="文本字段保留文本类型；其他字段自动识别数字、布尔和空值。"
            value={batchValue}
            onChange={(e) => setBatchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyBatch()
            }}
          />
          <button
            className="btn btn-sm btn-add"
            disabled={useRegex || hasReadOnly || scalarMatches.length === 0 || matches.length > 300}
            onClick={applyBatch}
            title="应用到全部可改值的匹配"
          >
            应用到 {scalarMatches.length} 项
          </button>
        </div>
        <button
          className="btn btn-sm btn-danger"
          disabled={useRegex || hasReadOnly || matches.length === 0 || matches.length > 300}
          onClick={deleteAll}
        >
          批量删除全部 {matches.length} 个匹配
        </button>
      </div>

      <div className="sp-ai">
        <div className="sp-section-title">✦ AI 辅助修改（基于当前 YAML）</div>
        <textarea
          className="ai-input sp-ai-input"
          placeholder="例如：把所有 replicas 改成 5；给每个服务加上 restart: always"
          value={aiPrompt}
          rows={3}
          onChange={(e) => setAiPrompt(e.target.value)}
        />
        {aiError && (
          <div className="result-bad ai-error">
            {aiError}
            <button className="link-btn" onClick={onOpenSettings}>
              打开设置
            </button>
          </div>
        )}
        <button
          className="btn btn-accent sp-ai-run"
          disabled={aiLoading || !aiPrompt.trim()}
          onClick={runAi}
        >
          {aiLoading ? 'AI 修改中…' : 'AI 修改'}
        </button>
      </div>
    </aside>
  )
}
