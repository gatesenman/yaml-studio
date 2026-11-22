import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { diffLines } from '../lib/diff'
import { saveCurrent, isDesktop, fileActionLabels } from '../lib/fileActions'

/** Shows a line-level diff between the last saved version and the current text. */
export function DiffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const source = useStore((s) => s.source)
  const savedSource = useStore((s) => s.savedSource)
  const dirty = useStore((s) => s.dirty)
  const [saving, setSaving] = useState(false)
  const { rows, stats, coarse, truncated } = useMemo(
    () => open ? diffLines(savedSource, source) : { rows: [], stats: { added: 0, removed: 0 }, coarse: false, truncated: false },
    [open, savedSource, source],
  )

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="差异预览" className="modal diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>差异预览</span>
          <span className="diff-stats">
            <span className="diff-add">+{stats.added}</span>{' '}
            <span className="diff-del">-{stats.removed}</span>
          </span>
          <button className="btn btn-icon" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="diff-body">
          {coarse && <p className="settings-note">改动范围较大，已使用安全的区块对比（非最小行差异），完整内容仍可保存或下载。</p>}
          {truncated && <p className="settings-note">预览最多显示 3000 行，未显示的内容不会丢失。</p>}
          {stats.added === 0 && stats.removed === 0 ? (
            <div className="diff-empty">与导入 / 恢复 / 最近一次保存的参考内容相同，没有文本差异。是否落盘仍以未保存标记为准。</div>
          ) : (
            <table className="diff-table">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`diff-row diff-${r.kind}`}>
                    <td className="diff-gutter">{r.oldLine ?? ''}</td>
                    <td className="diff-gutter">{r.newLine ?? ''}</td>
                    <td className="diff-sign">
                      {r.kind === 'added' ? '+' : r.kind === 'removed' ? '-' : ' '}
                    </td>
                    <td className="diff-text">{r.text || '\u00a0'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-add"
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true)
              try { if (await saveCurrent() && isDesktop()) onClose() } finally { setSaving(false) }
            }}
          >
            {fileActionLabels().save}
          </button>
        </div>
      </div>
    </div>
  )
}
