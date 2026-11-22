export function scanRegex(source: string, query: string) {
  if(query.length>512)throw new Error('正则表达式超过 512 字符限制')
  const re=new RegExp(query,'gm'), hits:{from:number;to:number}[]=[]
  let match:RegExpExecArray|null
  while((match=re.exec(source))!==null && hits.length<5000){
    if(match[0].length)hits.push({from:match.index,to:match.index+match[0].length})
    if(match.index===re.lastIndex)re.lastIndex++
  }
  return hits
}
