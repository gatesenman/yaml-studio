/** Limits protect parsing/rendering only. Source stays intact and exportable. */
export function sourceLimitReason(source: string): string | null {
  if(source.length>2*1024*1024)return '源码超过 2 Mi 字符，已暂停解析/表单/转换；原文仍可编辑和导出。'
  let lines=1
  for(let i=0;i<source.length;i++)if(source.charCodeAt(i)===10&&++lines>10000)return '源码超过 10000 行，已暂停解析/表单/转换；原文仍可编辑和导出。'
  const starts=source.match(/^---(?:[ \t]|$)/gm)
  if(starts&&starts.length>200)return 'YAML 流超过 200 个文档，已暂停结构化操作，请拆分后编辑。'
  return null
}
