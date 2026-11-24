import Ajv from 'ajv'
const schemaValidator = new Ajv({ strict: false })
import { parse } from './yaml'
import { inspectSchemaSafety } from './schema'
import type { Path } from './yaml'

/** A minimal view of the parts of JSON Schema we surface in the form. */
export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema | JsonSchema[]
  enum?: unknown[]
  description?: string
  $ref?: string
  definitions?: Record<string, JsonSchema>
  $defs?: Record<string, JsonSchema>
  [k: string]: unknown
}

export interface FieldHint {
  /** Whether the parent schema marks this field as required. */
  required: boolean
  /** Allowed values, if the schema constrains them to an enum. */
  enumValues?: unknown[]
  /** Declared JSON type(s). */
  type?: string | string[]
  /** Human description from the schema (shown as a tooltip). */
  description?: string
  /** Known property names (for add-key autocomplete on objects). */
  properties?: string[]
}

const EMPTY: FieldHint = { required: false }

export interface CompiledSchema {
  schema: JsonSchema | null
  error: string | null
}

/** Parse JSON-or-YAML schema text into an object (or null when empty/invalid). */
export function compileSchemaDetail(text: string): CompiledSchema {
  if (!text.trim()) return { schema: null, error: null }
  if (text.length > 131072) return { schema: null, error: 'Schema 超过 128 KiB 限制' }
  const { value, error } = parse(text)
  if (error) return { schema: null, error: `Schema 无法解析：${error.message}` }
  if (typeof value === 'boolean') return { schema: value ? {} : { not: {} }, error: null }
  if (!value || typeof value !== 'object') return { schema: null, error: 'Schema 必须是对象或布尔值' }
  const safety = inspectSchemaSafety(value)
  if (safety) return { schema: null, error: safety }
  try { if (!schemaValidator.validateSchema(value)) return { schema: null, error: '不是有效的 JSON Schema' } } catch { return { schema: null, error: '不是有效的 JSON Schema' } }
  return { schema: value as JsonSchema, error: null }
}

export function compileSchema(text: string): JsonSchema | null {
  return compileSchemaDetail(text).schema
}

/** Resolve a local `$ref` (only `#/...` pointers) against the root schema. */
function deref(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let cur = schema
  let guard = 0
  while (cur && typeof cur.$ref === 'string' && cur.$ref.startsWith('#/') && guard++ < 20) {
    const parts = cur.$ref.slice(2).split('/').map(p => p.replace(/~1/g,'/').replace(/~0/g,'~'))
    let node: unknown = root
    for (const p of parts) {
      node = node && typeof node === 'object' && Object.hasOwn(node,p) ? (node as Record<string,unknown>)[p] : undefined
    }
    if (!node || typeof node !== 'object') break
    cur = node as JsonSchema
  }
  return cur
}

/**
 * Walk `path` through the schema and return the hint for the node found there,
 * including whether its parent marks it as required.
 */
export function hintAt(root: JsonSchema | null, path: Path): FieldHint {
  if (!root) return EMPTY
  let cur: JsonSchema | null = deref(root, root)
  let required = false

  for (const seg of path) {
    if (!cur) return EMPTY
    cur = deref(cur, root)
    if (typeof seg === 'number') {
      const items = cur.items
      if (Array.isArray(items)) cur = items[seg] ?? null
      else cur = (items as JsonSchema) ?? null
      required = false
    } else {
      const props = cur.properties
      required = Array.isArray(cur.required) && cur.required.includes(seg)
      cur = props ? (props[seg] ?? null) : null
    }
  }

  if (!cur) return { required }
  cur = deref(cur, root)
  return {
    required,
    enumValues: Array.isArray(cur.enum) ? cur.enum : undefined,
    type: cur.type,
    description: typeof cur.description === 'string' ? cur.description : undefined,
    properties: cur.properties ? Object.keys(cur.properties) : undefined,
  }
}
