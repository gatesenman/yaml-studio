import { useFieldEdit } from '../lib/fieldEdit'
import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../store'
import { pathKey } from '../lib/locate'
import { hintAt, type FieldHint } from '../lib/schemaHints'
import { kindOf, defaultForKind, convertValueToKind, type ValueKind, type Path } from '../lib/yaml'
import { notify } from '../lib/fileActions'

const KIND_LABELS: Record<ValueKind, string> = {
  string: '文本',
  number: '数字',
  boolean: '开关',
  null: '空值',
  object: '分组',
  array: '列表',
}

const KIND_OPTIONS: ValueKind[] = [
  'string',
  'number',
  'boolean',
  'null',
  'object',
  'array',
]

/** Shared cross-pane highlight wiring for a single entry. */
function useActiveEntry(path: Path) {
  const activePath = useStore((s) => s.activePath)
  const activeOrigin = useStore((s) => s.activeOrigin)
  const setActivePath = useStore((s) => s.setActivePath)
  const active = pathKey(activePath) === pathKey(path)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active && activeOrigin === 'editor' && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [active, activeOrigin])

  const activate = () => setActivePath(path, 'form')
  return { active, ref, activate }
}

/** Store-backed collapse state so expand/fold is remembered across sessions. */
function useCollapse(path: Path, nested: boolean) {
  const key = pathKey(path)
  const collapsed = useStore((s) => !!s.collapsed[key])
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  return { open: nested ? !collapsed : true, toggle: () => toggleCollapsed(key) }
}

/** Multi-select membership for an entry (Ctrl/⌘+click the checkbox). */
function useSelection(path: Path) {
  const key = pathKey(path)
  const selected = useStore((s) => s.selected.includes(key))
  const toggleSelected = useStore((s) => s.toggleSelected)
  return { selected, toggle: () => toggleSelected(key) }
}

/** Badge shown for `&anchor` definitions and `*alias` references. */
function AnchorBadge({ path }: { path: Path }) {
  const anchorMeta = useStore((s) => s.anchorMeta)
  const setActivePath = useStore((s) => s.setActivePath)
  const pk = pathKey(path)
  const anchor = anchorMeta.anchors[pk]
  const alias = anchorMeta.aliases[pk]
  if (alias) {
    const target = anchorMeta.byName[alias]
    return (
      <span
        className="anchor-badge alias-badge"
        title="别名引用（点击跳到锚点定义）"
        onClick={(e) => {
          e.stopPropagation()
          if (target) setActivePath(target, 'form')
        }}
      >
        ↪ *{alias}
      </span>
    )
  }
  if (anchor) {
    return (
      <span className="anchor-badge" title="锚点定义 &">
        ⚓ &{anchor}
      </span>
    )
  }
  return null
}

/** Small checkbox toggling an entry's membership in the batch selection. */
function SelectBox({ selected, toggle }: { selected: boolean; toggle: () => void }) {
  return (
    <input
      type="checkbox"
      className="entry-select"
      checked={selected}
      title="选择以批量拖拽/删除"
      onClick={(e) => e.stopPropagation()}
      onChange={toggle}
    />
  )
}

/** A coloured type chip that doubles as a type switcher. */
function TypeBadge({ path, kind, value }: { path: Path; kind: ValueKind; value: unknown }) {
  const setValueAt = useStore((s) => s.setValueAt)
  return (
    <select
      className={`type-badge type-${kind}`}
      value={kind}
      title="字段类型（点击可切换）"
      onChange={(e) => {
        const next = e.target.value as ValueKind
        if (next === kind) return
        const result = convertValueToKind(value, next)
        setValueAt(path, result.value)
        if (result.message) notify(result.message)
      }}
    >
      {KIND_OPTIONS.map((k) => (
        <option key={k} value={k}>
          {KIND_LABELS[k]}
        </option>
      ))}
    </select>
  )
}

