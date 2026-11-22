import { parse } from './yaml'
import { splitDocuments } from './multidoc'

export interface AiSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
}

let sessionApiKey = ''
const SETTINGS_KEY = 'yaml-studio.ai-settings'

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) { const value = JSON.parse(raw); const safe = {baseUrl: typeof value?.baseUrl === 'string' ? value.baseUrl : DEFAULT_AI_SETTINGS.baseUrl, model: typeof value?.model === 'string' ? value.model : DEFAULT_AI_SETTINGS.model}; localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe)); return {...safe, apiKey:sessionApiKey} }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_AI_SETTINGS, apiKey: sessionApiKey }
}

export type AiSettingsFieldErrors = Partial<Record<'baseUrl' | 'model', string>>
export function getAiSettingsErrors(settings: AiSettings): AiSettingsFieldErrors {
  const errors: AiSettingsFieldErrors = {}
  if (!settings.baseUrl.trim()) errors.baseUrl = '请输入接口地址。'
  else {
    try {
      const endpoint = new URL(settings.baseUrl.trim())
      if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))) errors.baseUrl = '接口地址必须使用 HTTPS；本机 localhost 接口可使用 HTTP。'
      else if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) errors.baseUrl = '接口地址不能包含账号、密码、查询参数或 # 片段。请填写基础地址。'
    } catch { errors.baseUrl = '请输入完整有效的接口地址，例如 https://api.example.com/v1。' }
  }
  if (!settings.model.trim()) errors.model = '请输入模型名称。'
  return errors
}
export function validateAiSettings(settings: AiSettings) {
  const errors = getAiSettingsErrors(settings)
  if (errors.baseUrl || errors.model) throw new Error(errors.baseUrl || errors.model)
}
export function saveAiSettings(s: AiSettings): void {
  validateAiSettings(s) // Validate before changing either session credentials or persisted settings.
  sessionApiKey = s.apiKey
  const safe = { baseUrl: s.baseUrl.trim().replace(/\/+$/, ''), model: s.model.trim() }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe)) } catch { /* session still works */ }
}
async function readResponse(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader=res.body.getReader(), decoder=new TextDecoder()
  let text='', size=0
  try { while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>2*1024*1024){ await reader.cancel(); throw new Error('AI 响应超过 2 MB，已拒绝。') } text+=decoder.decode(value,{stream:true}) } return text+decoder.decode() }
  finally { reader.releaseLock() }
}

const SYSTEM_PROMPT = `You are a YAML generation assistant. The user describes the data or
configuration they want. Respond with VALID YAML ONLY — no explanations, no Markdown code
fences. Use 2-space indentation. Include helpful inline comments where useful.`

function stripFences(text: string): string {
  let t = text.trim()
  // Remove a leading ```yaml / ``` fence and trailing fence if present.
  t = t.replace(/^```[a-zA-Z]*\s*/, '')
  t = t.replace(/```$/, '')
  return t.trim()
}

/**
 * Generate (or modify) YAML from a natural-language instruction using any
 * OpenAI-compatible chat-completions endpoint.
 */
export async function generateYaml(
  instruction: string,
  settings: AiSettings,
  currentYaml?: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!settings.apiKey) {
    throw new Error('未配置 API Key：请点击「设置」填写 OpenAI 兼容接口的 Key。')
  }

  validateAiSettings(settings)
  if (!instruction.trim()) throw new Error('请输入生成指令。')
  const userContent = currentYaml?.trim()
    ? `Current YAML:\n${currentYaml}\n\nInstruction: ${instruction}`
    : instruction

  const res = await fetch(`${settings.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  })

  const responseText = await readResponse(res)
  if (!res.ok) {
    const detail = responseText
    throw new Error(`AI 请求失败 (${res.status}): ${detail.slice(0, 300)}`)
  }

  let data
  try { data = JSON.parse(responseText) } catch { throw new Error('AI 响应不是有效 JSON。') }
  const text: unknown = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('AI 响应缺少文本内容。')
  const yaml = stripFences(text)
  if (!yaml) throw new Error('AI 返回为空。')

  // Validate the generated YAML so we never inject broken content.
  for (const segment of splitDocuments(yaml)) { const {error}=parse(segment.text); if(error)throw new Error(`AI 生成的 YAML 解析失败：${error.message}`) }
  return yaml
}
