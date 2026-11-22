import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, setAtPath, setAtPaths, renameKey, addItem, deleteAtPaths, diagnostics, getAtPath, reorderChildren, convertValueToKind } from '../src/lib/yaml'
import { splitDocuments, replaceSegment } from '../src/lib/multidoc'
import { yamlToJson, jsonToYaml, envToYaml, propertiesToYaml } from '../src/lib/convert'
import { validateAgainstSchema } from '../src/lib/schema'
import { buildLocMap } from '../src/lib/locate'
import { searchYaml } from '../src/lib/search'
import { exportToHtml } from '../src/lib/exportHtml'

test('YAML AST mutation round trip retains comments and scalar types', () => {
 let s = '# comment\napp:\n  enabled: true # flag\n  name: hello\n  ports: [80, 443]\n'
 s = setAtPath(s,['app','name'],'中文软件')
 assert.match(s,/# comment/); assert.match(s,/# flag/)
 s = renameKey(s,['app'],'name','title'); s = addItem(s,['app','ports'],8080)
 assert.equal(getAtPath(s,['app','title']),'中文软件')
 assert.deepEqual(getAtPath(s,['app','ports']),[80,443,8080])
 const mixed=setAtPaths('id: text\nport: 80\n',[['id'],['port']],1,'001')
 assert.equal(getAtPath(mixed,['id']),'001');assert.equal(getAtPath(mixed,['port']),1)
})
test('batch deletion is reverse indexed and reorder is stable', () => {
 const s = deleteAtPaths('items: [a,b,c,d]\n',[['items',1],['items',2]])
 assert.deepEqual(getAtPath(s,['items']),['a','d'])
 assert.deepEqual(getAtPath(reorderChildren(s,['items'],0,1),['items']),['d','a'])
})
test('multi-document edits do not modify sibling documents', () => {
 const s = '---\na: 1\n--- # two\nb: true\n'
 const parts = splitDocuments(s); assert.equal(parts.length,2)
 const next = replaceSegment(s,1,setAtPath(parts[1].text,['b'],false))
 assert.equal(splitDocuments(next)[0].text,parts[0].text)
 assert.equal(parse(splitDocuments(next)[1].text).error,null)
 assert.match(next,/# two/)
 assert.equal(diagnostics(next).length,0)
 assert.ok(diagnostics('a: 1\n---\nb: [\n').length)
})
test('malformed YAML, circular aliases and expansion limits fail safely', () => {
 assert.ok(parse('a: [').error)
 assert.ok(parse('a: &a [*a]').error)
 assert.equal(getAtPath('a: [',['a']),undefined)
 assert.doesNotThrow(() => buildLocMap(': broken\n'))
 assert.equal(getAtPath('defaults: &d {port: 80}\ncopy: *d\n',['copy','port']),80)
})
test('JSON / env / properties conversions and prototype pollution defense', () => {
 assert.equal(yamlToJson(jsonToYaml('{"a":[true,2]}').yaml).json,'{\n  "a": [\n    true,\n    2\n  ]\n}')
 assert.equal(getAtPath(envToYaml('PORT=8080\nDEBUG=false'),['PORT']),8080)
 assert.equal(getAtPath(propertiesToYaml('server.port=8080'),['server','port']),8080)
 propertiesToYaml('__proto__.polluted=yes\nconstructor.prototype.polluted=yes')
 assert.equal(({} as Record<string,unknown>).polluted,undefined)
})
test('Schema validation returns real pass / fail results', () => {
 const schema = '{"type":"object","required":["port"],"properties":{"port":{"type":"integer","minimum":1}}}'
 assert.equal(validateAgainstSchema('port: 80',schema).ok,true)
 assert.equal(validateAgainstSchema('port: zero',schema).ok,false)
 assert.equal(validateAgainstSchema('port: 80','type: nonsense').ok,false)
})
test('search returns paths, HTML export escapes user content', () => {
 const value = parse('app:\n  name: hello\n').value
 assert.deepEqual(searchYaml(value,'hello',{keys:true,values:true})[0].path,['app','name'])
 const html = exportToHtml('<script>alert(1)</script>','x: <script>alert(1)</script>',{x:'<img onerror=1>'})
 assert.ok(!html.includes('<script>alert(1)</script>'))
 assert.ok(!html.includes('<img onerror=1>'))
})

test('YAML parser splits prelude comments and inline document markers correctly', () => {
 const source = '# prelude\n---\na: 1\n--- {b: 2}\n'
 const segments = splitDocuments(source)
 assert.equal(segments.length,2)
 assert.equal(parse(segments[1].text).error,null)
 assert.equal(getAtPath(segments[1].text,['b']),2)
 const next = replaceSegment(source,1,setAtPath(segments[1].text,['b'],3))
 assert.equal(splitDocuments(next)[0].text,segments[0].text)
 assert.equal(diagnostics(next).length,0)
})
test('source locations distinguish dotted literal keys from nested paths', () => {
 const map=buildLocMap('"a.b": 1\na:\n  b: 2\n')
 assert.equal(map.byPath.size,3)
})

test('semantic YAML errors are reported by both parse and whole-stream diagnostics', () => {
 for (const src of ['a: *missing\n', 'a: &a [*a]\n']) {
  const parsed = parse(src), diags = diagnostics(src)
  assert.ok(parsed.error)
  assert.ok(diags.some(d => d.message === parsed.error?.message))
 }
 const src = 'ok: true\n---\ninvalid: *missing\n'
 const diags = diagnostics(src)
 assert.equal(diags.length,1)
 assert.ok(diags[0].line && diags[0].line >= 2)
 assert.equal(diagnostics('a: &a {port: 80}\nb: *a\n').length,0)
})

import { diffLines } from '../src/lib/diff'
import { runAssertions } from '../src/lib/assertions'
import { compileSchema, hintAt } from '../src/lib/schemaHints'
import { scanRegex } from '../src/lib/regex'
import { sourceLimitReason } from '../src/lib/limits'
test('large Diff uses bounded block fallback, context and preview rows', () => {
 const before=Array.from({length:5000},(_,i)=>`old${i}`).join('\n')
 const after=Array.from({length:5000},(_,i)=>`new${i}`).join('\n')
 const result=diffLines(before,after)
 assert.equal(result.coarse,true);assert.equal(result.truncated,true);assert.equal(result.rows.length,3000)
 assert.deepEqual(result.stats,{added:5000,removed:5000})
 const small=diffLines('a\nb\nc','a\nB\nc');assert.deepEqual(small.stats,{added:1,removed:1})
 assert.equal(diffLines(before,before).rows.length,0)
})
test('complex YAML types and unsafe numbers fail read-only instead of losing semantics', () => {
 for(const source of ['? [a, b]\n: value\n','1: numeric-key\n','v: !!set {a, b}\n','v: !!binary SGVsbG8=\n','v: .nan\n','v: 9007199254740993\n','v: !custom original\n']){
  assert.ok(parse(source).error,source)
  assert.ok(diagnostics(source).length,source)
 }
})
test('source parsing limits are explicit while source itself stays available', () => {
 const many='a\n'.repeat(10001)
 assert.match(sourceLimitReason(many) || '',/10000/)
 assert.ok(parse(many).error);assert.equal(splitDocuments(many)[0].text,many)
 assert.ok(sourceLimitReason('---\nx: 1\n'.repeat(202)))
})
test('conversion rejects malformed lines, duplicates, escaping and conflicting paths', () => {
 for(const text of ['BROKEN','PORT=1\nPORT=2','X="unterminated'])assert.throws(()=>envToYaml(text))
 for(const text of ['broken','a=1\na.b=2','a.b=1\na=2','a.b=1\na.b=2','a..b=1','a=hello\\nworld'])assert.throws(()=>propertiesToYaml(text))
 assert.equal(getAtPath(envToYaml('ID=001\nLARGE=9007199254740993'),['ID']),'001')
 assert.equal(getAtPath(envToYaml('LARGE=9007199254740993'),['LARGE']),'9007199254740993')
})
test('assertions support literal paths, deep equality and explicit empty path rejection', () => {
 const values=runAssertions('"a.b": {x: 1, y: 2}\nempty: {}\n',[
  {id:'1',path:'["a.b"]',op:'equals',expected:'{"y":2,"x":1}'},
  {id:'2',path:'/a.b/x',op:'type',expected:'number'},
  {id:'3',path:'',op:'exists',expected:''},
  {id:'4',path:'empty',op:'notEmpty',expected:''},
  {id:'5',path:'[broken',op:'exists',expected:''},
  {id:'6',path:'/a.b',op:'equals',expected:'{"y":2,"x":1}'},
  {id:'7',path:'/missing',op:'exists',expected:''},
 ])
 assert.deepEqual(values.map(v=>v.r.ok),[true,true,false,false,false,true,false])
 assert.equal(runAssertions('a: *missing',[{id:'1',path:'a',op:'exists',expected:''}])[0].r.ok,false)
})
test('Schema booleans, escaped refs, malformed recursive schema and regex refusal are safe', () => {
 assert.ok(compileSchema('false'));assert.ok(compileSchema('true'))
 assert.equal(validateAgainstSchema('a: 1','false').ok,false)
 assert.equal(validateAgainstSchema('a: 1','true').ok,true)
 assert.doesNotThrow(()=>validateAgainstSchema('a: 1','$ref: "#"'))
 assert.equal(validateAgainstSchema('a: text','properties:\n  a:\n    pattern: "(a+)+$"').ok,false)
 const schema=compileSchema('type: object\nproperties:\n  x: {$ref: "#/$defs/a~1b"}\n$defs:\n  a/b: {enum: [one, two]}')
 assert.deepEqual(hintAt(schema,['x']).enumValues,['one','two'])
})
test('regex scanner counts non-empty matches and rejects invalid patterns', () => {
 assert.deepEqual(scanRegex('a1\na2','a\\d'),[{from:0,to:2},{from:3,to:5}])
 assert.deepEqual(scanRegex('abc','^'),[])
 assert.throws(()=>scanRegex('abc','['))
 assert.equal(scanRegex('a'.repeat(6000),'a').length,5000)
})
import { buildCompactRows } from '../src/lib/compactRows'
test('compact rows use AST paths and never invent rows for flow maps or alias children', () => {
 const source='"a.b": 1\nflow: {x: 2, y: 3}\nbase: &b\n  port: 80\ncopy: *b\ntail: done\n'
 const rows=buildCompactRows(source,parse(source).value)
 assert.deepEqual(rows.get(1)?.path,['a.b'])
 assert.equal(rows.has(2),false)
 assert.deepEqual(rows.get(4)?.path,['base','port'])
 assert.deepEqual(rows.get(6)?.path,['tail'])
 assert.equal([...rows.values()].some(row=>row.path.length>1&&row.path[0]==='copy'),false)
})
test('Schema data or a property named pattern is not mistaken for executable regex', () => {
 assert.equal(validateAgainstSchema('pattern: abc','type: object\nproperties:\n  pattern: {type: string}').ok,true)
 assert.equal(validateAgainstSchema('pattern: abc','const: {pattern: abc}').ok,true)
})
test('JSON import rejects unsafe integer and infinite numeric conversion', () => {
 assert.ok(jsonToYaml('{"n":9007199254740993}').error)
 assert.ok(jsonToYaml('{"n":1e309}').error)
 assert.equal(jsonToYaml('{"n":"9007199254740993"}').error,null)
})
test('extreme nesting cannot escape the parser/diagnostic/location safety boundary', () => {
 const source='a: '+'['.repeat(2500)+'0'+']'.repeat(2500)
 assert.doesNotThrow(()=>parse(source));assert.ok(parse(source).error)
 assert.doesNotThrow(()=>diagnostics(source))
 assert.doesNotThrow(()=>splitDocuments(source))
 assert.doesNotThrow(()=>buildLocMap(source))
})
import { isAliasPath } from '../src/lib/search'
test('alias roots and descendants are explicitly read-only in search and compact views', () => {
 const aliases={'["copy"]':'base'}
 assert.equal(isAliasPath(['copy'],aliases),true);assert.equal(isAliasPath(['copy','port'],aliases),true)
 assert.equal(isAliasPath(['base','port'],aliases),false)
 const source='value: &v 1\ncopy: *v\n'
 assert.equal(buildCompactRows(source,parse(source).value).has(2),false)
})
test('semantic diagnostic ranges point to actual line five and full-stream offsets, never guessed doc starts', () => {
 const src='service:\n  name: ux-demo\n  enabled: true\n\nmissing: *missing\n'
 for(const error of [parse(src).error!,...diagnostics(src)]){
  assert.equal(error.line,5);assert.equal(error.col,10);assert.equal(src.slice(...error.pos!),'*missing')
 }
 const stream='first: 1\n---\n# second\nok: true\nmissing: *missing\n'
 const error=diagnostics(stream).find(d=>d.message.includes('Unresolved alias'))!
 assert.equal(error.line,5);assert.equal(stream.slice(...error.pos!),'*missing')
 const unsafe='a: 1\nb: 2\nc: 3\nbig: 9007199254740993\n'
 assert.equal(diagnostics(unsafe)[0].line,4)
 const cyclic=diagnostics('a: &a [*a]\n')[0]
 assert.equal(cyclic.line,undefined);assert.equal(cyclic.pos,undefined)
 const tagged=diagnostics('a: 1\nb: 2\nc: !unknown value\n');assert.equal(tagged.length,1);assert.equal(tagged[0].line,3)
 const eof=diagnostics('a: [')[0];assert.equal(eof.line,1);assert.ok(eof.pos && eof.pos[0]<=4 && eof.pos[1]<=4)
})
test('type conversion keeps representable values and only falls back when unsafe', () => {
 assert.deepEqual(convertValueToKind(8080,'string'),{value:'8080',preserved:true})
 assert.deepEqual(convertValueToKind(-3.5,'string'),{value:'-3.5',preserved:true})
 assert.deepEqual(convertValueToKind(true,'string'),{value:'true',preserved:true})
 assert.deepEqual(convertValueToKind(false,'string'),{value:'false',preserved:true})
 assert.deepEqual(convertValueToKind(null,'string'),{value:'',preserved:true})
 assert.equal(convertValueToKind({a:1},'string').value,'')
 assert.equal(convertValueToKind({a:1},'string').preserved,false)
 assert.match(convertValueToKind({a:1},'string').message||'',/文本/)

 assert.deepEqual(convertValueToKind('8080','number'),{value:8080,preserved:true})
 assert.deepEqual(convertValueToKind('0','number'),{value:0,preserved:true})
 assert.deepEqual(convertValueToKind('1.25','number'),{value:1.25,preserved:true})
 assert.deepEqual(convertValueToKind('','number'),{value:0,preserved:true})
 const leading=convertValueToKind('001','number')
 assert.equal(leading.value,0);assert.equal(leading.preserved,false);assert.match(leading.message||'',/数字/)
 const huge=convertValueToKind('9007199254740993','number')
 assert.equal(huge.preserved,false);assert.equal(huge.value,0)
 const boolAsNumber=convertValueToKind(true,'number')
 assert.equal(boolAsNumber.preserved,false);assert.equal(boolAsNumber.value,0)

 assert.deepEqual(convertValueToKind('true','boolean'),{value:true,preserved:true})
 assert.deepEqual(convertValueToKind('FALSE','boolean'),{value:false,preserved:true})
 assert.deepEqual(convertValueToKind(1,'boolean'),{value:true,preserved:true})
 assert.deepEqual(convertValueToKind(0,'boolean'),{value:false,preserved:true})
 const portAsBool=convertValueToKind(8080,'boolean')
 assert.equal(portAsBool.value,false);assert.equal(portAsBool.preserved,false)

 const toNull=convertValueToKind(8080,'null')
 assert.equal(toNull.value,null);assert.equal(toNull.preserved,false)
 const toObj=convertValueToKind(8080,'object')
 assert.deepEqual(toObj.value,{});assert.equal(toObj.preserved,false)
 const toArr=convertValueToKind('8080','array')
 assert.deepEqual(toArr.value,[]);assert.equal(toArr.preserved,false)
})
