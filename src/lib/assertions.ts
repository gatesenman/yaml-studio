import { parse, parsePathString, kindOf } from './yaml'
export type Op = 'exists' | 'equals' | 'type' | 'notEmpty'
export interface Assertion {id:string;path:string;op:Op;expected:string}
export const OP_LABELS:Record<Op,string>={exists:'存在',equals:'等于',type:'类型为',notEmpty:'非空'}
function equal(a:unknown,b:unknown):boolean{
 if(Object.is(a,b))return true
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false
 const ak=Object.keys(a).sort(),bk=Object.keys(b).sort()
 return ak.length===bk.length && ak.every((k,i)=>k===bk[i]&&equal((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]))
}
export function runAssertions(source:string,assertions:Assertion[]){
 const parsed=parse(source)
 return assertions.map(a=>{
  let ok=false,detail=''
  try{
   if(parsed.error)throw new Error('文档解析/安全检查失败，断言未通过')
   if(!a.path.trim())throw new Error('请输入路径（根节点使用 $，字面键可用 JSON 数组路径）')
   let value=parsed.value
   for(const key of parsePathString(a.path)){
    value=value!==null&&typeof value==='object'&&Object.hasOwn(value,key)?(value as Record<string|number,unknown>)[key]:undefined
   }
   if(value===undefined)throw new Error('路径不存在')
   if(a.op==='exists')ok=true
   else if(a.op==='type')ok=kindOf(value)===a.expected.trim()
   else if(a.op==='notEmpty')ok=value!==null&&value!==''&&!(typeof value==='object'&&Object.keys(value).length===0)
   else if(a.op==='equals'){
    let expected:unknown=a.expected
    try{expected=JSON.parse(a.expected)}catch{/* Text expectation */}
    ok=equal(value,expected)
   }
   const preview=JSON.stringify(value) ?? 'undefined'
   detail=`实际 ${preview.length>200?preview.slice(0,200)+'…':preview}`
  }catch(error){detail=(error as Error).message}
  return {a,r:{ok,detail}}
 })
}
