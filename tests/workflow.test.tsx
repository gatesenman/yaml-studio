import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost',pretendToBeVisual:true})
Object.assign(globalThis,{ window:dom.window, Window:dom.window.Window, document:dom.window.document, localStorage:dom.window.localStorage, HTMLElement:dom.window.HTMLElement, MutationObserver:dom.window.MutationObserver, getComputedStyle:dom.window.getComputedStyle })
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
Object.assign(globalThis,{requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),Element:dom.window.Element,Node:dom.window.Node})
dom.window.HTMLElement.prototype.scrollIntoView = function(){}
const { useStore } = await import('../src/store')
const { registerLeaveGuard, newDocument, importBrowserFile, saveCurrent, saveAs } = await import('../src/lib/fileActions')
const { loadAiSettings, saveAiSettings, generateYaml } = await import('../src/lib/ai')
const { render, fireEvent, cleanup, act, within } = await import('@testing-library/react')
const React = await import('react')
const { Toolbar } = await import('../src/components/Toolbar')
const { FormPane } = await import('../src/components/FormPane')
const { TestPanel } = await import('../src/components/TestPanel')

test('new / import cancel protection and import cannot retain a prior disk path',async () => {
 useStore.getState().loadFile('/old/config.yaml','a: 1\n')
 useStore.getState().setSource('a: 2\n')
 registerLeaveGuard(async () => false)
 await newDocument(); assert.equal(useStore.getState().filePath,'/old/config.yaml')
 registerLeaveGuard(async () => true)
 await importBrowserFile({name:'new.yaml',size:5,text:async ()=>'b: 3\n'} as File)
 assert.equal(useStore.getState().filePath,null); assert.equal(useStore.getState().fileName,'new.yaml')
 assert.equal(useStore.getState().past.length,0)
 assert.equal(JSON.parse(localStorage.getItem('yaml-studio.session-v2')!).source,'b: 3\n')
})
test('edit / undo / redo uses saved baseline and persists empty drafts', () => {
 useStore.getState().loadFile('/tmp/a.yaml','a: 1\n')
 useStore.getState().setValueAt(['a'],2); assert.equal(useStore.getState().dirty,true)
 useStore.getState().undo(); assert.equal(useStore.getState().dirty,false)
 useStore.getState().redo(); assert.equal(useStore.getState().dirty,true)
 useStore.getState().reset(''); assert.equal(localStorage.getItem('yaml-studio.draft'),'')
 assert.equal(JSON.parse(localStorage.getItem('yaml-studio.session-v2')!).source,'')
})
test('native save failure/cancel never marks saved; save-as snapshots in-flight edits',async () => {
 useStore.getState().loadFile('/tmp/a.yaml','a: 1\n'); useStore.getState().setSource('a: 2\n')
 window.desktop = {isDesktop:true,saveFile:async ()=>({ok:false,error:'denied'})} as never
 assert.equal(await saveCurrent(),false); assert.equal(useStore.getState().dirty,true)
 window.desktop = {isDesktop:true,saveFileAs:async ()=>({ok:false,canceled:true})} as never
 assert.equal(await saveAs(),false); assert.equal(useStore.getState().dirty,true)
 window.desktop = {isDesktop:true,saveFileAs:async ()=>{useStore.getState().setSource('a: 3\n');return {ok:true,path:'/tmp/new.yaml'}}} as never
 assert.equal(await saveAs(),false)
 assert.equal(useStore.getState().savedSource,'a: 2\n');assert.equal(useStore.getState().dirty,true)
 delete window.desktop
})
test('AI request validates endpoint and response; key is not persisted',async () => {
 saveAiSettings({baseUrl:'https://example.invalid/v1',model:'demo',apiKey:'test-key-not-real'})
 assert.ok(!localStorage.getItem('yaml-studio.ai-settings')!.includes('test-key-not-real'))
 assert.equal(loadAiSettings().apiKey,'test-key-not-real')
 await assert.rejects(generateYaml('generate',{...loadAiSettings(),baseUrl:'http://remote.invalid/v1'}),/HTTPS/)
 const previous = globalThis.fetch
 globalThis.fetch = (async (_url,options) => { assert.equal(JSON.parse(String(options?.body)).messages[1].content,'generate');return new Response(JSON.stringify({choices:[{message:{content:'```yaml\na: 1\n```'}}]}),{status:200}) }) as typeof fetch
 assert.equal(await generateYaml('generate',loadAiSettings()),'a: 1')
 globalThis.fetch = (async ()=>new Response(JSON.stringify({choices:[{message:{content:'a: ['}}]}),{status:200})) as typeof fetch
 await assert.rejects(generateYaml('generate',loadAiSettings()),/解析失败/)
 globalThis.fetch = previous
})
test('real form edits synchronize source, toolbar undo and cancel-new protect state',async () => {
 useStore.getState().reset('name: hello\nenabled: true\n')
 const props = {onOpenSearch(){},onOpenAi(){},onOpenSettings(){},onToggleOutline(){},outlineOpen:true,onOpenConvert(){},onOpenDiff(){}}
 const ui = render(React.createElement(React.Fragment,null,React.createElement(Toolbar,props),React.createElement(FormPane)))
 const field = ui.getByDisplayValue('hello')
 await act(async()=>{ fireEvent.change(field,{target:{value:'world'}});fireEvent.blur(field) })
 assert.match(useStore.getState().source,/world/)
 await act(async()=>fireEvent.click(ui.getByTitle('撤销（Ctrl+Z）')))
 assert.match(useStore.getState().source,/hello/)
 await act(async()=>useStore.getState().setSource('name: changed\n'))
 registerLeaveGuard(async()=>false)
 await act(async()=>fireEvent.click(ui.getByTitle('新建（Ctrl+N）')))
 assert.match(useStore.getState().source,/changed/)
 cleanup()
})
test('test panel handles multi-doc streams and malformed assertion storage', () => {
 localStorage.setItem('yaml-studio.assertions','{"bad":true}')
 useStore.getState().reset('a: 1\n---\nb: 2\n')
 const ui = render(React.createElement(TestPanel))
 assert.ok(ui.getByText('✓ 没有语法错误或警告'))
 cleanup()
})
test('session rehydration restores empty and nonempty drafts; recovery undo stays dirty without disk authority', async () => {
 for(const [i,source] of ['', 'name: recovered\n'].entries()){
  localStorage.setItem('yaml-studio.session-v2',JSON.stringify({source,fileName:'recovered.yaml',filePath:'/previous.yaml'}))
  localStorage.setItem('yaml-studio.collapsed','null')
  const fresh=await import(`../src/store.ts?recovery=${Date.now()}-${i}`)
  const store=fresh.useStore
  assert.equal(store.getState().source,source)
  assert.equal(store.getState().fileName,'recovered.yaml')
  assert.equal(store.getState().filePath,null);assert.equal(store.getState().dirty,true)
  assert.deepEqual(store.getState().collapsed,{})
  store.getState().setSource(source+'changed: true\n');store.getState().undo()
  assert.equal(store.getState().source,source);assert.equal(store.getState().dirty,true)
  assert.equal(store.getState().filePath,null)
 }
})

