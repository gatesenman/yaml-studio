export type DiffKind = 'same' | 'added' | 'removed'
export interface DiffRow { kind: DiffKind; oldLine: number | null; newLine: number | null; text: string }
export interface DiffStats { added: number; removed: number }
/** Prefix/suffix trimming + bounded LCS. Large changes fall back to a linear
 * replacement-block diff, never allocate an unbounded n*m matrix. */
export function diffLines(oldText: string, newText: string): { rows: DiffRow[]; stats: DiffStats; coarse: boolean; truncated: boolean } {
  if (oldText === newText) return { rows: [], stats: { added: 0, removed: 0 }, coarse: false, truncated: false }
  const a = oldText.split('\n'), b = newText.split('\n')
  let prefix = 0, suffix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length-1-suffix] === b[b.length-1-suffix]) suffix++
  const n=a.length-prefix-suffix, m=b.length-prefix-suffix
  const coarse=(n+1)*(m+1)>1_000_000
  const rows: DiffRow[]=[];let added=0, removed=0, total=0
  const push=(kind:DiffKind,i:number|null,j:number|null,text:string)=>{
    total++;if(kind==='added')added++;if(kind==='removed')removed++
    if(rows.length<3000)rows.push({kind,oldLine:i===null?null:i+1,newLine:j===null?null:j+1,text})
  }
  // Keep only a small amount of unchanged context, preserving actual line numbers.
  for(let i=Math.max(0,prefix-3);i<prefix;i++)push('same',i,i,a[i])
  if(coarse){
    for(let i=0;i<n;i++)push('removed',prefix+i,null,a[prefix+i])
    for(let j=0;j<m;j++)push('added',null,prefix+j,b[prefix+j])
  }else{
    const width=m+1, lcs=new Uint32Array((n+1)*width)
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)lcs[i*width+j]=a[prefix+i]===b[prefix+j]?lcs[(i+1)*width+j+1]+1:Math.max(lcs[(i+1)*width+j],lcs[i*width+j+1])
    let i=0,j=0
    while(i<n||j<m){
      if(i<n&&j<m&&a[prefix+i]===b[prefix+j]){push('same',prefix+i,prefix+j,a[prefix+i]);i++;j++}
      else if(i<n&&(j===m||lcs[(i+1)*width+j]>=lcs[i*width+j+1])){push('removed',prefix+i,null,a[prefix+i]);i++}
      else{push('added',null,prefix+j,b[prefix+j]);j++}
    }
  }
  for(let k=0;k<Math.min(3,suffix);k++)push('same',a.length-suffix+k,b.length-suffix+k,a[a.length-suffix+k])
  return {rows,stats:{added,removed},coarse,truncated:total>rows.length}
}
