import { kindOf } from './yaml'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Lightweight, line-based YAML syntax highlighter producing HTML spans. */
function highlightYaml(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('#')
      let code = line
      let trailing = ''
      if (comment >= 0) {
        // Only treat as comment when not inside quotes (best-effort).
        const before = line.slice(0, comment)
        const quotes = (before.match(/["']/g) ?? []).length
        if (quotes % 2 === 0) {
          code = before
          trailing = `<span class="c">${escapeHtml(line.slice(comment))}</span>`
        }
      }
      let html = escapeHtml(code)
      // key:
      html = html.replace(
        /^(\s*(?:-\s*)?)([A-Za-z0-9_.$-]+)(:)(\s|$)/,
        (_m, pre, key, colon, sp) =>
          `${pre}<span class="k">${key}</span>${colon}${sp}`,
      )
      // list dash
      html = html.replace(/^(\s*)(-)(\s)/, '$1<span class="d">$2</span>$3')
      return `<span class="ln">${html}${trailing}</span>`
    })
    .join('\n')
}

/** Render the parsed value as a read-only nested card tree. */
function renderTree(value: unknown): string {
  const kind = kindOf(value)
  if (kind === 'object') {
    const obj = value as Record<string, unknown>
    const rows = Object.keys(obj)
      .map(
        (k) =>
          `<div class="row"><span class="rk">${escapeHtml(k)}</span>${renderValue(obj[k])}</div>`,
      )
      .join('')
    return `<div class="grp">${rows || '<div class="empty">（空）</div>'}</div>`
  }
  if (kind === 'array') {
    const arr = value as unknown[]
    const rows = arr
      .map(
        (item, i) =>
          `<div class="row"><span class="ri">#${i + 1}</span>${renderValue(item)}</div>`,
      )
      .join('')
    return `<div class="grp">${rows || '<div class="empty">（空列表）</div>'}</div>`
  }
  return renderValue(value)
}

function renderValue(value: unknown): string {
  const kind = kindOf(value)
  if (kind === 'object' || kind === 'array') {
    const count =
      kind === 'array'
        ? `${(value as unknown[]).length} 项`
        : `${Object.keys(value as object).length} 字段`
    return `<span class="badge badge-${kind}">${kind === 'array' ? '列表' : '分组'} · ${count}</span>${renderTree(value)}`
  }
  if (kind === 'boolean')
    return `<span class="val bool">${value ? 'true' : 'false'}</span>`
  if (kind === 'number') return `<span class="val num">${escapeHtml(String(value))}</span>`
  if (kind === 'null') return `<span class="val null">~</span>`
  return `<span class="val str">${escapeHtml(String(value))}</span>`
}

/** Build a complete standalone HTML document for the current YAML. */
export function exportToHtml(
  fileName: string,
  source: string,
  parsed: unknown,
): string {
  const now = new Date().toLocaleString('zh-CN')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(fileName)} — YAML Studio 导出</title>
<style>
:root{--bg:#0d1117;--bg2:#161b22;--bd:#2d333b;--tx:#e6edf3;--dim:#8b949e;--ac:#6e8bff;--k:#79c0ff;--str:#a5d6ff;--num:#d2a8ff;--bool:#3fb950;--c:#6b7785;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font-family:'Segoe UI',-apple-system,Roboto,Arial,sans-serif;}
header{padding:18px 24px;border-bottom:1px solid var(--bd);background:var(--bg2);}
header h1{margin:0;font-size:17px}
header .meta{color:var(--dim);font-size:12px;margin-top:4px}
.wrap{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--bd);min-height:calc(100vh - 70px)}
.pane{background:var(--bg);padding:16px 20px;overflow:auto}
.pane h2{font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin:0 0 12px}
pre{margin:0;font-family:'Cascadia Code','Consolas',monospace;font-size:13px;line-height:1.6}
.ln{display:block;white-space:pre-wrap}
.k{color:var(--k)}.d{color:var(--num)}.c{color:var(--c);font-style:italic}
.grp{border-left:2px solid var(--bd);margin:4px 0 4px 8px;padding-left:10px}
.row{display:flex;align-items:flex-start;gap:8px;padding:3px 0;flex-wrap:wrap}
.rk{color:var(--k);font-weight:600;font-size:13px}
.ri{color:var(--num);font-size:12px}
.val{font-size:13px}.val.str{color:var(--str)}.val.num{color:var(--num)}.val.bool{color:var(--bool)}.val.null{color:var(--c)}
.badge{font-size:11px;padding:1px 7px;border-radius:10px;background:var(--bg2);border:1px solid var(--bd);color:var(--dim)}
.empty{color:var(--c);font-size:12px}
footer{padding:10px 24px;color:var(--c);font-size:11px;border-top:1px solid var(--bd);background:var(--bg2)}
</style>
</head>
<body>
<header>
<h1>${escapeHtml(fileName)}</h1>
<div class="meta">由 YAML Studio 导出 · ${escapeHtml(now)} · 只读视图</div>
</header>
<div class="wrap">
<div class="pane"><h2>结构视图</h2>${renderTree(parsed)}</div>
<div class="pane"><h2>YAML 源码</h2><pre>${highlightYaml(source)}</pre></div>
</div>
<footer>Generated by YAML Studio</footer>
</body>
</html>`
}