test('unresolved alias never shows a clean syntax panel when editor state has an error', () => {
 useStore.getState().reset('broken: *missing\n')
 assert.ok(useStore.getState().error)
 const ui = render(React.createElement(TestPanel))
 assert.equal(ui.queryByText('✓ 没有语法错误或警告'),null)
 assert.match(ui.getByText(/Unresolved alias/).textContent || '',/missing/)
 assert.ok(ui.getByText('语法检查 (1)'))
 cleanup()
})

test('converting current document keeps sibling source and guards stale context', () => {
 const source='# first\na: 1\n---\nb: 2\n'
 useStore.getState().loadFile('/current.yaml',source);useStore.getState().setDocIndex(1)
 const state=useStore.getState()
 assert.equal(state.replaceActiveSegment('b: 3\n',state.source,1,state.documentId),true)
 assert.ok(useStore.getState().source.startsWith('# first\na: 1\n'))
 assert.equal(useStore.getState().replaceActiveSegment('b: 4',state.source,1,state.documentId),false)
 useStore.getState().undo();assert.equal(useStore.getState().source,source)
})
test('late browser file reads cannot replace a newer document', async () => {
 useStore.getState().reset('old: true\n');registerLeaveGuard(async()=>true)
 let resolve!: (text:string)=>void
 const pending=importBrowserFile({name:'slow.yaml',size:10,text:()=>new Promise<string>(r=>resolve=r)} as File)
 useStore.getState().reset('new: true\n');resolve('late: true\n');await pending
 assert.equal(useStore.getState().source,'new: true\n')
})
test('same-name document replacement during native save cannot mark new document saved', async () => {
 useStore.getState().loadFile('/same.yaml','old: true\n');useStore.getState().setSource('edited: true\n')
 window.desktop={isDesktop:true,setDirty(){},saveFile:async()=>{
  useStore.getState().loadFile('/same.yaml','replacement: true\n');useStore.getState().setSource('replacement: edited\n')
  return {ok:true,path:'/same.yaml'}
 }} as never
 assert.equal(await saveCurrent(),false)
 assert.equal(useStore.getState().source,'replacement: edited\n');assert.equal(useStore.getState().dirty,true)
 delete window.desktop
})
test('recovered and imported drafts remain dirty when undo returns to an unsaved baseline', async () => {
 localStorage.setItem('yaml-studio.session-v2',JSON.stringify({source:'base: true\n',fileName:'recovered.yaml'}))
 const module=await import(`../src/store.ts?baseline=${Date.now()}`)
 const store=module.useStore
 store.getState().setValueAt(['base'],false);store.getState().undo()
 assert.equal(store.getState().dirty,true)
 useStore.getState().importFile('new.yaml','a: 1\n');useStore.getState().setValueAt(['a'],2);useStore.getState().undo()
 assert.equal(useStore.getState().dirty,true)
})
test('structural deletion of an anchor with live aliases is rejected without source loss', () => {
 useStore.getState().loadFile('/anchors.yaml','base: &base {port: 80}\ncopy: *base\n')
 const original=useStore.getState().source
 useStore.getState().deleteAt(['base'])
 assert.equal(useStore.getState().source,original)
 assert.ok(useStore.getState().notice)
})
test('conversion dialog only applies active doc and stale editor changes are never overwritten', async () => {
 const {ConvertModal}=await import('../src/components/ConvertModal')
 const first='# first comment\nbase: &base {port: 80} # anchor comment\ncopy: *base\n'
 const original=first+'---\nb: 2\n'
 useStore.getState().loadFile('/stream.yaml',original);useStore.getState().setDocIndex(1)
 let closed=0
 const ui=render(React.createElement(ConvertModal,{open:true,onClose:()=>closed++}))
 const text=ui.getByLabelText('转换内容')
 await act(async()=>fireEvent.change(text,{target:{value:'{"b":3}'}}))
 await act(async()=>fireEvent.click(ui.getByText('应用为 YAML')))
 assert.equal(closed,1);assert.ok(useStore.getState().source.startsWith(first+'---\n'));assert.match(useStore.getState().source,/b: 3/)
 await act(async()=>useStore.getState().undo());assert.equal(useStore.getState().source,original)
 await act(async()=>useStore.getState().redo())
 cleanup()
 const stale=render(React.createElement(ConvertModal,{open:true,onClose:()=>closed++}))
 await act(async()=>useStore.getState().setSource('newer: true\n'))
 await act(async()=>fireEvent.click(stale.getByText('应用为 YAML')))
 assert.equal(useStore.getState().source,'newer: true\n');assert.equal(closed,1)
 cleanup()
})
test('Diff stays open after save failure and closed Diff does not calculate huge changes', async () => {
 const {DiffModal}=await import('../src/components/DiffModal')
 useStore.getState().loadFile('/diff.yaml','a: 1\n');useStore.getState().setSource('a: 2\n')
 window.desktop={isDesktop:true,saveFile:async()=>({ok:false,error:'disk full'})} as never
 let closed=0
 const ui=render(React.createElement(DiffModal,{open:true,onClose:()=>closed++}))
 await act(async()=>fireEvent.click(ui.getByText('保存')))
 assert.equal(closed,0);assert.equal(useStore.getState().dirty,true)
 cleanup();delete window.desktop
 useStore.getState().reset('a: |\n'+'  old\n'.repeat(7000));useStore.getState().setSource('a: |\n'+'  new\n'.repeat(7000))
 const hidden=render(React.createElement(DiffModal,{open:false,onClose(){}}));assert.equal(hidden.container.innerHTML,'');cleanup()
})
test('AI abort propagates, oversized and non-string responses are rejected', async () => {
 const old=globalThis.fetch
 try{
  const controller=new AbortController()
  globalThis.fetch=((_url,options)=>new Promise((_r,reject)=>options?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))) as typeof fetch
  const pending=generateYaml('test',loadAiSettings(),undefined,controller.signal);controller.abort()
  await assert.rejects(pending,/Aborted/)
  globalThis.fetch=(async()=>new Response('x'.repeat(2*1024*1024+1))) as typeof fetch
  await assert.rejects(generateYaml('test',loadAiSettings()),/2 MB/)
  globalThis.fetch=(async()=>new Response(JSON.stringify({choices:[{message:{content:{bad:'object'}}}]}))) as typeof fetch
  await assert.rejects(generateYaml('test',loadAiSettings()),/文本内容/)
 }finally{globalThis.fetch=old}
})
test('search inline text keeps its type; batch replace/delete are explicit and undoable', async () => {
 const {SearchPanel}=await import('../src/components/SearchPanel')
 useStore.getState().loadFile('/search.yaml','name: needle\nother: retain\n')
 const ui=render(React.createElement(SearchPanel,{open:true,onClose(){},onOpenSettings(){}}))
 await act(async()=>fireEvent.change(ui.getByPlaceholderText('按键名或值搜索…（留空显示全部元素）'),{target:{value:'needle'}}))
 const inline=ui.getByLabelText('name 的值')
 await act(async()=>{fireEvent.focus(inline);fireEvent.change(inline,{target:{value:'false'}});fireEvent.blur(inline)})
 assert.match(useStore.getState().source,/name: "false"/)
 await act(async()=>fireEvent.change(ui.getByPlaceholderText('按键名或值搜索…（留空显示全部元素）'),{target:{value:'name'}}))
 await act(async()=>fireEvent.change(ui.getByPlaceholderText('把上面可改值统一设为…'),{target:{value:'001'}}))
 await act(async()=>fireEvent.click(ui.getByText('应用到 1 项')))
 assert.equal((useStore.getState().parsed as {name:unknown}).name,'001')
 await act(async()=>fireEvent.click(ui.getByText('批量删除全部 1 个匹配')))
 assert.match(useStore.getState().source,/name:/)
 await act(async()=>fireEvent.click(ui.getByText('确认删除')))
 assert.ok(!useStore.getState().source.includes('name:'));assert.match(useStore.getState().source,/retain/)
 await act(async()=>useStore.getState().undo());assert.equal((useStore.getState().parsed as {name:unknown}).name,'001')
 await act(async()=>useStore.getState().undo());assert.equal((useStore.getState().parsed as {name:unknown}).name,'false')
 cleanup()
})
test('Schema and assertion tabs execute real validators for the active document', async () => {
 localStorage.setItem('yaml-studio.assertions',JSON.stringify([{id:'port',path:'port',op:'equals',expected:'80'}]))
 useStore.getState().reset('port: wrong\n')
 useStore.getState().setSchemaText('type: object\nrequired: [port]\nproperties:\n  port: {type: integer}\n')
 const ui=render(React.createElement(TestPanel))
 await act(async()=>fireEvent.click(ui.getByText(/Schema 校验/)))
 assert.ok(ui.getByText(/must be integer/))
 await act(async()=>useStore.getState().setSource('port: 80\n'))
 assert.ok(ui.getByText('✓ 符合 Schema'))
 await act(async()=>fireEvent.click(ui.getByText(/当前文档断言/)))
 assert.ok(ui.getByText('PASS'))
 await act(async()=>fireEvent.change(ui.getByDisplayValue('80'),{target:{value:'81'}}))
 assert.ok(ui.getByText('FAIL'));cleanup();useStore.getState().setSchemaText('')
})
test('settings show Chinese field errors, retain invalid input, never persist it, and save corrected normalized values', async () => {
 const {SettingsModal}=await import('../src/components/SettingsModal')
 saveAiSettings({baseUrl:'https://original.invalid/v1',model:'mock',apiKey:'original-not-real'})
 let closed=0
 const ui=render(React.createElement(SettingsModal,{open:true,onClose:()=>closed++}))
 const baseline=localStorage.getItem('yaml-studio.ai-settings')
 const url=ui.getByPlaceholderText('https://api.openai.com/v1') as HTMLInputElement
 const model=ui.getByPlaceholderText('gpt-4o-mini') as HTMLInputElement
 const key=ui.getByPlaceholderText('sk-...')
 await act(async()=>fireEvent.change(key,{target:{value:'rejected-not-real'}}))
 for(const [value,message] of [['not a url',/完整有效/],['',/请输入接口地址/],['http://remote.invalid/v1',/HTTPS/],['https://example.invalid/v1?token=mock',/查询参数/]] as const){
  await act(async()=>fireEvent.change(url,{target:{value}}))
  await act(async()=>fireEvent.click(ui.getByText('保存')))
  assert.equal(closed,0);assert.equal(url.value,value)
  assert.equal(url.getAttribute('aria-invalid'),'true');assert.equal(url.getAttribute('aria-describedby'),'settings-url-error')
  assert.match(ui.getByRole('alert').textContent||'',message)
  assert.doesNotMatch(ui.getByRole('alert').textContent||'',/TypeError|Invalid URL|Failed to construct/)
  assert.equal(document.activeElement,url)
  assert.equal(localStorage.getItem('yaml-studio.ai-settings'),baseline)
  assert.equal(loadAiSettings().apiKey,'original-not-real')
 }
 assert.throws(()=>saveAiSettings({baseUrl:'broken',model:'mock',apiKey:'must-not-save'}),/完整有效/)
 assert.equal(localStorage.getItem('yaml-studio.ai-settings'),baseline)
 await act(async()=>{fireEvent.change(url,{target:{value:'  https://corrected.invalid/v1/  '}});fireEvent.change(model,{target:{value:'   '}})})
 await act(async()=>fireEvent.click(ui.getByText('保存')))
 assert.match(ui.getByRole('alert').textContent||'',/请输入模型名称/);assert.equal(document.activeElement,model)
 assert.equal(localStorage.getItem('yaml-studio.ai-settings'),baseline);assert.equal(closed,0)
 await act(async()=>fireEvent.change(model,{target:{value:' mock-corrected '} }))
 await act(async()=>fireEvent.click(ui.getByText('保存')))
 assert.equal(closed,1)
 assert.deepEqual(JSON.parse(localStorage.getItem('yaml-studio.ai-settings')!),{baseUrl:'https://corrected.invalid/v1',model:'mock-corrected'})
 assert.equal(loadAiSettings().apiKey,'rejected-not-real');cleanup()
})
test('AI dialog close aborts the active request and does not write its result', async () => {
 const {AiPanel}=await import('../src/components/AiPanel')
 saveAiSettings({baseUrl:'https://example.invalid/v1',model:'mock',apiKey:'test-not-a-real-key'})
 useStore.getState().reset('keep: true\n')
 const old=globalThis.fetch;let aborted=false
 globalThis.fetch=((_url,options)=>new Promise((_r,reject)=>options?.signal?.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'))}))) as typeof fetch
 try{
  const ui=render(React.createElement(AiPanel,{open:true,onClose(){},onOpenSettings(){}}))
  await act(async()=>fireEvent.change(ui.getByLabelText('生成需求'),{target:{value:'mock generate'}}))
  await act(async()=>fireEvent.click(ui.getByText('生成预览')))
  await act(async()=>fireEvent.click(ui.getByText('取消')))
  assert.equal(aborted,true);assert.equal(useStore.getState().source,'keep: true\n')
  cleanup()
 }finally{globalThis.fetch=old}
})
test('AI modification preview refuses a different document even with identical text', async () => {
 const {AiPanel}=await import('../src/components/AiPanel')
 const old=globalThis.fetch
 globalThis.fetch=(async()=>new Response(JSON.stringify({choices:[{message:{content:'result: true'}}]}))) as typeof fetch
 try{
  useStore.getState().reset('same: true\n')
  const ui=render(React.createElement(AiPanel,{open:true,onClose(){},onOpenSettings(){}}))
  await act(async()=>fireEvent.click(ui.getByText('基于当前修改')))
  await act(async()=>fireEvent.change(ui.getByLabelText('生成需求'),{target:{value:'change'}}))
  await act(async()=>fireEvent.click(ui.getByText('生成预览')))
  assert.ok(ui.getByLabelText('AI 结果预览'))
  await act(async()=>useStore.getState().reset('same: true\n'))
  await act(async()=>fireEvent.click(ui.getByText('应用结果')))
  assert.equal(useStore.getState().source,'same: true\n');assert.ok(ui.getByText(/生成期间文档已变化/));cleanup()
 }finally{globalThis.fetch=old}
})
test('software menu exposes disabled history and performs document actions', async () => {
 const {MenuBar}=await import('../src/components/MenuBar')
 useStore.getState().reset('a: 1\n')
 const no=()=>{}
 const ui=render(React.createElement(MenuBar,{outline:no,search:no,convert:no,diff:no,settings:no,ai:no}))
 await act(async()=>fireEvent.click(ui.getByRole('menuitem',{name:'编辑'})))
 assert.equal((ui.getByRole('menuitem',{name:/撤销文档修改/}) as HTMLButtonElement).disabled,true)
 await act(async()=>useStore.getState().setValueAt(['a'],2))
 assert.equal((ui.getByRole('menuitem',{name:/撤销文档修改/}) as HTMLButtonElement).disabled,false)
 await act(async()=>fireEvent.click(ui.getByRole('menuitem',{name:/撤销文档修改/})))
 assert.match(useStore.getState().source,/a: 1/);cleanup()
})
test('browser download is initiated without falsely clearing dirty state', async () => {
 delete window.desktop
 useStore.getState().reset('a: 1\n');useStore.getState().setSource('a: 2\n')
 const old=dom.window.HTMLAnchorElement.prototype.click
 let downloaded=''
 dom.window.HTMLAnchorElement.prototype.click=function(){downloaded=this.download}
 try{assert.equal(await saveCurrent(),true);assert.equal(downloaded,'untitled.yaml');assert.equal(useStore.getState().dirty,true)}
 finally{dom.window.HTMLAnchorElement.prototype.click=old}
})
test('AI/programmatic full-file apply is its own undo step, not coalesced with typing', () => {
 useStore.getState().loadFile('/ai-undo.yaml','a: 1\n')
 useStore.getState().setSource('a: 12\n')
 const before=useStore.getState()
 assert.equal(before.applySource('a: 99\n',before.source,before.documentId),true)
 useStore.getState().undo();assert.equal(useStore.getState().source,'a: 12\n')
 useStore.getState().undo();assert.equal(useStore.getState().source,'a: 1\n')
})
test('Schema enum selection preserves numeric/string/null identity', async () => {
 useStore.getState().loadFile('/enum.yaml','value: 1\n')
 useStore.getState().setSchemaText('{"type":"object","properties":{"value":{"enum":[1,"1",null]}}}')
 const ui=render(React.createElement(FormPane))
 await act(async()=>fireEvent.change(ui.getByLabelText('Schema 枚举值'),{target:{value:'1'}}))
 assert.equal((useStore.getState().parsed as {value:unknown}).value,'1')
 await act(async()=>fireEvent.change(ui.getByLabelText('Schema 枚举值'),{target:{value:'2'}}))
 assert.equal((useStore.getState().parsed as {value:unknown}).value,null)
 cleanup();useStore.getState().setSchemaText('')
})

test('card form focus transaction undoes whole typed value after outline and shares keyboard/toolbar redo', async () => {
 const {OutlinePanel}=await import('../src/components/OutlinePanel')
 const {handleDocumentHistoryKey}=await import('../src/lib/historyKeys')
 const original='service:\n  name: ux-demo\n'
 useStore.getState().loadFile('/ux.yaml',original)
 const props={onOpenSearch(){},onOpenAi(){},onOpenSettings(){},onToggleOutline(){},outlineOpen:true,onOpenConvert(){},onOpenDiff(){}}
 const ui=render(React.createElement(React.Fragment,null,React.createElement(Toolbar,props),React.createElement(FormPane),React.createElement(OutlinePanel,{onClose(){}})))
 window.addEventListener('keydown',handleDocumentHistoryKey,true)
 try{
  let field=ui.getByDisplayValue('ux-demo')
  await act(async()=>fireEvent.focus(field))
  for(const value of ['u','ux-','ux-e','ux-ed','ux-edi','ux-edit','ux-edite','ux-edited'])await act(async()=>fireEvent.change(field,{target:{value}}))
  assert.equal(useStore.getState().past.length,1)
  await act(async()=>{fireEvent.blur(field);fireEvent.click(ui.container.querySelector('.outline-node')!)})
  await act(async()=>fireEvent.click(ui.getByTitle('撤销（Ctrl+Z）')))
  assert.equal(useStore.getState().source,original);assert.ok(ui.getByDisplayValue('ux-demo'))
  await act(async()=>fireEvent.click(ui.getByTitle('重做（Ctrl+Y）')))
  field=ui.getByDisplayValue('ux-edited')
  await act(async()=>{fireEvent.focus(field);fireEvent.change(field,{target:{value:'ux-next'}})})
  await act(async()=>fireEvent.keyDown(field,{key:'z',ctrlKey:true}))
  assert.ok(ui.getByDisplayValue('ux-edited'));assert.match(useStore.getState().source,/ux-edited/)
  await act(async()=>fireEvent.keyDown(field,{key:'z',ctrlKey:true,shiftKey:true}))
  assert.ok(ui.getByDisplayValue('ux-next'));assert.match(useStore.getState().source,/ux-next/)
  await act(async()=>fireEvent.keyDown(field,{key:'z',ctrlKey:true,isComposing:true}))
  assert.match(useStore.getState().source,/ux-next/)
 }finally{window.removeEventListener('keydown',handleDocumentHistoryKey,true);cleanup()}
})

test('field transactions respect other fields, source typing, save, document switch and import boundaries', () => {
 const store=useStore
 const original='a: first\nb: second\n'
 store.getState().loadFile('/boundaries.yaml',original)
 let token=store.getState().beginFieldEdit(['a'])
 store.getState().setFieldValue(['a'],'f',token);store.getState().setFieldValue(['a'],'finished',token)
 let other=store.getState().beginFieldEdit(['b'])
 assert.equal(store.getState().setFieldValue(['a'],'stale',token),false)
 store.getState().setFieldValue(['b'],'new',other);store.getState().setFieldValue(['b'],'newer',other)
 store.getState().undo();assert.equal((store.getState().parsed as {b:string}).b,'second')
 store.getState().undo();assert.equal(store.getState().source,original)
 token=store.getState().beginFieldEdit(['a']);store.getState().setFieldValue(['a'],'form',token)
 store.getState().setSource('a: source1\nb: second\n');store.getState().setSource('a: source2\nb: second\n')
 store.getState().undo();assert.equal((store.getState().parsed as {a:string}).a,'form')
 store.getState().undo();assert.equal(store.getState().source,original)
 token=store.getState().beginFieldEdit(['a']);store.getState().setFieldValue(['a'],'saved',token)
 store.getState().markSaved('/boundaries.yaml')
 assert.equal(store.getState().setFieldValue(['a'],'stale',token),false)
 token=store.getState().beginFieldEdit(['a']);store.getState().setFieldValue(['a'],'after-save',token)
 store.getState().undo();assert.equal(store.getState().dirty,false)
 store.getState().loadFile('/stream.yaml','a: first\n---\nb: second\n')
 token=store.getState().beginFieldEdit(['a']);store.getState().setFieldValue(['a'],'one',token)
 store.getState().setDocIndex(1);assert.equal(store.getState().setFieldValue(['a'],'stale',token),false)
 other=store.getState().beginFieldEdit(['b']);store.getState().setFieldValue(['b'],'two',other);store.getState().setFieldValue(['b'],'three',other)
 store.getState().undo();assert.match(store.getState().source,/a: one/);assert.match(store.getState().source,/b: second/)
 store.getState().importFile('new.yaml','b: imported\n');assert.equal(store.getState().setFieldValue(['b'],'stale',other),false)
 assert.equal(store.getState().source,'b: imported\n')
})

test('compact form input edits are grouped and a later refocus creates a separate undo step', async () => {
 const {FormCompactMode}=await import('../src/components/FormCompactMode')
 useStore.getState().loadFile('/compact.yaml','name: ux-demo\n')
 const ui=render(React.createElement(FormCompactMode))
 let field=ui.getByDisplayValue('ux-demo')
 await act(async()=>{fireEvent.focus(field);fireEvent.change(field,{target:{value:'ux-e'}})})
 await act(async()=>fireEvent.change(field,{target:{value:'ux-edited'}}))
 await act(async()=>fireEvent.blur(field))
 assert.equal(useStore.getState().past.length,1)
 field=ui.getByDisplayValue('ux-edited')
 await act(async()=>{fireEvent.focus(field);fireEvent.change(field,{target:{value:'next'}});fireEvent.blur(field)})
 await act(async()=>useStore.getState().undo());assert.ok(ui.getByDisplayValue('ux-edited'))
 await act(async()=>useStore.getState().undo());assert.ok(ui.getByDisplayValue('ux-demo'));cleanup()
})

test('diagnostic rows click and keyboard request exact source selection; unknown and stale positions never navigate', async () => {
 const source='one: 1\ntwo: 2\nthree: 3\nfour: 4\nmissing: *missing\n'
 useStore.getState().reset(source)
 const ui=render(React.createElement(TestPanel))
 const row=ui.getByRole('button',{name:/第 5 行.*Unresolved alias/})
 await act(async()=>fireEvent.click(row))
 let target=useStore.getState().sourceTarget!
 assert.equal(source.slice(target.from,target.to),'*missing');assert.equal(useStore.getState().source,source)
 const sequence=target.sequence
 await act(async()=>fireEvent.keyDown(row,{key:'Enter'}))
 assert.ok(useStore.getState().sourceTarget!.sequence>sequence)
 await act(async()=>fireEvent.keyDown(row,{key:' '}))
 assert.equal(useStore.getState().source,source)
 await act(async()=>useStore.getState().reset('a: &a [*a]\n'))
 assert.ok(ui.getByText('位置未知'));assert.equal(ui.queryByRole('button',{name:/循环/}),null)
 assert.equal(useStore.getState().navigateToSource({message:'unknown'},useStore.getState().source),false)
 assert.equal(useStore.getState().navigateToSource({message:'old',pos:[0,1]},source),false)
 assert.equal(useStore.getState().sourceTarget,null);cleanup()
})

test('Web has one download-copy action, no save-as menu duplication, both save shortcuts retain dirty state', async () => {
 const {MenuBar}=await import('../src/components/MenuBar');const {handleWebSaveKey,fileActionLabels}=await import('../src/lib/fileActions')
 delete window.desktop;useStore.getState().loadFile('/copy.yaml','a: 1\n');useStore.getState().setSource('a: 2\n')
 const no=()=>{},props={onOpenSearch:no,onOpenAi:no,onOpenSettings:no,onToggleOutline:no,outlineOpen:true,onOpenConvert:no,onOpenDiff:no}
 let copies=0;const old=dom.window.HTMLAnchorElement.prototype.click;dom.window.HTMLAnchorElement.prototype.click=function(){copies++}
 window.addEventListener('keydown',handleWebSaveKey)
 const ui=render(React.createElement(React.Fragment,null,React.createElement(Toolbar,props),React.createElement(MenuBar,{outline:no,search:no,convert:no,diff:no,settings:no,ai:no})))
 try{
  assert.equal(ui.queryByRole('button',{name:'保存'}),null)
  await act(async()=>fireEvent.click(ui.getByRole('button',{name:'下载副本'})))
  assert.equal(copies,1);assert.equal(useStore.getState().dirty,true)
  await act(async()=>fireEvent.click(ui.getByTitle('工具：转换 / 导入 / 导出 / Diff')))
  assert.equal(ui.queryByText(/另存为/),null)
  await act(async()=>fireEvent.click(ui.getByRole('menuitem',{name:'文件'})))
  assert.equal(ui.queryByRole('menuitem',{name:/另存为/}),null)
  assert.ok(ui.getByRole('menuitem',{name:/下载副本/}));assert.match(fileActionLabels().help,/Ctrl\+Shift\+S/)
  await act(async()=>fireEvent.keyDown(window,{key:'s',ctrlKey:true}))
  await act(async()=>fireEvent.keyDown(window,{key:'s',ctrlKey:true,shiftKey:true}))
  assert.equal(copies,3);assert.equal(useStore.getState().dirty,true);assert.equal(useStore.getState().filePath,'/copy.yaml')
 }finally{window.removeEventListener('keydown',handleWebSaveKey);dom.window.HTMLAnchorElement.prototype.click=old;cleanup()}
})

test('Electron keeps distinct save and save-as actions and does not use Web save shortcut handler', async () => {
 const {handleWebSaveKey,fileActionLabels}=await import('../src/lib/fileActions')
 useStore.getState().loadFile('/native.yaml','a: 1\n');useStore.getState().setSource('a: 2\n')
 let saved=0,as=0
 window.desktop={isDesktop:true,saveFile:async()=>{saved++;return {ok:true,path:'/native.yaml'}},saveFileAs:async()=>{as++;return {ok:true,path:'/other.yaml'}}} as never
 const no=()=>{},props={onOpenSearch:no,onOpenAi:no,onOpenSettings:no,onToggleOutline:no,outlineOpen:true,onOpenConvert:no,onOpenDiff:no}
 const ui=render(React.createElement(Toolbar,props))
 try{
  assert.ok(ui.getByRole('button',{name:'保存'}));assert.equal(ui.queryByRole('button',{name:'下载副本'}),null)
  await act(async()=>fireEvent.click(ui.getByRole('button',{name:'保存'})))
  assert.equal(saved,1);assert.equal(useStore.getState().dirty,false)
  await act(async()=>fireEvent.click(ui.getByTitle('工具：转换 / 导入 / 导出 / Diff')))
  await act(async()=>fireEvent.click(ui.getByText('另存为（Ctrl+Shift+S）')))
  assert.equal(as,1);assert.equal(useStore.getState().filePath,'/other.yaml')
  const event=new dom.window.KeyboardEvent('keydown',{key:'s',ctrlKey:true,cancelable:true});handleWebSaveKey(event as unknown as KeyboardEvent)
  assert.equal(event.defaultPrevented,false);assert.equal(saved,1);assert.match(fileActionLabels().help,/另存为/)
 }finally{delete window.desktop;cleanup()}
})

test('error activation drives a real CodeMirror selection and preserves full multidocument source', async () => {
 const {YamlSourceEditor}=await import('../src/components/YamlSourceEditor')
 const {editorViewRef}=await import('../src/lib/editorView')
 const geometry={left:0,right:0,top:0,bottom:0,width:0,height:0,x:0,y:0,toJSON(){return {}}}
 dom.window.Range.prototype.getClientRects=()=>[] as unknown as DOMRectList
 dom.window.Range.prototype.getBoundingClientRect=()=>geometry as DOMRect
 Object.assign(globalThis,{ResizeObserver:class {observe(){} unobserve(){} disconnect(){}}})
 const source='first: 1\n---\n# second\nok: true\nmissing: *missing\n'
 useStore.getState().loadFile('/error-stream.yaml',source)
 const ui=render(React.createElement(React.Fragment,null,React.createElement(YamlSourceEditor),React.createElement(TestPanel),React.createElement(FormPane)))
 try{
  await act(async()=>fireEvent.click(ui.getByRole('button',{name:/第 5 行.*Unresolved alias/})))
  await act(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))})
  const view=editorViewRef.current!
  assert.ok(view);assert.equal(view.state.sliceDoc(view.state.selection.main.from,view.state.selection.main.to),'*missing')
  assert.equal(view.state.doc.toString(),source);assert.equal(useStore.getState().source,source)
  assert.equal(useStore.getState().docIndex,1)
  assert.ok(ui.getByText('第 5 行错误'))
  assert.match(ui.getByText(/表单编辑已暂停/).textContent||'',/第 5 行/)
 }finally{cleanup()}
 assert.equal(editorViewRef.current,null)
})

