import { useStore } from '../store'
export function handleDocumentHistoryKey(e: KeyboardEvent) {
 if(e.defaultPrevented || e.isComposing || e.altKey || !(e.ctrlKey||e.metaKey))return
 const target=e.target
 if(target instanceof HTMLElement && target.closest('input,textarea,[contenteditable=true]') && !target.closest('.cm-editor,[data-document-field]'))return
 const key=e.key.toLowerCase()
 if(key==='z'&&!e.shiftKey){e.preventDefault();useStore.getState().undo()}
 else if(key==='y'||(key==='z'&&e.shiftKey)){e.preventDefault();useStore.getState().redo()}
}
