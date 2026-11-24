/** Honest status-bar copy for single- and multi-document streams. */
export function yamlStatusText(input: {
  docCount: number
  currentHasIssue: boolean
  otherIssueCount: number
}): { ok: boolean; text: string } {
  if (input.currentHasIssue) {
    return {
      ok: false,
      text: input.docCount > 1 ? '当前文档解析/安全检查待处理' : '解析/安全检查待处理',
    }
  }
  if (input.otherIssueCount > 0) {
    return { ok: false, text: `其他文档有解析/安全问题（${input.otherIssueCount}）` }
  }
  return { ok: true, text: 'YAML 就绪' }
}
