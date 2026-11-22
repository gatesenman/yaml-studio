import { pathKey } from './locate'
import { kindOf, type Path, type ValueKind } from './yaml'

export interface Match {
  /** Full path from the document root to this node. */
  path: Path
  /** Human-readable path label, e.g. `app.tags[0]`. */
  label: string
  /** The key name (last path segment) or array index display. */
  keyLabel: string
  /** The current value at this path. */
  value: unknown
  kind: ValueKind
  /** Whether the query matched the key, the value, or both. */
  hit: 'key' | 'value' | 'both'
}

export interface SearchOpts {
  keys: boolean
  values: boolean
  /** Only return scalar (string/number/boolean/null) matches. */
  scalarsOnly?: boolean
}

function pathLabel(path: Path): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)) out += out ? `.${seg}` : seg
    else out += `[${JSON.stringify(seg)}]`
  }
  return out || '(根)'
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value)
}

/**
 * Recursively walk the parsed YAML tree and collect every node whose key
 * and/or value contains `query` (case-insensitive). With an empty query, all
 * nodes are returned so the panel can act as a full element browser.
 */
export function searchYaml(
  parsed: unknown,
  query: string,
  opts: SearchOpts,
): Match[] {
  const q = query.trim().toLowerCase()
  const out: Match[] = []

  const visit = (value: unknown, path: Path, keyLabel: string) => {
    const kind = kindOf(value)
    const isScalar = kind !== 'object' && kind !== 'array'

    if (path.length > 0) {
      const keyHit =
        opts.keys && q !== '' && keyLabel.toLowerCase().includes(q)
      const valueHit =
        opts.values &&
        q !== '' &&
        isScalar &&
        scalarText(value).toLowerCase().includes(q)
      const include =
        q === '' ? !opts.scalarsOnly || isScalar : keyHit || valueHit
      if (include && (!opts.scalarsOnly || isScalar)) {
        out.push({
          path,
          label: pathLabel(path),
          keyLabel,
          value,
          kind,
          hit: keyHit && valueHit ? 'both' : keyHit ? 'key' : 'value',
        })
      }
    }

    if (kind === 'object') {
      const obj = value as Record<string, unknown>
      for (const k of Object.keys(obj)) visit(obj[k], [...path, k], k)
    } else if (kind === 'array') {
      const arr = value as unknown[]
      arr.forEach((item, i) => visit(item, [...path, i], `#${i + 1}`))
    }
  }

  visit(parsed, [], '')
  return out
}

export function isAliasPath(path: Path, aliases: Record<string,string>): boolean {
 for(let length=1;length<=path.length;length++)if(Object.hasOwn(aliases,pathKey(path.slice(0,length))))return true
 return false
}
