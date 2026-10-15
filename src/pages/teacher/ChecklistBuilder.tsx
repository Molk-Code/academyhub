import { useState, useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  collection, addDoc, updateDoc, doc, getDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { SubjectDoc, CohortDoc, ChecklistItem } from '@/types'
import { Plus, Trash2, GripVertical, ListTodo } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ItemState { id: string; text: string }

interface ChecklistFormData {
  subjectId: string
  cohortId: string
  title: string
  description: string
  dueDate: string
  pointsValue: number
  isPublished: boolean
}

const schema = z.object({
  subjectId:   z.string().min(1, 'Select a subject'),
  cohortId:    z.string().min(1, 'Select a class'),
  title:       z.string().min(2, 'Title required'),
  description: z.string().optional(),
  dueDate:     z.string().min(1, 'Due date required'),
  pointsValue: z.coerce.number().min(1),
  isPublished: z.boolean(),
})

// ── Sortable checklist item row ────────────────────────────────────────────────

function ItemRow({
  item, index, onChange, onRemove, removable,
}: {
  item: ItemState
  index: number
  onChange: (id: string, text: string) => void
  onRemove: (id: string) => void
  removable: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-xl px-3 py-2">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-zinc-500 hover:text-zinc-300 touch-none flex-shrink-0"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="text-xs font-mono text-zinc-500 w-5 flex-shrink-0 text-center">{index + 1}</span>
      <input
        value={item.text}
        onChange={e => onChange(item.id, e.target.value)}
        placeholder="Step the student needs to complete…"
        className="flex-1 text-sm border-0 bg-transparent focus:outline-none text-zinc-200 placeholder:text-zinc-500 py-1"
      />
      {removable && (
        <button type="button" onClick={() => onRemove(item.id)} className="p-1 text-zinc-500 hover:text-rose-400 transition-colors flex-shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChecklistBuilder() {
  const navigate = useNavigate()
  const { id: editId } = useParams<{ id: string }>()
  const isEditing = !!editId
  const { profile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [items, setItems] = useState<ItemState[]>([{ id: nanoid(8), text: '' }])
  const [itemsError, setItemsError] = useState('')
  const [assignmentId, setAssignmentId] = useState<string | null>(null)

  const { data: subjects } = useCollection<SubjectDoc>('subjects')
  const { data: cohorts }  = useCollection<CohortDoc>('cohorts')

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<ChecklistFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      pointsValue: 10,
      isPublished: false,
    },
  })

  // Load existing checklist for edit mode — editId is the CHECKLIST doc ID
  useEffect(() => {
    if (!editId) return
    getDoc(doc(db, 'checklists', editId)).then(async checklistSnap => {
      if (!checklistSnap.exists()) return
      const c = checklistSnap.data() as any
      const aId: string = c.assignmentId
      setAssignmentId(aId)

      const assignSnap = await getDoc(doc(db, 'assignments', aId))
      if (!assignSnap.exists()) return
      const a = assignSnap.data()
      const dueDate = a.dueDate?.toDate?.()
      const dueDateStr = dueDate
        ? new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : ''
      reset({
        subjectId:   a.subjectId ?? '',
        cohortId:    a.cohortId ?? '',
        title:       a.title ?? '',
        description: a.description ?? '',
        dueDate:     dueDateStr,
        pointsValue: a.pointsValue ?? 10,
        isPublished: a.isPublished ?? false,
      })
      const loadedItems = ((c.items ?? []) as ChecklistItem[]).map(i => ({ id: i.id ?? nanoid(8), text: i.text }))
      setItems(loadedItems.length > 0 ? loadedItems : [{ id: nanoid(8), text: '' }])
    })
  }, [editId, reset])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setItems(prev => {
      const oi = prev.findIndex(i => i.id === active.id)
      const ni = prev.findIndex(i => i.id === over.id)
      return arrayMove(prev, oi, ni)
    })
  }

  function addItem() {
    setItems(prev => [...prev, { id: nanoid(8), text: '' }])
    setItemsError('')
  }

  const updateItem = useCallback((id: string, text: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, text } : i))
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  async function onSubmit(data: ChecklistFormData) {
    const trimmed = items.map(i => ({ ...i, text: i.text.trim() })).filter(i => i.text)
    if (trimmed.length === 0) { setItemsError('Add at least one step.'); return }
    if (!profile) return
    setSaving(true)
    try {
      const itemsPayload: ChecklistItem[] = trimmed.map(i => ({ id: i.id, text: i.text }))

      const assignPayload = {
        subjectId:    data.subjectId,
        cohortId:     data.cohortId,
        title:        data.title,
        description:  data.description ?? '',
        type:         'checklist',
        dueDate:      Timestamp.fromDate(new Date(data.dueDate)),
        pointsValue:  data.pointsValue,
        passingScore: null,
        resources:    [],
        isPublished:  data.isPublished,
      }

      const checklistPayload = {
        items:       itemsPayload,
        isPublished: data.isPublished,
      }

      if (isEditing && editId && assignmentId) {
        await updateDoc(doc(db, 'assignments', assignmentId), assignPayload)
        await updateDoc(doc(db, 'checklists', editId), checklistPayload)
      } else {
        const assignRef = await addDoc(collection(db, 'assignments'), {
          ...assignPayload,
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
        })
        await addDoc(collection(db, 'checklists'), {
          ...checklistPayload,
          assignmentId: assignRef.id,
          createdBy:    profile.uid,
          createdAt:    serverTimestamp(),
        })
      }

      navigate('/teacher/assignments')
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="page-title">{isEditing ? 'Edit Checklist' : 'New Checklist'}</h1>
        <p className="text-zinc-400 text-sm mt-1">Build a step-by-step checklist students complete and submit — no grading required.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* ── Checklist details ─────────────────────────────────────────────── */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-6 space-y-4">
          <h2 className="text-base font-semibold text-zinc-200">Checklist details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Subject</label>
              <select {...register('subjectId')} className="input">
                <option value="">Select…</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>)}
              </select>
              {errors.subjectId && <p className="text-xs text-rose-500 mt-1">{errors.subjectId.message}</p>}
            </div>
            <div>
              <label className="label">Class</label>
              <select {...register('cohortId')} className="input">
                <option value="">Select…</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.cohortId && <p className="text-xs text-rose-500 mt-1">{errors.cohortId.message}</p>}
            </div>
          </div>

          <div>
            <label className="label">Checklist title</label>
            <input {...register('title')} className="input" placeholder="e.g. Camera Wrap Procedure" />
            {errors.title && <p className="text-xs text-rose-500 mt-1">{errors.title.message}</p>}
          </div>

          <div>
            <label className="label">Description <span className="text-zinc-400 font-normal">(optional)</span></label>
            <textarea {...register('description')} rows={2} className="input resize-none" placeholder="Instructions for students…" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Due date</label>
              <input {...register('dueDate')} type="datetime-local" className="input" />
              {errors.dueDate && <p className="text-xs text-rose-500 mt-1">{errors.dueDate.message}</p>}
            </div>
            <div>
              <label className="label">Points on completion</label>
              <input {...register('pointsValue')} type="number" min="1" className="input" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Controller
              control={control}
              name="isPublished"
              render={({ field }) => (
                <input type="checkbox" checked={field.value} onChange={field.onChange}
                  className="w-4 h-4 rounded border-white/15 text-brand-600 focus:ring-brand-500" />
              )}
            />
            <span className="text-sm text-zinc-300">Publish immediately</span>
          </label>
        </div>

        {/* ── Steps ─────────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-200">
              Steps
              <span className="text-zinc-400 font-normal text-sm ml-2">
                {items.length} step{items.length !== 1 ? 's' : ''}
              </span>
            </h2>
          </div>

          {itemsError && <p className="text-sm text-rose-500">{itemsError}</p>}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {items.map((item, i) => (
                  <ItemRow key={item.id} item={item} index={i} onChange={updateItem} onRemove={removeItem} removable={items.length > 1} />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 bg-zinc-900/50 hover:bg-brand-50 hover:text-brand-700 border border-dashed border-white/10 hover:border-brand-200 rounded-xl transition-all"
          >
            <Plus className="w-4 h-4" /> Add step
          </button>

          <p className="text-xs text-zinc-500 flex items-center gap-1.5">
            <ListTodo className="w-3.5 h-3.5" /> Students check off each step and submit once every step is marked complete.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary py-2.5 px-6">
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create checklist (draft)'}
          </button>
          <button type="button" onClick={() => navigate('/teacher/assignments')} className="btn-secondary py-2.5 px-6">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
