import { kindOf, type Path, type ValueKind } from './yaml'

export interface OutlineNode {
  path: Path
  /** Display label: object key, or `#index` for array items. */
  label: string
  kind: ValueKind
  depth: number
  /** Child count for containers (0 for scalars). */
  count: number
  /** Compact scalar preview shown to the right of the label. */
  preview: string
}

function preview(value: unknown, kind: ValueKind): string {
  if (kind === 'object') return `${Object.keys(value as object).length} 字段`
  if (kind === 'array') return `${(value as unknown[]).length} 项`
  if (kind === 'null') return '~'
  if (kind === 'boolean') return String(value)
  const s = String(value)
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/** Flatten the parsed tree into an ordered outline (depth-first). */
export function buildOutline(parsed: unknown): OutlineNode[] {
  const out: OutlineNode[] = []
  const visit = (value: unknown, path: Path, label: string, depth: number) => {
    const kind = kindOf(value)
    if (path.length > 0) {
      out.push({
        path,
        label,
        kind,
        depth,
        count:
          kind === 'object'
            ? Object.keys(value as object).length
            : kind === 'array'
              ? (value as unknown[]).length
              : 0,
        preview: preview(value, kind),
      })
    }
    if (kind === 'object') {
      const obj = value as Record<string, unknown>
      for (const k of Object.keys(obj)) {
        visit(obj[k], [...path, k], k, depth + 1)
      }
    } else if (kind === 'array') {
      ;(value as unknown[]).forEach((item, i) => {
        visit(item, [...path, i], `#${i + 1}`, depth + 1)
      })
    }
  }
  visit(parsed, [], '', -1)
  return out
}
