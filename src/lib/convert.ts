import { stringify as yamlStringify } from 'yaml'
import { parse } from './yaml'

/** Convert YAML source text to pretty-printed JSON. */
export function yamlToJson(src: string): { json: string; error: string | null } {
  const { value, error } = parse(src)
  if (error) return { json: '', error: error.message }
  try {
    return { json: JSON.stringify(value ?? null, null, 2), error: null }
  } catch (e) {
    return { json: '', error: (e as Error).message }
  }
}

/** Convert JSON text to YAML source. */
export function jsonToYaml(jsonText: string): { yaml: string; error: string | null } {
  try {
    const obj = JSON.parse(jsonText)
    const yaml=yamlStringify(obj, {indent:2,lineWidth:0})
    const checked=parse(yaml)
    if(checked.error)return {yaml:'',error:checked.error.message}
    return {yaml,error:null}
  } catch (e) {
    return { yaml: '', error: (e as Error).message }
  }
}

/** Coerce a raw `.env` / `.properties` value into a scalar (bool/number/string). */
function coerce(raw: string): unknown {
  const t = raw.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t !== '' && /^-?(?:0|[1-9]\d*)(\.\d+)?$/.test(t) && Number.isFinite(Number(t)) && (!Number.isInteger(Number(t)) || Number.isSafeInteger(Number(t)))) return Number(t)
  // Strip matching surrounding quotes.
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1)
  }
  return raw
}

/**
 * Parse `.env` style text (`KEY=VALUE`, `#` comments) into a flat object and
 * return it as YAML.
 */
export function envToYaml(text: string): string {
  const obj: Record<string, unknown> = Object.create(null)
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const withoutExport = trimmed.replace(/^export\s+/, '')
    const eq = withoutExport.indexOf('=')
    if (eq < 0) throw new Error(`不支持的 .env 行：${trimmed}`)
    const key = withoutExport.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.hasOwn(obj,key)) throw new Error(`无效或重复的 .env 键：${key}`)
    const raw=withoutExport.slice(eq+1).trim()
    if ((raw.startsWith('"') && !raw.endsWith('"')) || (raw.startsWith("'") && !raw.endsWith("'"))) throw new Error('引号未闭合，不支持多行 .env 值')
    obj[key] = coerce(withoutExport.slice(eq + 1))
  }
  return yamlStringify(obj, { indent: 2, lineWidth: 0 })
}

/**
 * Parse Java `.properties` text. Dotted keys (`a.b.c=1`) become nested maps,
 * `#`/`!` are comments, and `=` or `:` separates key from value.
 */
export function propertiesToYaml(text: string): string {
  const root: Record<string, unknown> = Object.create(null)
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
    const m = /^([^=:]+)[=:](.*)$/.exec(trimmed)
    if (!m || trimmed.includes('\\')) throw new Error('仅支持普通 a.b=值 格式；不支持转义、续行或无分隔符的 properties 行')
    const key = m[1].trim()
    const value = coerce(m[2])
    const parts = key.split('.')
    if(parts.some(p=>!p))throw new Error('properties 路径不能有空字段')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]
      if (Object.hasOwn(node,p) && (typeof node[p] !== 'object' || node[p] === null)) throw new Error(`路径冲突：${key}`)
      if (!Object.hasOwn(node,p)) node[p] = Object.create(null)
      node = node[p] as Record<string, unknown>
    }
    if(Object.hasOwn(node,parts[parts.length-1]))throw new Error(`重复或冲突的路径：${key}`)
    node[parts[parts.length - 1]] = value
  }
  return yamlStringify(root, { indent: 2, lineWidth: 0 })
}
