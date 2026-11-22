import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { pathKey } from './locate'
import type { Path } from './yaml'

/** A focus session is one undo transaction; store boundaries invalidate stale tokens. */
export function useFieldEdit(path: Path) {
 const documentId=useStore(s=>s.documentId),docIndex=useStore(s=>s.docIndex)
 const activeToken=useStore(s=>s.fieldEditToken)
 const token=useRef<number|null>(null),key=pathKey(path)
 useEffect(()=>()=>{if(token.current!==null)useStore.getState().endFieldEdit(token.current)},[key,documentId,docIndex])
 const begin=()=>{token.current=useStore.getState().beginFieldEdit(path)}
 const current=()=>token.current!==null && token.current===useStore.getState().fieldEditToken && useStore.getState().documentId===documentId && useStore.getState().docIndex===docIndex
 return {activeToken, current, begin,
  end:()=>{if(token.current!==null)useStore.getState().endFieldEdit(token.current);token.current=null},
  write:(value:unknown)=>{
   const state=useStore.getState()
   if(state.documentId!==documentId || state.docIndex!==docIndex)return false
   if(!current())begin()
   return state.setFieldValue(path,value,token.current!)
  },
 }
}
