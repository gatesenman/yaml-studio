import { sourceLimitReason } from './limits'
import {
  parseDocument,
  LineCounter,
  isMap,
  isSeq,
  isScalar,
  isAlias,
  type ParsedNode,
} from 'yaml'
import type { Path } from './yaml'

/** A source-text location for a path: byte offsets + 1-based line range. */
export interface Loc {
  from: number
  to: number
  startLine: number
  endLine: number
}

/** Stable string key for a path, used to compare / index paths. */
export function pathKey(path: Path | null): string {
  if (!path) return ''
  return JSON.stringify(path)
}

export interface LocMap {
  /** path key -> source location */
  byPath: Map<string, Loc>
  /** deepest path whose range contains the given offset */
  offsetToPath: (offset: number) => Path | null
  /** total number of source lines */
  lineCount: number
}

/**
 * Build a bidirectional map between form paths and source-text positions by
 * walking the parsed YAML document and reading each node's `.range`.
 */
export function buildLocMap(src: string): LocMap {
  if(sourceLimitReason(src))return {byPath:new Map(),offsetToPath:()=>null,lineCount:1}
  const lc = new LineCounter()
  let doc:ReturnType<typeof parseDocument>
  try{doc=parseDocument(src,{lineCounter:lc,keepSourceTokens:false})}catch{return {byPath:new Map(),offsetToPath:()=>null,lineCount:1}}
  const byPath = new Map<string, Loc>()
  const entries: { from: number; to: number; path: Path }[] = []

  const toLoc = (from: number, to: number): Loc => {
    const a = lc.linePos(from)
    const b = lc.linePos(Math.max(from, to - 1))
    return { from, to, startLine: a.line, endLine: b.line }
  }

  const add = (path: Path, from: number, to: number) => {
    const loc = toLoc(from, to)
    byPath.set(pathKey(path), loc)
    entries.push({ from, to, path })
  }

  const visit = (node: ParsedNode | null, path: Path) => {
    if (!node) return
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = pair.key
        const keyName = isScalar(key) ? String(key.value) : String(key)
        const childPath: Path = [...path, keyName]
        if (!key?.range) continue
        const from = key.range[0]
        const value = pair.value
        const to = value?.range ? value.range[2] : key.range[2]
        add(childPath, from, to)
        visit(value, childPath)
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => {
        const childPath: Path = [...path, i]
        const n = item as ParsedNode | null
        if (n && n.range) add(childPath, n.range[0], n.range[2])
        visit(n, childPath)
      })
    }
  }

  try{visit(doc.contents as ParsedNode | null,[])}catch{return {byPath:new Map(),offsetToPath:()=>null,lineCount:1}}

  const offsetToPath = (offset: number): Path | null => {
    let best: { size: number; path: Path } | null = null
    for (const e of entries) {
      if (offset >= e.from && offset <= e.to) {
        const size = e.to - e.from
        if (!best || size < best.size) best = { size, path: e.path }
      }
    }
    return best ? best.path : null
  }

  return { byPath, offsetToPath, lineCount: lc.lineStarts.length || 1 }
}

export interface AnchorMeta {
  /** path key -> anchor name declared at that node (`&name`). */
  anchors: Record<string, string>
  /** path key -> referenced anchor name for alias nodes (`*name`). */
  aliases: Record<string, string>
  /** anchor name -> the path where it is declared (for alias jump-to). */
  byName: Record<string, Path>
  /** every distinct anchor name in the document. */
  names: string[]
}

/**
 * Find every anchor (`&name`) and alias (`*name`) in the document and the form
 * paths they sit at, so the form can badge them.
 */
export function analyzeAnchors(src: string): AnchorMeta {
  if(sourceLimitReason(src))return {anchors:{},aliases:{},byName:{},names:[]}
  const doc = parseDocument(src, { keepSourceTokens: false })
  const anchors: Record<string, string> = {}
  const aliases: Record<string, string> = {}
  const byName: Record<string, Path> = Object.create(null)
  const names = new Set<string>()

  const note = (node: unknown, path: Path) => {
    const n = node as { anchor?: string } | null
    if (n && typeof n.anchor === 'string' && n.anchor) {
      anchors[pathKey(path)] = n.anchor
      byName[n.anchor] = path
      names.add(n.anchor)
    }
    if (isAlias(node as ParsedNode)) {
      const name = (node as { source?: string }).source
      if (name) {
        aliases[pathKey(path)] = name
        names.add(name)
      }
    }
  }

  const visit = (node: ParsedNode | null, path: Path) => {
    if (!node) return
    note(node, path)
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = pair.key
        const keyName = isScalar(key) ? String(key.value) : String(key)
        visit(pair.value as ParsedNode | null, [...path, keyName])
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) =>
        visit(item as ParsedNode | null, [...path, i]),
      )
    }
  }

  visit(doc.contents, [])
  return { anchors, aliases, byName, names: [...names] }
}
