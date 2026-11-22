import { sourceLimitReason } from './limits'
import { parseAllDocuments } from 'yaml'
export interface DocSegment {
  /** Complete single-document slice, including any directives / start marker. */
  text: string
  startLine: number
  startOffset: number
}
/** Use YAML's own parser: comments before a start marker are not empty docs,
 * and inline markers (--- {a: 1}) and end markers (...) remain valid. */
export function splitDocuments(src: string): DocSegment[] {
  if(sourceLimitReason(src))return [{text:src,startLine:1,startOffset:0}]
  let docs: ReturnType<typeof parseAllDocuments>
  try {docs=parseAllDocuments(src)} catch {return [{text:src,startLine:1,startOffset:0}]}
  if (!docs.length) return [{ text: src, startLine: 1, startOffset: 0 }]
  const starts = docs.map((_, i) => i === 0 ? 0 : (docs[i - 1].range?.[2] ?? docs[i].range?.[0] ?? 0))
  return starts.map((start, i) => ({
    text: src.slice(start, starts[i + 1] ?? src.length),
    startLine: src.slice(0, start).split('\n').length,
    startOffset: start,
  }))
}
export function isMultiDoc(src: string): boolean { return splitDocuments(src).length > 1 }
export function replaceSegment(src: string, index: number, newText: string): string {
  const segments = splitDocuments(src), segment = segments[index]
  if (!segment) return src
  let replacement = newText
  if (index > 0 && !/^---(?:\s|$)/m.test(replacement)) replacement = `---\n${replacement}`
  if (index < segments.length - 1 && !replacement.endsWith('\n')) replacement += '\n'
  return src.slice(0, segment.startOffset) + replacement + src.slice(segment.startOffset + segment.text.length)
}
