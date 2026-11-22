import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const security = require('../electron/security.cjs')
test('Electron rejects dangerous protocols, oversized content and foreign URLs', () => {
 assert.equal(security.allowedExternal('javascript:alert(1)'),false)
 assert.equal(security.allowedExternal('file:///etc/passwd'),false)
 assert.equal(security.allowedExternal('https://example.com'),true)
 assert.equal(security.validContent('a'.repeat(2*1024*1024+1)),false)
 assert.equal(security.validSenderURL('https://evil.invalid','file:///app/index.html'),false)
})
test('Electron IPC file lifecycle, disk conflict, close guard and sender isolation',async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'yamlstudio-test-'))
 const source = path.join(dir,'original.yaml'), other = path.join(dir,'other.yaml'), saved = path.join(dir,'saved.yaml')
 fs.writeFileSync(source,'a: 1\n',{mode:0o600});fs.writeFileSync(other,'secret: true\n')
 const app = new EventEmitter() as any
 Object.assign(app,{getPath:()=>dir,requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),quit(){}})
 const handlers = new Map<string,Function>(), ipc = new EventEmitter() as any
 ipc.handle=(name:string,fn:Function)=>handlers.set(name,fn)
 let win:any, dialogSave=saved, conflictChoice=0, messageHandler: null | (()=>Promise<{response:number}>) = null
 class FakeWindow extends EventEmitter {
  webContents:any; closed=false
  // oxlint-disable-next-line typescript/no-this-alias
  constructor() {super();win=this; const wc=new EventEmitter() as any;wc.mainFrame={url:''};wc.send=(name:string,payload:unknown)=>wc.emit(`sent:${name}`,payload);wc.setWindowOpenHandler=()=>{};wc.session={setPermissionRequestHandler(){}};this.webContents=wc}
  loadFile(p:string){this.webContents.mainFrame.url=new URL(`file://${p}`).href}
  show(){} isMaximized(){return false} close(){let blocked=false;this.emit('close',{preventDefault(){blocked=true}});this.closed=!blocked}
  static getAllWindows(){return [win]}
 }
 const electron={app,BrowserWindow:FakeWindow,ipcMain:ipc,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[source]}),showSaveDialog:async()=>({canceled:false,filePath:dialogSave}),showMessageBox:async()=>messageHandler?messageHandler():({response:conflictChoice})},Menu:{setApplicationMenu(){},buildFromTemplate:(v:unknown)=>v},shell:{openExternal:async()=>{}}}
 const project=path.resolve('electron')
 const context=vm.createContext({require:(name:string)=>name==='electron'?electron:name==='./security.cjs'?security:require(name),__dirname:project,process:{env:{},argv:[],pid:process.pid,platform:'linux'},URL,Buffer,console,setInterval,clearInterval})
 vm.runInContext(fs.readFileSync(path.join(project,'main.cjs'),'utf8'),context)
 await Promise.resolve()
 const event={sender:win.webContents,senderFrame:win.webContents.mainFrame}
 const call=(name:string,payload?:unknown)=>handlers.get(name)!(event,payload)
 assert.throws(()=>handlers.get('renderer-ready')!({sender:{},senderFrame:{url:'https://evil.invalid'}}),/不可信/)
 await call('renderer-ready')
 let payload:any;win.webContents.on('sent:open-file',(p:unknown)=>payload=p)
 await call('open-dialog'); assert.equal(payload.path,source)
 ipc.emit('document-state',event,{dirty:false,path:source})
 const denied=await call('save-file',{path:other,content:'overwrite',expected:'secret: true\n'})
 assert.equal(denied.ok,false);assert.equal(fs.readFileSync(other,'utf8'),'secret: true\n')
 const ok=await call('save-file',{path:source,content:'a: 2\n',expected:'a: 1\n'})
 assert.equal(ok.ok,true);assert.equal(fs.readFileSync(source,'utf8'),'a: 2\n')
 assert.equal(fs.statSync(source).mode & 0o777,0o600)
 fs.writeFileSync(source,'external: changed\n')
 const conflict=await call('save-file',{path:source,content:'mine',expected:'a: 2\n'})
 assert.equal(conflict.canceled,true);assert.equal(fs.readFileSync(source,'utf8'),'external: changed\n')
 conflictChoice=1
 assert.equal((await call('save-file',{path:source,content:'mine',expected:'a: 2\n'})).ok,true)
 assert.equal((await call('save-file-as',{content:'new: true\n',suggestedName:'new.yaml'})).ok,true)
 assert.equal(fs.readFileSync(saved,'utf8'),'new: true\n')
 const link=path.join(dir,'linked.yaml');fs.symlinkSync(other,link);dialogSave=link
 const symlink=await call('save-file-as',{content:'must-not-overwrite',suggestedName:'linked.yaml'})
 assert.equal(symlink.ok,false);assert.equal(fs.lstatSync(link).isSymbolicLink(),true)
 assert.equal(fs.readFileSync(other,'utf8'),'secret: true\n');dialogSave=saved
 assert.equal(fs.readdirSync(dir).filter(name=>name.endsWith('.yamlstudio-tmp')).length,0)
 let settle!: (value:{response:number})=>void
 messageHandler=()=>new Promise(resolve=>{settle=resolve})
 fs.writeFileSync(saved,'external: one\n')
 const pending=call('save-file',{path:saved,content:'stale',expected:'new: true\n'})
 const concurrent=await call('save-file',{path:saved,content:'concurrent',expected:'new: true\n'})
 assert.equal(concurrent.ok,false);assert.match(concurrent.error,/保存正在进行/)
 fs.writeFileSync(saved,'external: two\n');settle({response:1})
 const changed=await pending;assert.equal(changed.ok,false);assert.match(changed.error,/再次变化/)
 assert.equal(fs.readFileSync(saved,'utf8'),'external: two\n')
 const replaced=call('save-file',{path:saved,content:'stale',expected:'new: true\n'})
 ipc.emit('document-state',event,{dirty:true,path:null});settle({response:1})
 assert.match((await replaced).error,/工作区已变化/)
 assert.equal(fs.readFileSync(saved,'utf8'),'external: two\n')
 messageHandler=null
 ipc.emit('document-state',event,{dirty:true,path:saved})
 win.close();assert.equal(win.closed,false)
 ipc.emit('confirm-close',event);assert.equal(win.closed,true)
 app.emit('window-all-closed')
 fs.rmSync(dir,{recursive:true,force:true})
})