function ScalarField({
  path,
  value,
  kind,
  hint,
}: {
  path: Path
  value: unknown
  kind: ValueKind
  hint?: FieldHint
}) {
  const setValueAt = useStore((s) => s.setValueAt)

  const alias = useStore(s=>s.anchorMeta.aliases[pathKey(path)])
  if(alias)return <span className="alias-readonly">引用 *{alias} 的值只读，请编辑锚点定义。</span>
  // Use option indices, never String(value): 1, "1", null and "null" differ.
  if (hint?.enumValues && hint.enumValues.length > 0) {
    const options=hint.enumValues
    const index=options.findIndex(v=>JSON.stringify(v)===JSON.stringify(value))
    return <select aria-label="Schema 枚举值" className={index>=0?'field-input':'field-input invalid'} value={index>=0?String(index):''} onChange={e=>{
      if(e.target.value==='')return
      const i=Number(e.target.value);if(Number.isInteger(i)&&i>=0&&i<options.length)setValueAt(path,options[i])
    }}>
      {index<0&&<option value="">当前值不在枚举中</option>}
      {options.map((v,i)=><option key={i} value={String(i)}>{JSON.stringify(v)}</option>)}
    </select>
  }

  if (kind === 'boolean') {
    return (
      <label className="switch">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => setValueAt(path, e.target.checked)}
        />
        <span className="switch-slider" />
        <span className="switch-text">{value ? '开 / true' : '关 / false'}</span>
      </label>
    )
  }

  if (kind === 'null') {
    return <span className="null-tag">（空值）</span>
  }

  return <TextNumberField path={path} value={value} kind={kind} hint={hint} />
}

function TextNumberField({
  path,
  value,
  kind,
  hint,
}: {
  path: Path
  value: unknown
  kind: ValueKind
  hint?: FieldHint
}) {
  const edit=useFieldEdit(path)
  const [local, setLocal] = useState(value == null ? '' : String(value))
  const focused = useRef(false)

  const ownsEdit=edit.current()
  useEffect(() => {
    if (!focused.current || !ownsEdit) setLocal(value == null ? '' : String(value))
  }, [value,ownsEdit])

  // Inline type validation: flag a non-empty value that can't be the kind.
  const numberInvalid =
    kind === 'number' && local.trim() !== '' && Number.isNaN(Number(local))
  const types = hint?.type
    ? Array.isArray(hint.type)
      ? hint.type
      : [hint.type]
    : null
  const schemaType =
    kind === 'string' ? 'string' : kind === 'number' ? 'number' : null
  const schemaInvalid =
    !!types && !!schemaType && local.trim() !== '' && !types.includes(schemaType)
  const invalid = numberInvalid || schemaInvalid
  const errorMsg = numberInvalid
    ? '请输入有效的数字'
    : schemaInvalid
      ? `Schema 要求类型：${types!.join(' / ')}`
      : ''

  const onChange = (raw: string) => {
    setLocal(raw)
    if (kind === 'number') {
      const n = Number(raw)
      if (raw.trim() !== '' && !Number.isNaN(n)) edit.write(n)
    } else {
      edit.write(raw)
    }
  }

  const onBlur = () => {
    focused.current = false
    setLocal(value == null ? '' : String(value))
    edit.end()
  }

  const multiline = kind === 'string' && local.includes('\n')

  if (multiline) {
    return (
      <textarea
        className="field-input field-textarea"
        value={local}
        rows={Math.min(8, local.split('\n').length + 1)}
        data-document-field="true"
        onFocus={() => {focused.current = true;edit.begin()}}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <span className="field-input-wrap">
      <input
        className={invalid ? 'field-input invalid' : 'field-input'}
        type="text"
        inputMode={kind === 'number' ? 'decimal' : undefined}
        placeholder={kind === 'number' ? '输入数字…' : '输入文本…'}
        value={local}
        title={errorMsg || undefined}
        data-document-field="true"
        onFocus={() => {focused.current = true;edit.begin()}}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid && <span className="field-error-msg">{errorMsg}</span>}
    </span>
  )
}

