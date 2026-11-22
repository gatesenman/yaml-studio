import { useStore, SAMPLE } from '../store'

export const MAX_FILE_SIZE = 2 * 1024 * 1024
export function isDesktop(): boolean { return typeof window !== 'undefined' && !!window.desktop?.isDesktop }
export function fileActionLabels(desktop=isDesktop()) {
 return desktop ? {save:'保存',title:'保存到原文件（Ctrl+S）',shortcut:'Ctrl+S',help:'Ctrl+S 保存；Ctrl+Shift+S 另存为。'} : {save:'下载副本',title:'下载 YAML 副本（Ctrl+S / Ctrl+Shift+S）；不写回原文件，未确认落盘时保留未保存标记。',shortcut:'Ctrl+S / Ctrl+Shift+S',help:'Ctrl+S / Ctrl+Shift+S 均下载 YAML 副本，不写回原文件。'}
}

export function notify(message: string) { useStore.getState().setNotice(message) }

let askToLeave: (() => Promise<boolean>) | null = null
export function registerLeaveGuard(guard: (() => Promise<boolean>) | null) { askToLeave = guard }
export async function canReplace(): Promise<boolean> {
  return !useStore.getState().dirty || (askToLeave ? askToLeave() : false)
}

function browserDownload(source: string, fileName: string) {
  const name = /\.ya?ml$/i.test(fileName) ? fileName : `${fileName || 'untitled'}.yaml`
  const url = URL.createObjectURL(new Blob([source], { type: 'text/yaml;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
let saving = false
async function save(as: boolean): Promise<boolean> {
  useStore.getState().endFieldEdit()
  if (saving) return false
  saving = true
  const s = useStore.getState()
  try {
    if (!isDesktop()) {
      browserDownload(s.source, s.fileName)
      notify('已发起 YAML 副本下载；不写回原文件，未保存标记保留。请在下载列表确认。')
      return true
    }
    const res = !as && s.filePath
      ? await window.desktop!.saveFile(s.filePath, s.source, s.savedSource)
      : await window.desktop!.saveFileAs(s.source, s.fileName)
    if (!res.ok) { if (!res.canceled) notify(`保存失败：${res.error || '未知错误'}`); return false }
    // Do not mark newer edits as saved while a native dialog was open.
    if (useStore.getState().documentId !== s.documentId || useStore.getState().filePath !== s.filePath || useStore.getState().fileName !== s.fileName) { const current=useStore.getState(); window.desktop!.setDirty?.(current.dirty,current.filePath); return false }
    useStore.getState().markSaved(res.path || null, s.source)
    notify('已保存到磁盘。')
    return useStore.getState().source === s.source
  } catch (error) { notify(`保存失败：${String(error)}`); return false }
  finally { saving = false }
}
export function saveCurrent() { return save(false) }
export function saveAs() { return save(true) }

export async function newDocument(sample = false) {
  if (!await canReplace()) return
  useStore.getState().reset(sample ? SAMPLE : '')
  notify(sample ? '已加载示例，可在源码和表单中双向编辑。' : '已新建文档。')
}
let importSequence = 0
export async function importBrowserFile(file: File) {
  const sequence = ++importSequence
  const documentId = useStore.getState().documentId
  if (!/\.ya?ml$/i.test(file.name)) { notify('请选择 .yaml 或 .yml 文件。'); return }
  if (file.size > MAX_FILE_SIZE) { notify('文件超过 2 MB 上限，请拆分后打开。'); return }
  try {
    const text = await file.text()
    if (sequence !== importSequence || useStore.getState().documentId !== documentId) { notify('文件读取期间工作区已变化，未应用旧文件。'); return }
    if (!await canReplace()) return
    useStore.getState().importFile(file.name, text)
    notify(`已导入文件副本；${isDesktop()?'保存时另存为':'下载时仅导出副本'}，不会覆盖之前的文件。`)
  } catch (error) { notify(`读取失败：${String(error)}`) }
}
export async function openViaDialog() {
  try {
    if (isDesktop()) { await window.desktop!.openDialog(); return }
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.yaml,.yml'
    input.onchange = () => { if (input.files?.[0]) void importBrowserFile(input.files[0]) }
    input.click()
  } catch (error) { notify(`打开失败：${String(error)}`) }
}

/** Native accelerators belong to Electron; both Web save chords download the same copy. */
export function handleWebSaveKey(e: KeyboardEvent) {
 if(isDesktop() || e.defaultPrevented || e.isComposing || e.altKey)return
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void(e.shiftKey?saveAs():saveCurrent())}
}
