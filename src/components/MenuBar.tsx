import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { newDocument, openViaDialog, saveCurrent, saveAs, isDesktop, fileActionLabels } from '../lib/fileActions'
type Item={label:string;shortcut?:string;disabled?:boolean;run:()=>void}
export function MenuBar({outline,search,convert,diff,settings,ai}:{outline:()=>void;search:()=>void;convert:()=>void;diff:()=>void;settings:()=>void;ai:()=>void}){
 const [active,setActive]=useState<string|null>(null), ref=useRef<HTMLDivElement>(null)
 const state=useStore(s=>s)
 const desktop=isDesktop(),labels=fileActionLabels(desktop)
 const menus:Record<string,Item[]>={
  '文件':[{label:'新建',shortcut:'Ctrl+N',run:()=>{void newDocument()}},{label:'打开…',shortcut:'Ctrl+O',run:()=>{void openViaDialog()}},{label:labels.save,shortcut:labels.shortcut,run:()=>{void saveCurrent()}},...(desktop?[{label:'另存为…',shortcut:'Ctrl+Shift+S',run:()=>{void saveAs()}}]:[]),{label:'加载入门示例',run:()=>{void newDocument(true)}}],
  '编辑':[{label:'撤销文档修改',shortcut:'Ctrl+Z',disabled:!state.past.length,run:state.undo},{label:'重做文档修改',shortcut:'Ctrl+Y',disabled:!state.future.length,run:state.redo},{label:'查询与批量修改',shortcut:'Ctrl+F',run:search},{label:'格式化当前文档',disabled:!!state.error,run:state.formatSource}],
  '视图':[{label:'切换文档大纲',shortcut:'Ctrl+Shift+O',run:outline},{label:state.alignMode?'使用卡片表单':'使用紧凑表单',run:()=>state.setAlignMode(!state.alignMode)}],
  '工具':[{label:'当前文档格式转换',run:convert},{label:'差异预览',run:diff},{label:'AI 生成 / 修改（先预览）',run:ai},{label:'设置与 Schema',run:settings}],
 }
 useEffect(()=>{
  if(!active)return
  const outside=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setActive(null)}
  document.addEventListener('mousedown',outside)
  return()=>document.removeEventListener('mousedown',outside)
 },[active])
 return <div className="menubar" ref={ref} role="menubar" aria-label="应用菜单" onKeyDown={e=>{
  if(e.key==='Escape'){e.stopPropagation();setActive(null);(ref.current?.querySelector(`[data-menu="${active}"]`) as HTMLElement)?.focus()}
  if(['ArrowDown','ArrowUp'].includes(e.key)){
   e.preventDefault();const items=Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menu] [role=menuitem]:not(:disabled)')||[])
   const i=items.indexOf(document.activeElement as HTMLButtonElement);items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()
  }
 }}>{Object.entries(menus).map(([name,items])=><div className="app-menu" key={name}><button data-menu={name} role="menuitem" aria-haspopup="menu" aria-expanded={active===name} onClick={()=>setActive(active===name?null:name)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(name);requestAnimationFrame(()=>ref.current?.querySelector<HTMLButtonElement>('[role=menu] button:not(:disabled)')?.focus())}}}>{name}</button>{active===name&&<div className="app-menu-items" role="menu" aria-label={name}>{items.map(item=><button role="menuitem" disabled={item.disabled} key={item.label} onClick={()=>{setActive(null);item.run()}}><span>{item.label}</span><kbd>{item.shortcut}</kbd></button>)}</div>}</div>)}<span className="menubar-version">配置工作台 · 1.3.2</span></div>
}