function KeyLabel({ mapPath, name }: { mapPath: Path; name: string }) {
  const renameObjectKey = useStore((s) => s.renameObjectKey)
  const [local, setLocal] = useState(name)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setLocal(name)
  }, [name])

  const commit = () => {
    focused.current = false
    const next = local.trim()
    if (next && next !== name) renameObjectKey(mapPath, name, next)
    else setLocal(name)
  }

  return (
    <input
      className="key-input"
      value={local}
      size={Math.max(2, local.length)}
      title={`字段名：${name}（可直接修改，完整名称可在此查看）`}
      onFocus={() => (focused.current = true)}
      onBlur={commit}
      onChange={(e) => setLocal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/** Draggable grip handle bound to a dnd-kit sortable's listeners. */
function DragHandle({
  attributes,
  listeners,
}: {
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
}) {
  return (
    <span
      className="drag-handle"
      title="拖拽排序（同级之间）"
      {...attributes}
      {...listeners}
    >
      ⠿
    </span>
  )
}

function childCount(value: unknown, kind: ValueKind): number {
  if (kind === 'array') return (value as unknown[]).length
  if (kind === 'object') return Object.keys(value as object).length
  return 0
}

/** One key/value row inside an object. */
function ObjectEntry({
  parentPath,
  name,
  value,
  sortId,
}: {
  parentPath: Path
  name: string
  value: unknown
  sortId: string
}) {
  const deleteAt = useStore((s) => s.deleteAt)
  const schemaObj = useStore((s) => s.schemaObj)
  const childPath = [...parentPath, name]
  const childKind = kindOf(value)
  const nested = childKind === 'object' || childKind === 'array'
  const { open, toggle } = useCollapse(childPath, nested)
  const { selected, toggle: toggleSel } = useSelection(childPath)
  const { active, ref, activate } = useActiveEntry(childPath)
  const hint = schemaObj ? hintAt(schemaObj, childPath) : undefined
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        (isDragging ? 'entry entry-dragging' : 'entry') +
        (selected ? ' entry-selected' : '')
      }
    >
      <div
        ref={ref}
        className={
          (nested ? 'entry-head' : 'entry-head entry-scalar') +
          (active ? ' entry-active' : '')
        }
        onMouseEnter={activate}
        onFocusCapture={activate}
      >
        <span className="entry-lead">
          <SelectBox selected={selected} toggle={toggleSel} />
          <DragHandle attributes={attributes} listeners={listeners} />
          {nested ? (
            <button
              className="collapse-btn"
              title={open ? '折叠' : '展开'}
              onClick={toggle}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="collapse-spacer" />
          )}
          <TypeBadge path={childPath} kind={childKind} value={value} />
        </span>
        <span className="entry-identity">
          <KeyLabel mapPath={parentPath} name={name} />
          {hint?.required && (
            <span className="required-mark" title="Schema 必填字段">
              ✱
            </span>
          )}
          {hint?.description && (
            <span className="field-desc" title={hint.description}>
              ⓘ
            </span>
          )}
          <AnchorBadge path={childPath} />
          {nested && (
            <span className="count-tag">
              {childCount(value, childKind)} {childKind === 'array' ? '项' : '字段'}
            </span>
          )}
        </span>
        {!nested && (
          <span className="inline-value">
            <ScalarField path={childPath} value={value} kind={childKind} hint={hint} />
          </span>
        )}
        <button
          className="btn btn-icon btn-danger entry-del"
          title="删除此字段"
          onClick={() => deleteAt(childPath)}
        >
          ×
        </button>
      </div>
      {nested && open && (
        <div className="entry-body nested">
          <FormNode path={childPath} value={value} />
        </div>
      )}
    </div>
  )
}

