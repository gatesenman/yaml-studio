const fs=require('node:fs')
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process')
test('production Web package serves HTML/assets and rejects traversal / writes',async () => {
 const child=spawn(process.execPath,['scripts/serve-web.cjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']})
 try {
  const address=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Server did not start')),5000)
   child.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0])}})
   child.once('error',reject)
  })
  const response=await fetch(address);assert.equal(response.status,200)
  const html=await response.text();assert.match(html,/Content-Security-Policy/)
  assert.match(html,/rel="icon"[^>]+favicon\.svg/);const icon=await fetch(`${address}/favicon.svg`);assert.equal(icon.status,200);assert.match(icon.headers.get('content-type'),/image\/svg\+xml/)
  const asset=html.match(/src="([^"]+\.js)"/)[1]
  const script=await fetch(`${address}/${asset.replace(/^\.\//,'')}`);assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/)
  const worker=fs.readdirSync('dist/assets').find(name=>name.startsWith('regex.worker-'));assert.ok(worker);const wr=await fetch(`${address}/assets/${worker}`);assert.equal(wr.status,200);assert.match(wr.headers.get('content-type'),/javascript/)
  assert.equal((await fetch(`${address}/%2e%2e%2fpackage.json`)).status,404)
  assert.equal((await fetch(address,{method:'POST',body:'test'})).status,405)
 } finally {child.kill();await new Promise(resolve=>child.once('exit',resolve))}
})
