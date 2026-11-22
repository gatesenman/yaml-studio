import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { FormNode } from './FormNode'
import { DocTabs } from './DocTabs'
import { Breadcrumb } from './Breadcrumb'
import { editorViewRef } from '../lib/editorView'

export function FormPane() {
  const parsed = useStore((s) => s.parsed)
  const error = useStore((s) => s.error)
  const docOffset=useStore(s=>s.docOffset)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the form and the source editor scrolled to the same relative
  // position, so the two panes stay visually aligned while scrolling.
  useEffect(() => {
    const form = scrollRef.current
    if (!form) return
    let lock = false
    const sync = (from: HTMLElement, to: HTMLElement) => {
      if (lock) return
      const fromMax = from.scrollHeight - from.clientHeight
      const toMax = to.scrollHeight - to.clientHeight
      if (fromMax <= 0 || toMax <= 0) return
      lock = true
      to.scrollTop = (from.scrollTop / fromMax) * toMax
      requestAnimationFrame(() => {
        lock = false
      })
    }

    const onForm = () => {
      const cm = editorViewRef.current?.scrollDOM
      if (cm) sync(form, cm)
    }
    let cm: HTMLElement | null = null
    const onCm = () => {
      if (cm) sync(cm, form)
    }

    form.addEventListener('scroll', onForm, { passive: true })
    // The editor view may not exist on first paint; attach once it does.
    let raf = 0
    const attachCm = () => {
      cm = editorViewRef.current?.scrollDOM ?? null
      if (cm) cm.addEventListener('scroll', onCm, { passive: true })
      else raf = requestAnimationFrame(attachCm)
    }
    attachCm()

    return () => {
      form.removeEventListener('scroll', onForm)
      if (cm) cm.removeEventListener('scroll', onCm)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="pane form-pane">
      <div className="pane-header">
        <span className="pane-icon pane-icon-form" aria-hidden>⊞</span>
        <span className="pane-title">可视化表单</span>
        <span className="pane-hint">编辑即同步到左侧 YAML</span>
      </div>
      <DocTabs />
      <Breadcrumb />
      <div className="form-scroll" ref={scrollRef}>
        {error && (
          <div className="form-error">
            ⚠ YAML 解析/安全检查未通过（{error.line!=null?`第 ${error.line+docOffset.startLine-1} 行`:'位置未知'}），表单编辑已暂停，源码完整保留。
            <div className="form-error-msg">{error.message}</div>
          </div>
        )}
        {!error && <FormNode path={[]} value={parsed} />}
      </div>
    </div>
  )
}
