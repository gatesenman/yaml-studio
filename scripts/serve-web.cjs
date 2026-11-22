// No dependencies; binds to loopback only. Ctrl+C to stop.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '../dist')
const port = Number(process.env.PORT || 4173)
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }
if (!fs.existsSync(path.join(root,'index.html'))) { console.error('未找到 dist，请先运行 npm run build，或解压完整 Web 运行包。'); process.exit(1) }
const server=http.createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return}
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    const target=path.resolve(root,`.${pathname==='/'?'/index.html':pathname}`)
    if (!target.startsWith(root+path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {res.writeHead(404);res.end('Not Found');return}
    res.writeHead(200,{'Content-Type':mime[path.extname(target)] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'})
    if(req.method==='HEAD')res.end();else fs.createReadStream(target).pipe(res)
  } catch {res.writeHead(400);res.end('Bad Request')}
})
server.on('error',error=>{console.error(`启动失败：${error.message}。端口被占用时可设置环境变量 PORT。`);process.exit(1)})
server.listen(port,'127.0.0.1',()=>console.log(`YAML Studio：http://127.0.0.1:${server.address().port}\n仅本机访问；按 Ctrl+C 停止。`))
