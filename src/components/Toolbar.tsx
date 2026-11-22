import { fileActionLabels } from '../lib/fileActions'
import { splitDocuments } from '../lib/multidoc'
import { parse } from '../lib/yaml'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { isDesktop, saveCurrent, saveAs, openViaDialog, newDocument, notify } from '../lib/fileActions'
import { exportToHtml } from '../lib/exportHtml'

/** Trigger a client-side download of text content (works in Electron too). */
function downloadText(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export function Toolbar({
  onOpenSearch,
  onOpenAi,
  onOpenSettings,
  onToggleOutline,
  outlineOpen,
  onOpenConvert,
  onOpenDiff,
}: {
  onOpenSearch: () => void
  onOpenAi: () => void
  onOpenSettings: () => void
  onToggleOutline: () => void
  outlineOpen: boolean
  onOpenConvert: () => void
  onOpenDiff: () => void
}) {
  const fileName = useStore((s) => s.fileName)
  const setFileName = useStore((s) => s.setFileName)
  const source = useStore((s) => s.source)
  const formatSource = useStore((s) => s.formatSource)
  const alignMode = useStore((s) => s.alignMode)
  const setAlignMode = useStore((s) => s.setAlignMode)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const desktop = isDesktop()

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const copy = async () => {
    try { await navigator.clipboard.writeText(source) } catch { notify('复制失败：请允许剪贴板权限或手动复制源码。'); return }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const baseName = fileName.replace(/\.[^.]+$/, '') || 'document'
  const exportHtml = () => {
    const documents=splitDocuments(source).map(d=>parse(d.text))
    if(documents.some(d=>d.error)){notify('当前文件未通过解析/安全检查，HTML 导出已取消；仍可下载完整 YAML。');return}
    const parsed=documents.length===1?documents[0].value:Object.fromEntries(documents.map((d,i)=>[`文档 ${i+1}`,d.value]))
    downloadText(`${baseName}.html`, exportToHtml(fileName, source, parsed), 'text/html')
    setMenuOpen(false)
  }

  return (
    <header className="toolbar">
      <div className="file-actions"><button className="btn" onClick={() => void newDocument()} title="新建（Ctrl+N）">＋ 新建</button><button className="btn" onClick={() => void openViaDialog()} title="打开文件（Ctrl+O）">打开</button></div>
      <input
        className="filename-input"
        value={fileName}
        onChange={(e) => setFileName(e.target.value)}
        aria-label="文件名"
        spellCheck={false}
        title="文件名"
      />

      <div className="toolbar-actions">
        <button
          className="btn btn-icon"
          onClick={undo}
          disabled={!canUndo}
          title="撤销（Ctrl+Z）"
        >
          ↶
        </button>
        <button
          className="btn btn-icon"
          onClick={redo}
          disabled={!canRedo}
          title="重做（Ctrl+Y）"
        >
          ↷
        </button>
        <span className="toolbar-sep" />
        <button
          className={outlineOpen ? 'btn btn-toggle-on' : 'btn'}
          onClick={onToggleOutline}
          title="大纲结构树（Ctrl+Shift+O）"
        >
          ☰ 大纲
        </button>
        <button className="btn" onClick={onOpenSearch} title="查询 / 批量修改（Ctrl+F）">
          查询
        </button>
        <button
          className={alignMode ? 'btn btn-toggle-on' : 'btn'}
          onClick={() => setAlignMode(!alignMode)}
          title="切换行对齐模式（A=卡片 / B=紧凑逐行对齐）"
        >
          ⇄ 对齐 {alignMode ? 'B' : 'A'}
        </button>
        <button className="btn" onClick={formatSource} title="格式化 / 美化">
          格式化
        </button>
        <button className="btn" onClick={copy} title="复制 YAML">
          {copied ? '已复制' : '复制'}
        </button>
        <div className="toolbar-menu" ref={menuRef}>
          <button
            className={menuOpen ? 'btn btn-toggle-on' : 'btn'}
            onClick={() => setMenuOpen((o) => !o)}
            title="工具：转换 / 导入 / 导出 / Diff"
          >
            工具 ▾
          </button>
          {menuOpen && (
            <div className="toolbar-dropdown">
              <button onClick={() => { void newDocument(true); setMenuOpen(false) }}>加载入门示例</button>
              {desktop && <button onClick={() => { void saveAs(); setMenuOpen(false) }}>另存为（Ctrl+Shift+S）</button>}
              <button
                onClick={() => {
                  onOpenConvert()
                  setMenuOpen(false)
                }}
              >
                JSON / YAML 互转、导入 .env/.properties
              </button>
              <button
                onClick={() => {
                  onOpenDiff()
                  setMenuOpen(false)
                }}
              >
                差异预览
              </button>
              <button onClick={exportHtml}>导出只读 HTML</button>
            </div>
          )}
        </div>
        <span className="toolbar-sep" />
        <button
          className="btn btn-primary"
          onClick={() => void saveCurrent()}
          title={fileActionLabels(desktop).title}
        >
          {fileActionLabels(desktop).save}
        </button>
        <button className="btn btn-accent" onClick={onOpenAi} title="AI 生成 YAML">
          ✦ AI 生成
        </button>
        <button className="btn btn-icon" onClick={onOpenSettings} title="设置">
          ⚙
        </button>
      </div>
    </header>
  )
}
