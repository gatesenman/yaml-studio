import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import { parse } from './yaml'

export interface SchemaResult {
  ok: boolean
  errors: string[]
}

const ajv = new Ajv({allErrors:true,strict:false})
addFormats(ajv)
let cachedText = '', cachedValidate: ReturnType<Ajv['compile']> | null = null

const TYPE_ZH: Record<string, string> = {
  string: '文本',
  number: '数字',
  integer: '整数',
  boolean: '布尔',
  object: '对象',
  array: '列表',
  null: '空值',
}

/** Shared safety walk so form hints and the Schema tab refuse the same schemas. */
export function inspectSchemaSafety(schema: unknown): string | null {
  try {
    const check = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      if (Object.hasOwn(node, 'pattern') || Object.hasOwn(node, 'patternProperties')) {
        throw new Error('为防止正则阻塞，不支持 pattern / patternProperties，请使用其他约束。')
      }
      const record = node as Record<string, unknown>
      for (const keyword of ['properties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']) {
        const value = record[keyword]
        if (value && typeof value === 'object') {
          for (const child of Object.values(value)) if (!Array.isArray(child)) check(child)
        }
      }
      for (const keyword of ['items', 'additionalItems', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'allOf', 'anyOf', 'oneOf', 'prefixItems']) {
        const value = record[keyword]
        if (Array.isArray(value)) value.forEach(check)
        else check(value)
      }
    }
    check(schema)
    return null
  } catch (error) {
    return (error as Error).message
  }
}

function formatAjvError(err: ErrorObject): string {
  const where = err.instancePath || '（根）'
  const params = (err.params ?? {}) as Record<string, unknown>
  const typeZh = (raw: unknown) => String(raw ?? '')
    .split(',')
    .map((part) => TYPE_ZH[part.trim()] || part.trim())
    .filter(Boolean)
    .join('或')
  switch (err.keyword) {
    case 'type':
      return `路径 ${where}：必须是${typeZh(params.type)}`
    case 'required':
      return `路径 ${where}：缺少必填属性 ${params.missingProperty}`
    case 'enum':
      return `路径 ${where}：必须是允许的枚举值之一`
    case 'const':
      return `路径 ${where}：必须等于指定常量`
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      return `路径 ${where}：必须 ${params.comparison} ${params.limit}`
    case 'minLength':
      return `路径 ${where}：长度至少为 ${params.limit}`
    case 'maxLength':
      return `路径 ${where}：长度不能超过 ${params.limit}`
    case 'minItems':
      return `路径 ${where}：至少 ${params.limit} 项`
    case 'maxItems':
      return `路径 ${where}：最多 ${params.limit} 项`
    case 'additionalProperties':
      return `路径 ${where}：不允许额外属性 ${params.additionalProperty}`
    default:
      return `路径 ${where}：${err.message ?? '不符合约束'}`
  }
}

export function validateAgainstSchema(src: string, schemaText: string): SchemaResult {
  const trimmed = schemaText.trim()
  if (!trimmed) return { ok: true, errors: [] }

  if (schemaText.length > 131072) return {ok:false,errors:['Schema 超过 128 KiB 限制']}
  let schema: unknown
  try {
    const parsed = parse(schemaText)
    if (parsed.error) {
      return { ok: false, errors: [`Schema 无法解析：${parsed.error.message}`] }
    }
    schema = parsed.value
    const safety = inspectSchemaSafety(schema)
    if (safety) return { ok: false, errors: [`Schema 无法使用：${safety}`] }
  } catch (e) {
    return { ok: false, errors: [`Schema 无法解析：${(e as Error).message}`] }
  }

  const { value, error } = parse(src)
  if (error) {
    return { ok: false, errors: [`文档无法解析：${error.message}`] }
  }

  let validate
  try {
    if (cachedText === schemaText && cachedValidate) validate = cachedValidate
    else { ajv.removeSchema(); validate = ajv.compile(schema as object); cachedText = schemaText; cachedValidate = validate }
  } catch (e) {
    return { ok: false, errors: [`无效的 Schema：${(e as Error).message}`] }
  }

  let valid
  try { valid = validate(value) } catch (e) { return {ok:false,errors:[`Schema 执行失败：${String(e)}`]} }
  if (valid) return { ok: true, errors: [] }

  const errors = (validate.errors ?? []).map(formatAjvError)
  return { ok: false, errors }
}
