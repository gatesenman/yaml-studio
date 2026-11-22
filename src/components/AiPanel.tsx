import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { generateYaml, loadAiSettings } from '../lib/ai'
import { canReplace, notify } from '../lib/fileActions'
const PRESETS = ['生成一个 Kubernetes Deployment，3 副本，nginx 镜像', '生成一个 GitHub Actions CI 工作流，跑 lint 和 test', '生成一个 docker-compose，包含 web 和 postgres 服务', '生成一个应用配置文件，含数据库、缓存、日志级别']
export function AiPanel({ open, onClose, onOpenSettings }: { open: boolean; onClose: () => void; onOpenSettings: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<'replace' | 'modify'>('replace')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [base, setBase] = useState('')
  const [documentId, setDocumentId] = useState(0)
  const request = useRef<AbortController | null>(null)
  const cancel = () => { request.current?.abort(); request.current = null; setLoading(false); setResult('') }
  const close = () => { cancel(); onClose() }
  useEffect(() => { if (!open) cancel(); return () => { request.current?.abort(); request.current = null } }, [open])
  if (!open) return null
  const run = async () => {
    if (!prompt.trim()) return
    setLoading(true); setError(''); setResult('')
    const state = useStore.getState(), snapshot = state.source
    const controller = new AbortController(); request.current?.abort(); request.current = controller
    try {
      const yaml = await generateYaml(prompt, loadAiSettings(), mode === 'modify' ? snapshot : undefined, controller.signal)
      if (request.current !== controller || controller.signal.aborted) return
      setResult(yaml); setBase(snapshot); setDocumentId(state.documentId)
    } catch (e) { if (!controller.signal.aborted && request.current === controller) setError((e as Error).message) }
    finally { if (request.current === controller) { request.current = null; setLoading(false) } }
  }
  const apply = async () => {
    if (mode === 'modify') {
      if (useStore.getState().source !== base || useStore.getState().documentId !== documentId) { setError('生成期间文档已变化，请重新生成，或复制预览后手动合并。'); return }
      if(!useStore.getState().applySource(result,base,documentId))return
    } else {
      if (!await canReplace()) return
      useStore.getState().importFile('ai-generated.yaml', result)
    }
    notify('AI 结果已应用，请检查内容并执行 Schema / 断言测试。'); setResult(''); onClose()
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="AI 生成 YAML"><div className="modal-header"><span>✦ AI 生成 YAML</span><button className="btn" onClick={close}>关闭</button></div><div className="modal-body"><div className="seg"><button disabled={loading} className={mode === 'replace' ? 'seg-btn active' : 'seg-btn'} onClick={() => { setMode('replace'); setResult('') }}>新建生成</button><button disabled={loading} className={mode === 'modify' ? 'seg-btn active' : 'seg-btn'} onClick={() => { setMode('modify'); setResult('') }}>基于当前修改</button></div><p className="settings-note">将向你配置的接口发送提示词{mode === 'modify' ? '及当前 YAML' : ''}。结果先预览，不会自动覆盖工作区。请求最长 60 秒。</p><textarea className="ai-input" aria-label="生成需求" placeholder="用自然语言描述你想要的 YAML…" value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}/><div className="presets">{PRESETS.map(p => <button key={p} className="preset-chip" onClick={() => setPrompt(p)}>{p}</button>)}</div>{error && <div className="result-bad ai-error">{error}<button className="link-btn" onClick={() => { cancel(); onOpenSettings() }}>打开设置</button></div>}{result && <label>结果预览<textarea className="convert-text" aria-label="AI 结果预览" value={result} readOnly /></label>}</div><div className="modal-footer"><button className="btn" onClick={close}>取消</button><button className="btn btn-accent" disabled={loading || !prompt.trim()} onClick={() => void run()}>{loading ? '生成中…' : '生成预览'}</button>{result && <button className="btn btn-accent" onClick={() => void apply()}>应用结果</button>}</div></section></div>
}
