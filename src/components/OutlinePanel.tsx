import { useMemo } from 'react'
import { useStore } from '../store'
import { pathKey } from '../lib/locate'
import { buildOutline } from '../lib/outline'

/** Left sidebar showing the document structure as a clickable tree. */
export function OutlinePanel({ onClose }: { onClose: () => void }) {
  const parsed = useStore((s) => s.parsed)
  const activePath = useStore((s) => s.activePath)
  const setActivePath = useStore((s) => s.setActivePath)
  const nodes = useMemo(() => buildOutline(parsed), [parsed])
  const activeKey = pathKey(activePath)

  return (
    <div className="outline-panel">
      <div className="outline-header">
        <span className="outline-title">⛬ 大纲</span>
        <button className="btn btn-icon" title="关闭大纲" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="outline-body">
        {nodes.length === 0 && <div className="outline-empty">（空文档）</div>}
        {nodes.map((n) => {
          const key = pathKey(n.path)
          return (
            <button
              key={key}
              className={
                key === activeKey ? 'outline-node active' : 'outline-node'
              }
              style={{ paddingLeft: 8 + n.depth * 14 }}
              title={n.preview}
              onClick={() => setActivePath(n.path, 'editor')}
            >
              <span className={`outline-dot dot-${n.kind}`} />
              <span className="outline-label">{n.label}</span>
              {(n.kind === 'object' || n.kind === 'array') ? (
                <span className="outline-count">{n.preview}</span>
              ) : (
                <span className="outline-preview">{n.preview}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
