import { useStore } from '../store'

/** Tabs for navigating a multi-document (`---` separated) YAML stream. */
export function DocTabs() {
  const docCount = useStore((s) => s.docCount)
  const docIndex = useStore((s) => s.docIndex)
  const setDocIndex = useStore((s) => s.setDocIndex)

  if (docCount <= 1) return null

  return (
    <div className="doc-tabs" role="tablist">
      <span className="doc-tabs-label">多文档：</span>
      {Array.from({ length: docCount }, (_, i) => (
        <button
          key={i}
          role="tab"
          aria-selected={i === docIndex}
          className={i === docIndex ? 'doc-tab active' : 'doc-tab'}
          onClick={() => setDocIndex(i)}
          title={`第 ${i + 1} 个文档`}
        >
          文档 {i + 1}
        </button>
      ))}
    </div>
  )
}