/** One item row inside an array. */
function ArrayItem({
  parentPath,
  index,
  value,
  total,
  sortId,
}: {
  parentPath: Path
  index: number
  value: unknown
  total: number
  sortId: string
}) {
  const deleteAt = useStore((s) => s.deleteAt)
  const moveArrayItem = useStore((s) => s.moveArrayItem)
  const schemaObj = useStore((s) => s.schemaObj)
  const childPath = [...parentPath, index]
  const childKind = kindOf(value)
  const nested = childKind === 'object' || childKind === 'array'
  const { open, toggle } = useCollapse(childPath, nested)
  const { selected, toggle: toggleSel } = useSelection(childPath)
  const { active, ref, activate } = useActiveEntry(childPath)
  const hint = schemaObj ? hintAt(schemaObj, childPath) : undefined
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        (isDragging ? 'entry entry-item entry-dragging' : 'entry entry-item') +
        (selected ? ' entry-selected' : '')
      }
    >
      <div
        ref={ref}
        className={
          (nested ? 'entry-head' : 'entry-head entry-scalar') +
          (active ? ' entry-active' : '')
        }
        onMouseEnter={activate}
        onFocusCapture={activate}
      >
        <span className="entry-lead">
          <SelectBox selected={selected} toggle={toggleSel} />
          <DragHandle attributes={attributes} listeners={listeners} />
          {nested ? (
            <button
              className="collapse-btn"
              title={open ? '折叠' : '展开'}
              onClick={toggle}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="collapse-spacer" />
          )}
          <TypeBadge path={childPath} kind={childKind} value={value} />
        </span>
        <span className="entry-identity">
          <span className="index-badge">#{index + 1}</span>
          <AnchorBadge path={childPath} />
          {nested && (
            <span className="count-tag">
              {childCount(value, childKind)} {childKind === 'array' ? '项' : '字段'}
            </span>
          )}
        </span>
        {!nested && (
          <span className="inline-value">
            <ScalarField path={childPath} value={value} kind={childKind} hint={hint} />
          </span>
        )}
        <div className="item-tools">
          <button
            className="btn btn-icon"
            title="上移"
            disabled={index === 0}
            onClick={() => moveArrayItem(parentPath, index, -1)}
          >
            ↑
          </button>
          <button
            className="btn btn-icon"
            title="下移"
            disabled={index === total - 1}
            onClick={() => moveArrayItem(parentPath, index, 1)}
          >
            ↓
          </button>
          <button
            className="btn btn-icon btn-danger"
            title="删除此项"
            onClick={() => deleteAt(childPath)}
          >
            ×
          </button>
        </div>
      </div>
      {nested && open && (
        <div className="entry-body nested">
          <FormNode path={childPath} value={value} />
        </div>
      )}
    </div>
  )
}

function AddKeyControl({ path }: { path: Path }) {
  const addObjectKey = useStore((s) => s.addObjectKey)
  const schemaObj = useStore((s) => s.schemaObj)
  const [key, setKey] = useState('')
  const [kind, setKind] = useState<ValueKind>('string')

  // Suggest property names declared by the schema for this object.
  const listId = `keys-${pathKey(path) || 'root'}`
  const suggestions = schemaObj ? hintAt(schemaObj, path).properties ?? [] : []

  const add = () => {
    const k = key.trim()
    if (!k) return
    addObjectKey(path, k, defaultForKind(kind))
    setKey('')
  }

  return (
    <div className="add-row add-field">
      <input
        className="field-input add-key-input"
        placeholder="新字段名…"
        value={key}
        list={suggestions.length ? listId : undefined}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      )}
      <select
        className={`type-badge type-${kind}`}
        value={kind}
        title="新字段的类型"
        onChange={(e) => setKind(e.target.value as ValueKind)}
      >
        {KIND_OPTIONS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <button className="btn btn-sm btn-add" disabled={!key.trim()} onClick={add}>
        ＋ 添加字段
      </button>
    </div>
  )
}

