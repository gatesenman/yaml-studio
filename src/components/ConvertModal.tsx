import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { yamlToJson, jsonToYaml, envToYaml, propertiesToYaml } from '../lib/convert'

type Tab = 'json' | 'env' | 'properties'

/** Modal for JSON⇄YAML conversion and `.env` / `.properties` import. */
export function ConvertModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [baseline, setBaseline] = useState({source:'',docIndex:0,documentId:0})
  const [tab, setTab] = useState<Tab>('json')
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)

  // Seed the JSON tab with the current document whenever the modal opens.
  useEffect(() => {
    if (!open) return
    const {source,docIndex,documentId,activeSegment:segment}=useStore.getState()
    setErr(null)
    setBaseline({ source, docIndex, documentId })
    if (tab === 'json') {
      const { json, error } = yamlToJson(segment)
      setText(error ? '' : json)
      setErr(error)
    } else {
      setText('')
    }
  }, [open, tab])

  if (!open) return null

  const apply = () => {
    setErr(null)
    try {
      let yaml = ''
      if (tab === 'json') {
        const r = jsonToYaml(text)
        if (r.error) return setErr(`JSON 解析失败：${r.error}`)
        yaml = r.yaml
      } else if (tab === 'env') {
        yaml = envToYaml(text)
      } else {
        yaml = propertiesToYaml(text)
      }
      if (!useStore.getState().replaceActiveSegment(yaml, baseline.source, baseline.docIndex, baseline.documentId)) { setErr('工作区已变化或结果无效，请重新打开转换窗口。'); return }
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const copyJson = () => {
    void navigator.clipboard.writeText(text).catch(() => setErr('复制失败，请允许剪贴板权限或手动复制。'))
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'json', label: 'JSON ⇄ YAML' },
    { id: 'env', label: '导入 .env' },
    { id: 'properties', label: '导入 .properties' },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="格式转换" className="modal convert-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>格式转换 / 导入</span>
          <button className="btn btn-icon" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="convert-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'convert-tab active' : 'convert-tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="convert-body">
          <div className="convert-hint">
            {tab === 'json'
              ? '仅转换当前选中文档，其他文档保持不变。应用 JSON 会重建该文档（注释/锚点不保留），可撤销。'
              : tab === 'env'
                ? '粘贴 .env 内容（KEY=VALUE，# 为注释），点「应用为 YAML」转换。'
                : '粘贴 .properties 内容（a.b.c=值，支持点号嵌套），点「应用为 YAML」转换。'}
          </div>
          <textarea
            aria-label="转换内容"
            className="convert-text"
            spellCheck={false}
            value={text}
            placeholder={
              tab === 'env'
                ? 'PORT=8080\nDEBUG=false\nNAME="my app"'
                : tab === 'properties'
                  ? 'server.port=8080\nspring.datasource.url=jdbc:...'
                  : ''
            }
            onChange={(e) => setText(e.target.value)}
          />
          {err && <div className="convert-err">⚠ {err}</div>}
        </div>
        <div className="modal-footer">
          {tab === 'json' && (
            <button className="btn" onClick={copyJson}>
              复制 JSON
            </button>
          )}
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-add" onClick={apply}>
            应用为 YAML
          </button>
        </div>
      </div>
    </div>
  )
}
