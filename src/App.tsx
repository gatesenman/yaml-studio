import { handleDocumentHistoryKey } from './lib/historyKeys'
import { MenuBar } from './components/MenuBar'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { YamlSourceEditor } from './components/YamlSourceEditor'
import { FormPane } from './components/FormPane'
import { FormCompactMode } from './components/FormCompactMode'
import { TestPanel } from './components/TestPanel'
import { AiPanel } from './components/AiPanel'
import { SearchPanel } from './components/SearchPanel'
import { SettingsModal } from './components/SettingsModal'
import { OutlinePanel } from './components/OutlinePanel'
import { ConvertModal } from './components/ConvertModal'
import { DiffModal } from './components/DiffModal'
import { useStore } from './store'
import { saveCurrent, saveAs, openViaDialog, newDocument, importBrowserFile, canReplace, registerLeaveGuard, notify, isDesktop, handleWebSaveKey } from './lib/fileActions'

function App() {
  const loadFile = useStore((s) => s.loadFile)

  const alignMode = useStore((s) => s.alignMode)
  const [aiOpen, setAiOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [convertOpen, setConvertOpen] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [extChange, setExtChange] = useState<{ path: string; content: string } | null>(null)
  const [split, setSplit] = useState(50)
  const [mobilePane,setMobilePane]=useState<'source'|'form'>('source')
  const sourceTarget=useStore(s=>s.sourceTarget)
  useEffect(()=>{if(sourceTarget)setMobilePane('source')},[sourceTarget])
  const notice = useStore((s) => s.notice)
  const dirty = useStore((s) => s.dirty)
  const source = useStore((s) => s.source)
  const error = useStore((s) => s.error)
  const docIndex = useStore((s) => s.docIndex)
  const docCount = useStore((s) => s.docCount)
  const filePath = useStore((s) => s.filePath)
  const [leavePrompt, setLeavePrompt] = useState(false)
  const leaveResolve = useRef<((ok: boolean) => void) | null>(null)
  const [guardSaving, setGuardSaving] = useState(false)
  const [downloadPending,setDownloadPending]=useState<{source:string;documentId:number}|null>(null)
  const answerLeave = (ok: boolean) => { leaveResolve.current?.(ok); leaveResolve.current = null; setLeavePrompt(false); setDownloadPending(null) }
  useEffect(() => {
    registerLeaveGuard(() => new Promise<boolean>((resolve) => {
      if (leaveResolve.current) { resolve(false); return }
      leaveResolve.current = resolve; setDownloadPending(null); setLeavePrompt(true)
    }))
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onUnload)
    return () => { registerLeaveGuard(null); window.removeEventListener('beforeunload', onUnload); leaveResolve.current?.(false) }
  }, [])
  useEffect(() => { window.desktop?.setDirty(dirty, filePath) }, [dirty, filePath])
  useEffect(() => {
    if (!window.desktop) return
    return window.desktop.onMenu((action) => {
      if (action === 'close-request') void canReplace().then((ok) => { if (ok) window.desktop?.confirmClose() })
    })
  }, [])
  // One consistent desktop dialog contract: Escape, focus entry and Tab trap.
  useEffect(() => {
    const modalOpen=leavePrompt||!!extChange||aiOpen||settingsOpen||convertOpen||diffOpen
    const before=document.activeElement as HTMLElement|null
    const top=()=>Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop')).sort((a,b)=>Number(getComputedStyle(a).zIndex||0)-Number(getComputedStyle(b).zIndex||0)).at(-1)
    const focusables=()=>Array.from(top()?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')||[]).filter(el=>el.getClientRects().length>0)
    const frame=modalOpen?requestAnimationFrame(()=>focusables()[0]?.focus()):0
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){
        e.preventDefault()
        if(leavePrompt){if(!guardSaving)answerLeave(false)}
        else if(extChange)setExtChange(null)
        else if(diffOpen)setDiffOpen(false)
        else if(convertOpen)setConvertOpen(false)
        else if(settingsOpen)setSettingsOpen(false)
        else if(aiOpen)setAiOpen(false)
        else setSearchOpen(false)
      }else if(e.key==='Tab'&&modalOpen){
        const list=focusables(),i=list.indexOf(document.activeElement as HTMLElement)
        if(i<0||(!e.shiftKey&&i===list.length-1)||(e.shiftKey&&i===0)){e.preventDefault();(e.shiftKey?list.at(-1):list[0])?.focus()}
      }
    }
    document.addEventListener('keydown',key)
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',key);if(modalOpen&&before?.isConnected)before.focus()}
  },[leavePrompt,guardSaving,extChange,aiOpen,settingsOpen,convertOpen,diffOpen])
  const [dragOver, setDragOver] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)

  // Desktop (Electron) integration: file-open + native menu wiring.
  useEffect(() => {
    const d = window.desktop
    if (!d) return

    d.ready().then((payload) => {
      if (payload) void canReplace().then((ok) => { if (ok) loadFile(payload.path, payload.content) })
    })

    const offOpen = d.onOpenFile((payload) => {
      void canReplace().then((ok) => { if (ok) loadFile(payload.path, payload.content) })
    })
    const offMenu = d.onMenu((action) => {
      switch (action) {
        case 'new': void newDocument(); break
        case 'open': void openViaDialog(); break
        case 'undo': useStore.getState().undo(); break
        case 'redo': useStore.getState().redo(); break
        case 'file-error': notify('无法读取文件：文件不存在、超过 2 MB 或无权限。'); break
        case 'save':
          void saveCurrent()
          break
        case 'save-as':
          void saveAs()
          break
      }
    })
    // External-change monitoring (D2): prompt before reloading from disk.
    const offChange = d.onFileChanged((payload) => {
      const { dirty, filePath } = useStore.getState()
      if (filePath !== payload.path) return
      if (dirty) setExtChange(payload)
      else loadFile(payload.path, payload.content)
    })
    return () => {
      offOpen()
      offMenu()
      offChange()
    }
  }, [loadFile])

  useEffect(() => { setExtChange(null) }, [filePath])

  // Save chords use one environment-aware action; Electron keeps its native menu accelerators.
  useEffect(()=>{
    window.addEventListener('keydown',handleWebSaveKey)
    return ()=>window.removeEventListener('keydown',handleWebSaveKey)
  },[])

  // Ctrl+F toggles search; Ctrl+O toggles the outline tree.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'f') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      } else if (k === 'o' && e.shiftKey) {
        e.preventDefault(); setOutlineOpen((o) => !o)
      } else if (k === 'o' && !window.desktop) {
        e.preventDefault(); void openViaDialog()
      } else if (k === 'n' && !window.desktop) {
        e.preventDefault(); void newDocument()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Document fields and source share the same store history; other inputs keep native undo.
  useEffect(() => {
    window.addEventListener('keydown',handleDocumentHistoryKey,true)
    return ()=>window.removeEventListener('keydown',handleDocumentHistoryKey,true)
  }, [])

  const startDrag = useCallback(() => {
    const onMove = (e: MouseEvent) => {
      const el = splitRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setSplit(Math.min(80, Math.max(20, pct)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await importBrowserFile(file)
  }

  return (
    <div
      className={dragOver ? 'app drag-over' : 'app'}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <TitleBar />
      <MenuBar outline={()=>setOutlineOpen(o=>!o)} search={()=>setSearchOpen(true)} convert={()=>setConvertOpen(true)} diff={()=>setDiffOpen(true)} settings={()=>setSettingsOpen(true)} ai={()=>setAiOpen(true)}/>
      <Toolbar
        onOpenSearch={() => setSearchOpen(true)}
        onOpenAi={() => setAiOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleOutline={() => setOutlineOpen((o) => !o)}
        outlineOpen={outlineOpen}
        onOpenConvert={() => setConvertOpen(true)}
        onOpenDiff={() => setDiffOpen(true)}
      />

      <div className="workspace-heading"><span>工作区 <b>/</b> 配置编辑器</span><span className="mobile-view-switch" role="group" aria-label="窄屏工作区视图"><button type="button" aria-label="显示源码工作区" aria-pressed={mobilePane==='source'} className={mobilePane==='source'?'active':''} onClick={()=>setMobilePane('source')}>源码</button><button type="button" aria-label="显示表单工作区" aria-pressed={mobilePane==='form'} className={mobilePane==='form'?'active':''} onClick={()=>setMobilePane('form')}>表单</button></span><span className="workspace-mode">本地优先 · {window.desktop ? '桌面版' : 'Web 版'}</span></div>
      <div className="workarea" data-mobile-pane={mobilePane}>
        <nav className="activity-bar" aria-label="工作区导航">
          <button title="文档大纲（Ctrl+Shift+O）" className={outlineOpen ? 'active' : ''} onClick={() => setOutlineOpen(!outlineOpen)}>☷<small>大纲</small></button>
          <button title="查询与替换（Ctrl+F）" onClick={() => setSearchOpen(!searchOpen)}>⌕<small>查询</small></button>
          <button title="格式转换" onClick={() => setConvertOpen(true)}>⇄<small>转换</small></button>
          <button title="差异预览" onClick={() => setDiffOpen(true)}>±<small>差异</small></button>
          <button title="设置" className="activity-bottom" onClick={() => setSettingsOpen(true)}>⚙<small>设置</small></button>
        </nav>
        {outlineOpen && <OutlinePanel onClose={() => setOutlineOpen(false)} />}
        <div className="split" ref={splitRef}>
          <div className="split-side source-side" style={{ width: `${split}%` }}>
            <YamlSourceEditor />
          </div>
          <div
            className="splitter"
            onMouseDown={startDrag}
            title="拖拽调整宽度"
          />
          <div className="split-side form-side" style={{ width: `${100 - split}%` }}>
            {alignMode ? <FormCompactMode /> : <FormPane />}
          </div>
        </div>
        <SearchPanel
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onOpenSettings={() => {
            setSearchOpen(false)
            setSettingsOpen(true)
          }}
        />
      </div>

      <TestPanel />
      {notice && <div className="notice-bar" role="status"><span>{notice}</span><button aria-label="关闭通知" onClick={() => notify('')}>×</button></div>}
      <footer className="statusbar"><span className={error ? 'status-error' : 'status-ok'}>{error ? '● 解析/安全检查待处理' : '● YAML 就绪'}</span><span title={filePath || '本地草稿，不关联磁盘路径'}>{dirty ? '有未保存更改' : '无未保存更改'}</span><span className="status-spacer"/><span>文档 {docIndex + 1}/{docCount}</span><span>{source.split('\n').length} 行</span><span>UTF-8</span><span>YAML 1.2</span></footer>
      {leavePrompt && <div className="modal-backdrop" style={{ zIndex: 2000 }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="leave-title"><div className="modal-header" id="leave-title">{isDesktop()?'保存当前文档的更改？':'继续前处理未保存更改'}</div><div className="modal-body">{isDesktop()?'当前文档有未保存的修改。继续前可以先保存，或放弃修改；取消则保留当前工作区。':'当前文档有未保存更改。可下载 YAML 副本并确认落盘后继续；下载不会写回原文件。取消可保留工作区。'}{downloadPending && <p role="status">下载已发起；请先在浏览器确认文件确实保存成功，再点击下方确认按钮。</p>}</div><div className="modal-footer"><button className="btn" disabled={guardSaving} onClick={() => answerLeave(false)}>取消</button><button className="btn btn-danger" disabled={guardSaving} onClick={() => answerLeave(true)}>放弃更改，继续</button><button className="btn btn-accent" disabled={guardSaving} onClick={async () => { setGuardSaving(true); const state=useStore.getState(); const ok = await saveCurrent(); setGuardSaving(false); if (ok) { if(isDesktop()) answerLeave(true); else setDownloadPending({source:state.source,documentId:state.documentId}) } }}>{isDesktop()?'保存后继续':'下载副本'}</button>{downloadPending && <button className="btn btn-accent" onClick={()=>{const state=useStore.getState();if(state.source!==downloadPending.source||state.documentId!==downloadPending.documentId){notify('工作区已变化，请重新下载后确认。');setDownloadPending(null);return}state.markSaved(null,downloadPending.source);answerLeave(true)}}>已确认下载成功，继续</button>}</div></section></div>}

      {dragOver && <div className="drop-overlay">松开以打开 YAML 文件</div>}

      <AiPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onOpenSettings={() => {
          setAiOpen(false)
          setSettingsOpen(true)
        }}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ConvertModal open={convertOpen} onClose={() => setConvertOpen(false)} />
      <DiffModal open={diffOpen} onClose={() => setDiffOpen(false)} />

      {extChange && (
        <div className="modal-backdrop" onClick={() => setExtChange(null)}>
          <div className="modal reload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>文件已被外部修改</span>
            </div>
            <div className="reload-body">
              此文件在磁盘上被其他程序修改，但你有未保存的改动。是否放弃本地改动并重新加载？
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setExtChange(null)}>
                否，保留我的编辑
              </button>
              <button
                className="btn btn-add"
                onClick={() => {
                  if (useStore.getState().filePath === extChange.path) loadFile(extChange.path, extChange.content)
                  setExtChange(null)
                }}
              >
                是，重新加载
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
