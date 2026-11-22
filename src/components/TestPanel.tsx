import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { diagnostics, diagnosticRange } from '../lib/yaml'
import { validateAgainstSchema } from '../lib/schema'

import { runAssertions, OP_LABELS, type Assertion, type Op } from '../lib/assertions'

const ASSERT_KEY = 'yaml-studio.assertions'

function loadAssertions(): Assertion[] {
  try {
    const raw = localStorage.getItem(ASSERT_KEY)
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a.slice(0,200).filter(x => x && typeof x.id === 'string' && typeof x.path === 'string' && typeof x.expected === 'string' && Object.hasOwn(OP_LABELS,x.op)) }
  } catch {
    /* ignore */
  }
  return [
    { id: 'a1', path: 'app.name', op: 'exists', expected: '' },
    { id: 'a2', path: 'app.enabled', op: 'type', expected: 'boolean' },
  ]
}

export function TestPanel() {
  const fullSource = useStore((s) => s.source)
  const source = useStore((s) => s.activeSegment)
  // Schema text is shared with the form hints via the store (single source).
  const schemaText = useStore((s) => s.schemaText)
  const setSchemaText = useStore((s) => s.setSchemaText)
  const [assertions, setAssertions] = useState<Assertion[]>(loadAssertions)
  const [tab, setTab] = useState<'lint' | 'schema' | 'assert'>('lint')

  useEffect(() => {
    try { localStorage.setItem(ASSERT_KEY, JSON.stringify(assertions)) } catch { useStore.getState().setNotice('断言保存失败，请检查本地存储空间。') }
  }, [assertions])

  const diags = useMemo(() => diagnostics(fullSource), [fullSource])
  const schemaResult = useMemo(
    () => tab === 'schema' ? validateAgainstSchema(source, schemaText) : {ok:true,errors:[]},
    [tab, source, schemaText],
  )
  const assertResults = useMemo(
    () => tab === 'assert' ? runAssertions(source, assertions) : [],
    [tab, source, assertions],
  )

  const passCount = assertResults.filter((x) => x.r.ok).length

  const update = (id: string, patch: Partial<Assertion>) =>
    setAssertions((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  const remove = (id: string) =>
    setAssertions((prev) => prev.filter((a) => a.id !== id))
  const add = () =>
    setAssertions((prev) => [
      ...prev,
      { id: crypto.randomUUID(), path: '', op: 'exists', expected: '' },
    ])

  return (
    <div className="test-panel">
      <div className="test-tabs">
        <button
          className={tab === 'lint' ? 'tab active' : 'tab'}
          onClick={() => setTab('lint')}
        >
          语法检查 {diags.length > 0 ? `(${diags.length})` : '✓'}
        </button>
        <button
          className={tab === 'schema' ? 'tab active' : 'tab'}
          onClick={() => setTab('schema')}
        >
          Schema 校验 {schemaText.trim() ? (tab==='schema' ? (schemaResult.ok ? '✓' : '✗') : '•') : ''}
        </button>
        <button
          className={tab === 'assert' ? 'tab active' : 'tab'}
          onClick={() => setTab('assert')}
        >
          当前文档断言 ({tab==='assert' ? `${passCount}/` : ''}{assertions.length})
        </button>
      </div>

      <div className="test-body">
        {tab === 'lint' && (
          <div>
            {diags.length === 0 ? (
              <div className="result-ok">✓ 没有语法错误或警告</div>
            ) : (
              <ul className="diag-list">
                {diags.map((d, i) => (
                  <li key={i} className="diag-item">
                    {diagnosticRange(d,fullSource) ? <button type="button" className="diag-jump" onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();useStore.getState().navigateToSource(d,fullSource)}}} onClick={()=>useStore.getState().navigateToSource(d,fullSource)} title="定位源码（Enter / 空格）">
                      <span className="diag-loc">{d.line!=null?`第 ${d.line} 行${d.col!=null?` · 第 ${d.col} 列`:''}`:'定位源码'}</span>{d.message}
                    </button> : <span><span className="diag-loc">位置未知</span>{d.message}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'schema' && (
          <div className="schema-area">
            <textarea
              className="schema-input"
              placeholder="在此粘贴 JSON Schema（支持 JSON 或 YAML 格式），留空则不校验"
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              spellCheck={false}
            />
            {schemaText.trim() && (
              <div className={schemaResult.ok ? 'result-ok' : 'result-bad'}>
                {schemaResult.ok ? (
                  '✓ 符合 Schema'
                ) : (
                  <ul className="diag-list">
                    {schemaResult.errors.map((e, i) => (
                      <li key={i} className="diag-item">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'assert' && (
          <div className="assert-area">
            <table className="assert-table">
              <thead>
                <tr>
                  <th>路径</th>
                  <th>条件</th>
                  <th>期望值</th>
                  <th>结果</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assertResults.map(({ a, r }) => (
                  <tr key={a.id}>
                    <td>
                      <input
                        className="field-input"
                        value={a.path}
                        placeholder={'app.name 或 /a.b 或 ["a.b"]'}
                        onChange={(e) => update(a.id, { path: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="type-select"
                        value={a.op}
                        onChange={(e) => update(a.id, { op: e.target.value as Op })}
                      >
                        {(Object.keys(OP_LABELS) as Op[]).map((op) => (
                          <option key={op} value={op}>
                            {OP_LABELS[op]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="field-input"
                        value={a.expected}
                        disabled={a.op === 'exists' || a.op === 'notEmpty'}
                        placeholder={a.op === 'type' ? 'string / number ...' : '值'}
                        onChange={(e) => update(a.id, { expected: e.target.value })}
                      />
                    </td>
                    <td>
                      <span className={r.ok ? 'pill pill-ok' : 'pill pill-bad'}>
                        {r.ok ? 'PASS' : 'FAIL'}
                      </span>
                      <span className="assert-detail">{r.detail}</span>
                    </td>
                    <td>
                      <button
                        className="btn btn-icon btn-danger"
                        onClick={() => remove(a.id)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-sm" disabled={assertions.length>=200} title="最多 200 条断言" onClick={add}>
              + 添加断言
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
