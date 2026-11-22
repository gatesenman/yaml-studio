import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { isDesktop } from '../lib/fileActions'

/** Brand mark: a gradient tile with a YAML node-tree motif. */
function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
        <defs>
          <linearGradient id="bm-g" x1="0" y1="0" x2="28" y2="28">
            <stop offset="0" stopColor="#7c8cff" />
            <stop offset="0.55" stopColor="#9d7bff" />
            <stop offset="1" stopColor="#b07bff" />
          </linearGradient>
        </defs>
        <rect x="0.5" y="0.5" width="27" height="27" rx="7.5" fill="url(#bm-g)" />
        <g stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
          <path d="M9 8 v12" opacity="0.9" />
          <path d="M9 9 h5" />
          <path d="M9 14 h8" />
          <path d="M9 19 h5" />
        </g>
        <g fill="#fff">
          <circle cx="9" cy="9" r="1.9" />
          <circle cx="17" cy="14" r="1.9" />
          <circle cx="14" cy="19" r="1.9" />
        </g>
      </svg>
    </span>
  )
}

export function TitleBar() {
  const fileName = useStore((s) => s.fileName)
  const dirty = useStore((s) => s.dirty)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!window.desktop) return
    return window.desktop.onWindowState((st) => setMaximized(st.maximized))
  }, [])

  const ctrl = (action: 'minimize' | 'maximize' | 'close') =>
    window.desktop?.windowControl(action)

  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <BrandMark />
        <span className="titlebar-app">YAML Studio</span>
      </div>

      <div className="titlebar-doc">
        <span className="titlebar-file">{fileName}</span>
        {dirty && <span className="titlebar-dot" title="未保存的更改" />}
      </div>

      {isDesktop() && (
        <div className="window-controls">
          <button
            className="win-btn"
            title="最小化"
            onClick={() => ctrl('minimize')}
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
            </svg>
          </button>
          <button
            className="win-btn"
            title={maximized ? '还原' : '最大化'}
            onClick={() => ctrl('maximize')}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0" y="2" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
                <rect x="2" y="0" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button
            className="win-btn win-close"
            title="关闭"
            onClick={() => ctrl('close')}
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