test('card form rows place a fixed type column before the name and keep counts with the name', async () => {
 useStore.getState().reset('service:\n  name: ux-demo\n  tags:\n    - first\n')
 const ui=render(React.createElement(FormPane))
 try{
  const rowRoles=(el:Element)=>[...el.children].map(child=>{
   if(child.classList.contains('entry-lead'))return 'lead'
   if(child.classList.contains('entry-identity'))return 'identity'
   if(child.classList.contains('inline-value'))return 'value'
   if(child.classList.contains('entry-del')||child.classList.contains('item-tools'))return 'actions'
   return child.className
  })
  const leadRoles=(el:Element)=>[...el.children].map(child=>{
   if(child.classList.contains('entry-select'))return 'select'
   if(child.classList.contains('drag-handle'))return 'drag'
   if(child.classList.contains('collapse-btn')||child.classList.contains('collapse-spacer'))return 'expand'
   if(child.classList.contains('type-badge'))return 'type'
   return child.className
  })
  const serviceHead=within(ui.container).getByDisplayValue('service').closest('.entry-head')
  assert.ok(serviceHead)
  assert.deepEqual(rowRoles(serviceHead),['lead','identity','actions'])
  const serviceLead=serviceHead.querySelector('.entry-lead')
  const serviceIdentity=serviceHead.querySelector('.entry-identity')
  assert.ok(serviceLead);assert.ok(serviceIdentity)
  assert.deepEqual(leadRoles(serviceLead),['select','drag','expand','type'])
  assert.equal((serviceIdentity.querySelector('.key-input') as HTMLInputElement).value,'service')
  assert.match(serviceIdentity.textContent||'',/2\s*字段/)
  assert.equal(serviceIdentity.querySelector('.type-badge'),null)
  assert.equal(serviceLead.nextElementSibling,serviceIdentity)
  assert.ok(serviceLead.querySelector('.type-badge')===serviceLead.lastElementChild)
  assert.equal((serviceLead.querySelector('.type-badge') as HTMLSelectElement).value,'object')

  const nameHead=within(ui.container).getByDisplayValue('name').closest('.entry-head')
  assert.ok(nameHead)
  assert.deepEqual(rowRoles(nameHead),['lead','identity','value','actions'])
  const nameInput=within(ui.container).getByDisplayValue('name')
  const valueInput=within(ui.container).getByDisplayValue('ux-demo')
  const typeSelect=nameHead.querySelector('.type-badge') as HTMLSelectElement
  assert.ok(typeSelect.compareDocumentPosition(nameInput)&Node.DOCUMENT_POSITION_FOLLOWING)
  assert.ok(nameInput.compareDocumentPosition(valueInput)&Node.DOCUMENT_POSITION_FOLLOWING)
  assert.equal(Boolean(nameInput.compareDocumentPosition(typeSelect)&Node.DOCUMENT_POSITION_FOLLOWING)&&Boolean(typeSelect.compareDocumentPosition(valueInput)&Node.DOCUMENT_POSITION_FOLLOWING),false)
  assert.equal(typeSelect.value,'string')

  const itemHead=ui.container.querySelector('.index-badge')?.closest('.entry-head')
  assert.ok(itemHead)
  assert.deepEqual(rowRoles(itemHead),['lead','identity','value','actions'])
  assert.deepEqual(leadRoles(itemHead.querySelector('.entry-lead')!),['select','drag','expand','type'])
  const itemIdentity=itemHead.querySelector('.entry-identity')
  assert.ok(itemIdentity?.textContent?.includes('#1'))
  assert.equal(itemIdentity.querySelector('.type-badge'),null)
  const itemType=itemHead.querySelector('.type-badge')
  const itemIndex=itemHead.querySelector('.index-badge')
  const itemValue=within(ui.container).getByDisplayValue('first')
  assert.ok(itemType && itemIndex && itemType.compareDocumentPosition(itemIndex)&Node.DOCUMENT_POSITION_FOLLOWING)
  assert.ok(itemIndex.compareDocumentPosition(itemValue)&Node.DOCUMENT_POSITION_FOLLOWING)

  await act(async()=>fireEvent.change(typeSelect,{target:{value:'number'}}))
  assert.match(useStore.getState().source,/name:\s*0/)
  const css=(await import('node:fs')).readFileSync(new URL('../src/App.css',import.meta.url),'utf8')
  assert.match(css,/\.entry-head \.type-badge[\s\S]{0,220}width:\s*40px/)
  assert.match(css,/\.entry-lead[\s\S]{0,280}flex-wrap:\s*nowrap/)
  assert.match(css,/\.entry-lead[\s\S]{0,280}flex:\s*0 0 auto/)
  assert.match(css,/\.entry-identity \.key-input[\s\S]{0,160}field-sizing:\s*content/)
  assert.match(css,/@media\(max-width:560px\)[\s\S]{0,900}grid-template-columns:max-content minmax\(0,1fr\) auto/)
  assert.match(css,/@media\(max-width:560px\)[\s\S]{0,1200}\.entry-head\.entry-scalar \.inline-value\{grid-column:1\/-1;grid-row:2/)
  assert.match(css,/@media\(max-width:560px\)[\s\S]{0,1400}\.entry-del,\.item-tools\{grid-column:3;grid-row:1;margin-left:0\}/)
 }finally{cleanup()}
})

test('card form type change keeps a representable port value and explains unsafe conversions', async () => {
 useStore.getState().reset('service:\n  port: 8080\n  metadata:\n    owner: demo\n')
 useStore.getState().setNotice('')
 const ui=render(React.createElement(FormPane))
 try{
  const portHead=within(ui.container).getByDisplayValue('port').closest('.entry-head')
  const typeSelect=portHead.querySelector('.type-badge')
  assert.equal(typeSelect.value,'number')
  await act(async()=>fireEvent.change(typeSelect,{target:{value:'string'}}))
  assert.match(useStore.getState().source,/port:\s*["']?8080["']?/)
  assert.equal(useStore.getState().notice,'')
  assert.equal(within(ui.container).getByDisplayValue('8080').getAttribute('value')||within(ui.container).getByDisplayValue('8080').value,'8080')
  await act(async()=>fireEvent.change(typeSelect,{target:{value:'number'}}))
  assert.match(useStore.getState().source,/port:\s*8080\b/)
  await act(async()=>fireEvent.change(typeSelect,{target:{value:'boolean'}}))
  assert.match(useStore.getState().source,/port:\s*(?:false|关)/)
  assert.match(useStore.getState().notice,/无法安全转为开关/)
  const meta=within(ui.container).getByDisplayValue('metadata')
  assert.equal(meta.value,'metadata')
  assert.match(meta.getAttribute('title')||'',/metadata/)
 }finally{cleanup()}
})
