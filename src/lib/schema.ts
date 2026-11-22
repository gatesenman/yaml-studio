import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import { parse } from './yaml'

export interface SchemaResult {
  ok: boolean
  errors: string[]
}

/**
 * Validate the YAML `src` against a JSON Schema (provided as JSON or YAML text).
 * Returns a human-readable list of violations.
 */
const ajv = new Ajv({allErrors:true,strict:false})
addFormats(ajv)
let cachedText = '', cachedValidate: ReturnType<Ajv['compile']> | null = null
export function validateAgainstSchema(src: string, schemaText: string): SchemaResult {
  const trimmed = schemaText.trim()
  if (!trimmed) return { ok: true, errors: [] }

  if (schemaText.length > 131072) return {ok:false,errors:['Schema 超过 128 KiB 限制']}
  let schema: unknown
  try {
    // Schema may itself be written in YAML or JSON.
    const parsed = parse(schemaText)
    if (parsed.error) {
      return { ok: false, errors: [`Schema parse error: ${parsed.error.message}`] }
    }
    schema = parsed.value
    // Untrusted regex schemas can block the JS engine; refuse these keywords
    // explicitly rather than claim a validation succeeded after skipping them.
    const check = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      if (Object.hasOwn(node,'pattern') || Object.hasOwn(node,'patternProperties')) throw new Error('为防止正则阻塞，不支持 pattern / patternProperties，请使用其他约束。')
      const schema=node as Record<string,unknown>
      for(const keyword of ['properties','$defs','definitions','dependentSchemas','dependencies']){
        const value=schema[keyword]
        if(value&&typeof value==='object')for(const child of Object.values(value))if(!Array.isArray(child))check(child)
      }
      for(const keyword of ['items','additionalItems','additionalProperties','not','if','then','else','contains','propertyNames','unevaluatedProperties','unevaluatedItems','allOf','anyOf','oneOf','prefixItems']){
        const value=schema[keyword]; if(Array.isArray(value))value.forEach(check);else check(value)
      }
    }
    check(schema)
  } catch (e) {
    return { ok: false, errors: [`Schema parse error: ${(e as Error).message}`] }
  }

  const { value, error } = parse(src)
  if (error) {
    return { ok: false, errors: [`YAML parse error: ${error.message}`] }
  }


  let validate
  try {
    if (cachedText === schemaText && cachedValidate) validate = cachedValidate
    else { ajv.removeSchema(); validate = ajv.compile(schema as object); cachedText = schemaText; cachedValidate = validate }
  } catch (e) {
    return { ok: false, errors: [`Invalid schema: ${(e as Error).message}`] }
  }

  let valid
  try { valid = validate(value) } catch (e) { return {ok:false,errors:[`Schema 执行失败：${String(e)}`]} }
  if (valid) return { ok: true, errors: [] }

  const errors = (validate.errors ?? []).map((err: ErrorObject) => {
    const where = err.instancePath || '(root)'
    return `${where} ${err.message ?? 'is invalid'}`
  })
  return { ok: false, errors }
}
