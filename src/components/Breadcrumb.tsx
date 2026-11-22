import { useStore } from '../store'
import type { Path } from '../lib/yaml'

/** Clickable path trail for the currently-active node. */
export function Breadcrumb() {
  const activePath = useStore((s) => s.activePath)
  const setActivePath = useStore((s) => s.setActivePath)

  if (!activePath || activePath.length === 0) {
    return (
      <div className="breadcrumb">
        <span className="crumb crumb-root">根</span>
        <span className="crumb-hint">点击表单字段或源码行查看路径</span>
      </div>
    )
  }

  const go = (depth: number) => {
    const target: Path = activePath.slice(0, depth + 1)
    setActivePath(target, 'form')
  }

  return (
    <div className="breadcrumb">
      <button className="crumb crumb-root" onClick={() => setActivePath(null, 'form')}>
        根
      </button>
      {activePath.map((seg, i) => (
        <span key={i} className="crumb-group">
          <span className="crumb-sep">›</span>
          <button className="crumb" onClick={() => go(i)}>
            {typeof seg === 'number' ? `#${seg + 1}` : seg}
          </button>
        </span>
      ))}
    </div>
  )
}
