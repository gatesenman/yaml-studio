import { buildLocMap, pathKey, analyzeAnchors } from './locate'
import {kindOf, type Path, type ValueKind} from './yaml'
export type Row =
  | {
      line: number
      indent: number
      seqMark: boolean
      kind: 'pair-head'
      mapPath: Path
      key: string
      path: Path
    }
  | {
      line: number
      indent: number
      seqMark: boolean
      kind: 'pair-scalar'
      mapPath: Path
      key: string
      path: Path
      valueKind: ValueKind
      value: unknown
    }
  | {
      line: number
      indent: number
      seqMark: boolean
      kind: 'item-head'
      path: Path
      index: number
    }
  | {
      line: number
      indent: number
      seqMark: boolean
      kind: 'item-scalar'
      path: Path
      index: number
      valueKind: ValueKind
      value: unknown
    }

export function buildCompactRows(source:string,parsed:unknown):Map<number,Row>{
 const aliases=analyzeAnchors(source).aliases
 const locations=buildLocMap(source),lines=source.split('\n')
 const candidates=new Map<number,Row[]>(),result=new Map<number,Row>()
 const add=(row:Row)=>candidates.set(row.line,[...(candidates.get(row.line)||[]),row])
 const base=(line:number)=>({line,indent:/^ */.exec(lines[line-1]||'')![0].length,seqMark:/^\s*-/.test(lines[line-1]||'')})
 const visit=(value:unknown,path:Path)=>{
  if(Array.isArray(value))value.forEach((child,index)=>{
   const childPath=[...path,index],loc=locations.byPath.get(pathKey(childPath));if(!loc||Object.hasOwn(aliases,pathKey(childPath)))return
   const kind=kindOf(child)
   if(kind==='object'||kind==='array')visit(child,childPath)
   else add({...base(loc.startLine),kind:'item-scalar',path:childPath,index,valueKind:kind,value:child})
  })
  else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){
   const childPath=[...path,key],loc=locations.byPath.get(pathKey(childPath));if(!loc||Object.hasOwn(aliases,pathKey(childPath)))continue
   const kind=kindOf(child)
   if(kind==='object'||kind==='array'){add({...base(loc.startLine),kind:'pair-head',mapPath:path,key,path:childPath});visit(child,childPath)}
   else add({...base(loc.startLine),kind:'pair-scalar',mapPath:path,key,path:childPath,valueKind:kind,value:child})
  }
 }
 visit(parsed,[])
 // Multiple AST nodes on a flow line cannot be represented by one aligned
 // editor. Keep that original line read-only instead of inventing a wrong path.
 for(const [line,rows]of candidates)if(rows.length===1)result.set(line,rows[0])
 return result
}