function AddItemControl({ path }: { path: Path }) {
  const addArrayItem = useStore((s) => s.addArrayItem)
  const [kind, setKind] = useState<ValueKind>('string')
  return (
    <div className="add-row">
      <select
        className={`type-badge type-${kind}`}
        value={kind}
        title="新项的类型"
        onChange={(e) => setKind(e.target.value as ValueKind)}
      >
        {KIND_OPTIONS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <button
        className="btn btn-sm btn-add"
        onClick={() => addArrayItem(path, defaultForKind(kind))}
      >
        ＋ 添加项
      </button>
    </div>
  )
}

/** Shared drag sensors for same-level reordering. */
function useReorderSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

export function FormNode({ path, value }: { path: Path; value: unknown }) {
  const kind = kindOf(value)
  const setValueAt = useStore((s) => s.setValueAt)
  const reorderChildren = useStore((s) => s.reorderChildren)
  const reorderManyChildren = useStore((s) => s.reorderManyChildren)
  const sensors = useReorderSensors()
  const alias = useStore(s=>s.anchorMeta.aliases[pathKey(path)])
  if(alias && (kind==='object'||kind==='array'))return <div className="alias-readonly"><AnchorBadge path={path}/><span>引用值只读；请编辑锚点定义或源码，避免误改引用语义。</span></div>

  if (kind === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
    const ids = keys.map((k) => `k:${k}`)
    const onDragEnd = (e: DragEndEvent) => {
      if (!e.over || e.active.id === e.over.id) return
      const from = ids.indexOf(String(e.active.id))
      const to = ids.indexOf(String(e.over.id))
      if (from < 0 || to < 0) return
      // Batch drag: if the dragged row is part of a multi-selection within
      // this same container, move every selected sibling together.
      const { selected, clearSelected } = useStore.getState()
      const selIdx = keys
        .map((k, i) => ({ i, pk: pathKey([...path, k]) }))
        .filter((x) => selected.includes(x.pk))
        .map((x) => x.i)
      if (selIdx.length > 1 && selIdx.includes(from)) {
        reorderManyChildren(path, selIdx, to)
        clearSelected()
      } else {
        reorderChildren(path, from, to)
      }
    }
    return (
      <div className="node node-object">
        {keys.length === 0 && (
          <div className="empty-hint">还没有字段，点下面的「添加字段」开始 👇</div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {keys.map((k, i) => (
              <ObjectEntry
                key={k}
                parentPath={path}
                name={k}
                value={obj[k]}
                sortId={ids[i]}
              />
            ))}
          </SortableContext>
        </DndContext>
        <AddKeyControl path={path} />
      </div>
    )
  }

  if (kind === 'array') {
    const arr = value as unknown[]
    const ids = arr.map((_, i) => `i:${i}`)
    const onDragEnd = (e: DragEndEvent) => {
      if (!e.over || e.active.id === e.over.id) return
      const from = ids.indexOf(String(e.active.id))
      const to = ids.indexOf(String(e.over.id))
      if (from < 0 || to < 0) return
      const { selected, clearSelected } = useStore.getState()
      const selIdx = arr
        .map((_, i) => ({ i, pk: pathKey([...path, i]) }))
        .filter((x) => selected.includes(x.pk))
        .map((x) => x.i)
      if (selIdx.length > 1 && selIdx.includes(from)) {
        reorderManyChildren(path, selIdx, to)
        clearSelected()
      } else {
        reorderChildren(path, from, to)
      }
    }
    return (
      <div className="node node-array">
        {arr.length === 0 && (
          <div className="empty-hint">空列表，点下面的「添加项」开始 👇</div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {arr.map((item, i) => (
              <ArrayItem
                key={i}
                parentPath={path}
                index={i}
                value={item}
                total={arr.length}
                sortId={ids[i]}
              />
            ))}
          </SortableContext>
        </DndContext>
        <AddItemControl path={path} />
      </div>
    )
  }

  // Empty root document: offer to initialise with a friendly starter.
  if (kind === 'null' && path.length === 0 && value == null) {
    return (
      <div className="node node-empty">
        <div className="empty-state">
          <div className="empty-state-title">从这里开始</div>
          <div className="empty-state-sub">选择一种结构来创建你的第一份 YAML：</div>
          <div className="empty-state-actions">
            <button className="btn btn-add" onClick={() => setValueAt([], {})}>
              🗂 分组（键值对）
            </button>
            <button className="btn btn-add" onClick={() => setValueAt([], [])}>
              📋 列表（多个项）
            </button>
            <button className="btn" onClick={() => setValueAt([], '')}>
              📝 单个文本
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Scalar at the document root.
  return (
    <div className="node node-scalar">
      <ScalarField path={path} value={value} kind={kind} />
    </div>
  )
}
