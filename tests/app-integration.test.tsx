import {test} from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {JSDOM} from 'jsdom'
// Node has no CSS renderer. Only stylesheet loading is omitted; application,
// CodeMirror, browser event handling and the real store are not mocked.
registerHooks({load(url,context,next){if(url.endsWith('.css'))return {format:'module',source:'',shortCircuit:true};return next(url,context)}})
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost',pretendToBeVisual:true})
Object.assign(globalThis,{window:dom.window,Window:dom.window.Window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node,MutationObserver:dom.window.MutationObserver,getComputedStyle:dom.window.getComputedStyle,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),ResizeObserver:class{observe(){}unobserve(){}disconnect(){}}})
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
dom.window.HTMLElement.prototype.scrollIntoView=function(){}
const rect={left:0,right:0,top:0,bottom:0,width:0,height:0,x:0,y:0,toJSON(){return {}}}
dom.window.Range.prototype.getClientRects=()=>[] as unknown as DOMRectList
dom.window.Range.prototype.getBoundingClientRect=()=>rect as DOMRect
const React=await import('react'),{render,fireEvent,act,cleanup,within}=await import('@testing-library/react')
const {default:App}=await import('../src/App')
const {useStore}=await import('../src/store'),{editorViewRef}=await import('../src/lib/editorView')
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))

test('real App preserves one form transaction through CodeMirror sync, guards Web leave, and reveals source on diagnostic activation',async()=>{
 const original='service:\n  name: ux-demo\n'
 useStore.getState().loadFile('/ux-app.yaml',original)
 let downloads=0;const old=dom.window.HTMLAnchorElement.prototype.click
 dom.window.HTMLAnchorElement.prototype.click=function(){downloads++}
 const ui=render(React.createElement(App))
 try{
  let field=ui.getByDisplayValue('ux-demo')
  await act(async()=>fireEvent.focus(field))
  for(const value of ['ux-e','ux-ed','ux-edi','ux-edit','ux-edite','ux-edited'])await act(async()=>{fireEvent.change(field,{target:{value}});await tick()})
  assert.equal(useStore.getState().past.length,1)
  assert.match(editorViewRef.current!.state.doc.toString(),/ux-edited/)
  await act(async()=>{fireEvent.blur(field);fireEvent.click(ui.container.querySelector('.outline-node')!)})
  await act(async()=>fireEvent.click(ui.getByTitle('撤销（Ctrl+Z）')))
  assert.equal(useStore.getState().source,original)
  await act(async()=>fireEvent.click(ui.getByTitle('重做（Ctrl+Y）')))
  field=ui.getByDisplayValue('ux-edited')
  await act(async()=>{fireEvent.focus(field);fireEvent.change(field,{target:{value:'ux-next'}})})
  await act(async()=>fireEvent.keyDown(field,{key:'z',ctrlKey:true}))
  assert.ok(ui.getByDisplayValue('ux-edited'))
  await act(async()=>fireEvent.click(ui.getByTitle('新建（Ctrl+N）')))
  assert.ok(ui.getByText('继续前处理未保存更改'))
  await act(async()=>fireEvent.click(within(ui.getByRole('dialog',{name:'继续前处理未保存更改'})).getByRole('button',{name:'下载副本'})))
  assert.equal(downloads,1);assert.match(useStore.getState().source,/ux-edited/);assert.equal(useStore.getState().dirty,true)
  assert.ok(ui.getByRole('button',{name:'已确认下载成功，继续'}))
  await act(async()=>fireEvent.click(ui.getByRole('button',{name:'取消'})))
  assert.match(useStore.getState().source,/ux-edited/)
  await act(async()=>fireEvent.click(ui.getByTitle('新建（Ctrl+N）')))
  await act(async()=>fireEvent.click(within(ui.getByRole('dialog',{name:'继续前处理未保存更改'})).getByRole('button',{name:'下载副本'})))
  await act(async()=>fireEvent.click(ui.getByRole('button',{name:'已确认下载成功，继续'})))
  assert.equal(downloads,2);assert.equal(useStore.getState().source,'')
  const broken='one: 1\ntwo: 2\nthree: 3\nfour: 4\nmissing: *missing\n'
  await act(async()=>useStore.getState().reset(broken))
  await act(async()=>fireEvent.click(ui.getByRole('button',{name:'显示表单工作区'})))
  assert.equal(ui.container.querySelector('.workarea')!.getAttribute('data-mobile-pane'),'form')
  await act(async()=>fireEvent.keyDown(ui.getByRole('button',{name:/第 5 行.*Unresolved alias/}),{key:'Enter'}))
  await act(async()=>{await tick()})
  assert.equal(ui.container.querySelector('.workarea')!.getAttribute('data-mobile-pane'),'source')
  const view=editorViewRef.current!
  assert.equal(view.state.sliceDoc(view.state.selection.main.from,view.state.selection.main.to),'*missing')
  assert.equal(useStore.getState().source,broken)
 }finally{cleanup();dom.window.HTMLAnchorElement.prototype.click=old}
})
