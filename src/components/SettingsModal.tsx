import { useEffect, useRef, useState } from 'react'
import {
  loadAiSettings,
  saveAiSettings,
  getAiSettingsErrors,
  type AiSettingsFieldErrors,
  DEFAULT_AI_SETTINGS,
  type AiSettings,
} from '../lib/ai'
import { useStore } from '../store'
import { isDesktop } from '../lib/fileActions'
import { compileSchemaDetail } from '../lib/schemaHints'

type Tab = 'ai' | 'schema' | 'assoc'

export function SettingsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings)
  const [tab, setTab] = useState<Tab>('ai')
  const schemaText = useStore((s) => s.schemaText)
  const setSchemaText = useStore((s) => s.setSchemaText)
  const [assocMsg, setAssocMsg] = useState('')
  const [settingsError,setSettingsError] = useState('')
  const [fieldErrors,setFieldErrors] = useState<AiSettingsFieldErrors>({})
  const urlInput=useRef<HTMLInputElement>(null), modelInput=useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) {setSettings(loadAiSettings());setSettingsError('');setFieldErrors({})} }, [open])

  if (!open) return null

  const save = () => {
    const errors=getAiSettingsErrors(settings)
    setFieldErrors(errors);setSettingsError('')
    if(errors.baseUrl || errors.model){(errors.baseUrl?urlInput:modelInput).current?.focus();return}
    try { saveAiSettings(settings); onClose() } catch { setSettingsError('保存设置失败，请重试。当前输入已保留。') }
  }

  const setDefault = async () => {
    setAssocMsg('正在设置…')
    try {
    const res = await window.desktop?.setDefaultYaml()
    if (!res) setAssocMsg('仅桌面版支持此功能')
    else if (res.ok)
      setAssocMsg('已打开 Windows「默认应用」，请选用安装后的 YAML Studio。')
    else setAssocMsg(`设置失败：${res.error ?? '未知错误'}`)
    } catch(error) {setAssocMsg(`设置失败：${String(error)}`)}
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'ai', label: 'AI 接口' },
    { id: 'schema', label: 'JSON Schema' },
    { id: 'assoc', label: '文件关联' },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>⚙ 设置</span>
          <button className="btn btn-icon" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="settings-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'settings-tab active' : 'settings-tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="modal-body" style={{ display: tab === 'ai' ? undefined : 'none' }}>
          <p className="settings-note">
            AI 生成使用 OpenAI 兼容的 Chat Completions 接口。Key 仅保留在当前页面会话，关闭或刷新后需要重新填写。请求时会将 Key、提示词及选中的 YAML 发送至你配置的接口，请勿发送敏感配置。
          </p>
          <label className="settings-field">
            <span>接口地址 (Base URL)</span>
            <input
              ref={urlInput}
              className={fieldErrors.baseUrl?'field-input invalid':'field-input'}
              aria-invalid={Boolean(fieldErrors.baseUrl)}
              aria-describedby={fieldErrors.baseUrl?'settings-url-error':undefined}
              value={settings.baseUrl}
              placeholder={DEFAULT_AI_SETTINGS.baseUrl}
              onChange={(e) => {setSettings({ ...settings, baseUrl: e.target.value });setFieldErrors(errors=>({...errors,baseUrl:undefined}));setSettingsError('')}}
            />
            {fieldErrors.baseUrl&&<span className="settings-field-error" id="settings-url-error" role="alert">{fieldErrors.baseUrl}</span>}
          </label>
          <label className="settings-field">
            <span>模型 (Model)</span>
            <input
              ref={modelInput}
              className={fieldErrors.model?'field-input invalid':'field-input'}
              aria-invalid={Boolean(fieldErrors.model)}
              aria-describedby={fieldErrors.model?'settings-model-error':undefined}
              value={settings.model}
              placeholder={DEFAULT_AI_SETTINGS.model}
              onChange={(e) => {setSettings({ ...settings, model: e.target.value });setFieldErrors(errors=>({...errors,model:undefined}));setSettingsError('')}}
            />
            {fieldErrors.model&&<span className="settings-field-error" id="settings-model-error" role="alert">{fieldErrors.model}</span>}
          </label>
          <label className="settings-field">
            <span>API Key</span>
            <input
              className="field-input"
              type="password"
              value={settings.apiKey}
              placeholder="sk-..."
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
            />
          </label>
        </div>

        {tab === 'schema' && (
          <div className="modal-body">
            <p className="settings-note">
              粘贴 JSON Schema（JSON 或 YAML 格式，修改即时生效）。表单字段会显示「必填 ✱ /
              说明 ⓘ」、枚举值变下拉框、添加字段时按 schema 自动补全，类型不符会标红。
            </p>
            <textarea
              className="convert-text"
              spellCheck={false}
              placeholder={'{\n  "type": "object",\n  "required": ["name"],\n  "properties": { "name": { "type": "string" } }\n}'}
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
            />
            <div className="settings-note">
              {schemaText.trim() === ''
                ? '（未设置 Schema）'
                : compileSchemaDetail(schemaText).schema
                  ? '✓ Schema 已生效'
                  : `⚠ ${compileSchemaDetail(schemaText).error || '无法解析为有效的 Schema'}`}
            </div>
            <button className="btn btn-sm" onClick={() => setSchemaText('')}>
              清除 Schema
            </button>
          </div>
        )}

        {tab === 'assoc' && (
          <div className="modal-body">
            <p className="settings-note">
              将 YAML Studio 注册为 .yaml / .yml 的默认打开程序。由于 Windows 10/11
              对默认程序有 UserChoice 保护，安装版负责注册文件类型，点击后打开系统「默认应用」设置，
              请在其中确认一次即可永久生效。
            </p>
            {isDesktop() ? (
              <button className="btn btn-accent" onClick={setDefault}>
                🔗 一键设为 .yaml 默认程序
              </button>
            ) : (
              <div className="settings-note">该功能仅在桌面版（exe）中可用。</div>
            )}
            {assocMsg && <div className="settings-note assoc-msg">{assocMsg}</div>}
          </div>
        )}

        {settingsError && <div className="result-bad modal-body" role="alert">{settingsError}</div>}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            {tab === 'ai' ? '取消' : '关闭'}
          </button>
          {tab === 'ai' && (
            <button className="btn btn-accent" onClick={save}>
              保存
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
