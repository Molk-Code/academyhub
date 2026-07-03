import { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { doc, setDoc, serverTimestamp, collection, addDoc, deleteDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { formatDistanceToNow } from 'date-fns'
import { ClipboardList, ListTodo, MessageSquare, Plus, Trash2, GripVertical, Check, ChevronRight, TrendingUp, Lightbulb } from 'lucide-react'
import Avatar from '@/components/common/Avatar'
import { useDocument, useCollection, where, orderBy } from '@/hooks/useFirestore'
import type { DevelopmentPlan, PlanComment, TodoDoc, NopraStepKey, TodoCategory, TeacherAssessment } from '@/types'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ── NOPRA step definitions ─────────────────────────────────────────────────────

interface StepDef {
  key: NopraStepKey
  abbrev: string
  label: string
  prompt: string
  colors: { bg: string; light: string; text: string; border: string; activeBg: string }
}

const STEPS: StepDef[] = [
  {
    key: 'situation', abbrev: 'N', label: 'Now',
    prompt: "Describe your current situation — what's working, what's not?",
    colors: { bg: 'bg-sky-500', light: 'bg-sky-950/40', text: 'text-sky-300', border: 'border-sky-800/50', activeBg: 'bg-sky-500' },
  },
  {
    key: 'goal', abbrev: 'O', label: 'Objective',
    prompt: 'What does success look like for you? Be specific.',
    colors: { bg: 'bg-violet-500', light: 'bg-violet-950/40', text: 'text-violet-300', border: 'border-violet-800/50', activeBg: 'bg-violet-500' },
  },
  {
    key: 'obstacles', abbrev: 'P', label: 'Problems',
    prompt: 'What obstacles are getting in the way?',
    colors: { bg: 'bg-amber-500', light: 'bg-amber-950/40', text: 'text-amber-300', border: 'border-amber-800/50', activeBg: 'bg-amber-500' },
  },
  {
    key: 'resources', abbrev: 'R', label: 'Resources',
    prompt: 'What strengths, people, or tools do you have available?',
    colors: { bg: 'bg-emerald-500', light: 'bg-emerald-950/40', text: 'text-emerald-300', border: 'border-emerald-800/50', activeBg: 'bg-emerald-500' },
  },
  {
    key: 'action', abbrev: 'A', label: 'Actions',
    prompt: 'List 3 concrete steps you will take this week.',
    colors: { bg: 'bg-orange-500', light: 'bg-orange-950/40', text: 'text-orange-300', border: 'border-orange-800/50', activeBg: 'bg-orange-500' },
  },
  {
    key: 'evaluation', abbrev: 'E', label: 'Follow Up',
    prompt: "How will you know you're making progress? When will you check in?",
    colors: { bg: 'bg-rose-500', light: 'bg-rose-950/40', text: 'text-rose-300', border: 'border-rose-800/50', activeBg: 'bg-rose-500' },
  },
]

// ── Sortable todo item ─────────────────────────────────────────────────────────

function SortableTodoItem({
  todo,
  fading,
  onToggle,
  onDelete,
}: {
  todo: TodoDoc
  fading: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : fading ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-xl px-3 py-2.5 group"
    >
      <button
        {...attributes}
        {...listeners}
        className="text-zinc-300 hover:text-zinc-500 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <button
        onClick={onToggle}
        className="flex-shrink-0 w-5 h-5 rounded border-2 border-white/15 hover:border-brand-500 flex items-center justify-center transition-colors"
      >
        {fading && <Check className="w-3 h-3 text-emerald-600" />}
      </button>
      <span className={`flex-1 text-sm text-zinc-200 ${fading ? 'line-through text-zinc-400' : ''}`}>
        {todo.title}
      </span>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-rose-600 transition-all flex-shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── NOPRA tab ──────────────────────────────────────────────────────────────────

function NopraTab() {
  const { profile, cohortId } = useAuth()
  const [activeStep, setActiveStep] = useState<NopraStepKey>('situation')
  const [draftText, setDraftText] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [commentText, setCommentText] = useState('')
  const initialized = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: plan } = useDocument<DevelopmentPlan>('development_plans', profile?.uid)
  const { data: assessment } = useDocument<TeacherAssessment>('teacher_assessments', profile?.uid)
  const { data: comments } = useCollection<PlanComment>(
    'plan_comments',
    profile ? [where('studentId', '==', profile.uid), orderBy('createdAt', 'asc')] : [],
    !!profile?.uid,
  )

  useEffect(() => {
    if (plan && !initialized.current) {
      setDraftText(plan[activeStep] ?? '')
      initialized.current = true
    }
  }, [plan])

  const stepComments = useMemo(
    () => comments.filter(c => c.step === activeStep),
    [comments, activeStep],
  )

  const commentsByStep = useMemo(() => {
    const map: Partial<Record<NopraStepKey, number>> = {}
    for (const c of comments) {
      map[c.step] = (map[c.step] ?? 0) + 1
    }
    return map
  }, [comments])

  async function savePlan(step: NopraStepKey, text: string) {
    if (!profile) return
    setSaveStatus('saving')
    try {
      await setDoc(
        doc(db, 'development_plans', profile.uid),
        { studentId: profile.uid, cohortId: cohortId ?? null, [step]: text, updatedAt: serverTimestamp() },
        { merge: true },
      )
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('idle')
    }
  }

  function handleTextChange(value: string) {
    setDraftText(value)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => savePlan(activeStep, value), 1000)
  }

  function handleStepChange(step: NopraStepKey) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
      savePlan(activeStep, draftText)
    }
    setActiveStep(step)
    setDraftText(plan?.[step] ?? '')
  }

  const stepDef = STEPS.find(s => s.key === activeStep)!

  useEffect(() => {
    const activeEl = document.querySelector('.step-active')
    if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeStep])

  return (
    <div className="space-y-6">
      {/* Flow diagram */}
      <div className="steps-nav bg-zinc-900 border border-white/10 rounded-2xl p-4 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex items-center gap-1 min-w-max mx-auto w-fit">
          {STEPS.map((step, i) => {
            const isActive = step.key === activeStep
            const commentCount = commentsByStep[step.key] ?? 0
            return (
              <div key={step.key} className="flex items-center flex-shrink-0">
                <button
                  onClick={() => handleStepChange(step.key)}
                  className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
                    isActive
                      ? `${step.colors.light} ${step.colors.border} border-2 shadow-sm step-active`
                      : 'hover:bg-white/5 border-2 border-transparent'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white ${isActive ? step.colors.bg : 'bg-slate-300'}`}>
                    {step.abbrev}
                  </div>
                  <span className={`text-[11px] font-medium whitespace-nowrap ${isActive ? step.colors.text : 'text-zinc-500'}`}>
                    {step.label}
                  </span>
                  {commentCount > 0 && (
                    <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-white text-[9px] font-bold px-1 ${step.colors.bg}`}>
                      {commentCount}
                    </span>
                  )}
                </button>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="w-4 h-4 text-zinc-300 flex-shrink-0 mx-0.5" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Step editor */}
      <div className={`bg-zinc-900 border-2 rounded-2xl p-5 space-y-3 ${stepDef.colors.border}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${stepDef.colors.bg}`}>
              {stepDef.abbrev}
            </div>
            <h2 className="text-base font-semibold text-zinc-100">{stepDef.label}</h2>
          </div>
          <span className={`text-xs ${saveStatus === 'idle' ? 'text-zinc-400' : saveStatus === 'saving' ? 'text-amber-500' : 'text-emerald-600'}`}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : ''}
          </span>
        </div>
        <p className="text-sm text-zinc-500">{stepDef.prompt}</p>
        <textarea
          value={draftText}
          onChange={e => handleTextChange(e.target.value)}
          rows={6}
          className="input w-full resize-none text-sm"
          placeholder="Write your thoughts here…"
        />
      </div>

      {/* Teacher comments for this step */}
      {stepComments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-zinc-400" /> Teacher feedback
          </h3>
          <div className="space-y-2">
            {stepComments.map(c => (
              <div key={c.id} className="bg-zinc-900 border border-white/10 rounded-xl p-4 flex gap-3">
                <Avatar uid={c.teacherId} name={c.teacherName} avatarUrl={c.teacherAvatarUrl} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-100">{c.teacherName}</span>
                    <span className="text-xs text-zinc-400">
                      {c.createdAt ? formatDistanceToNow(c.createdAt.toDate(), { addSuffix: true }) : ''}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 mt-1 whitespace-pre-wrap">{c.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Teacher assessment — strengths & developments */}
      {(assessment?.strengths || assessment?.developments) && (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-100">Teacher Assessment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {assessment.strengths && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> Strengths
                </p>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-800/50 rounded-xl p-4 leading-relaxed">
                  {assessment.strengths}
                </p>
              </div>
            )}
            {assessment.developments && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5" /> Areas for Development
                </p>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-800/50 rounded-xl p-4 leading-relaxed">
                  {assessment.developments}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Todo tab ───────────────────────────────────────────────────────────────────

function TodoTab() {
  const { profile } = useAuth()

  const { data: rawTodos } = useCollection<TodoDoc>(
    'todos',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile?.uid,
  )

  // Local state for optimistic DnD updates
  const [localTodos, setLocalTodos] = useState<TodoDoc[]>([])
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addingIn, setAddingIn] = useState<TodoCategory | null>(null)
  const [newTitle, setNewTitle] = useState('')

  // Sync from Firestore whenever data changes, but not during an active drag
  useEffect(() => {
    if (activeId) return
    setLocalTodos(rawTodos)
  }, [rawTodos, activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const urgentItems = useMemo(
    () => localTodos.filter(t => t.category === 'urgent' && !t.isCompleted).sort((a, b) => a.order - b.order),
    [localTodos],
  )
  const todoItems = useMemo(
    () => localTodos.filter(t => t.category === 'todo' && !t.isCompleted).sort((a, b) => a.order - b.order),
    [localTodos],
  )

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function findContainer(id: string): TodoCategory | null {
    if (urgentItems.find(i => i.id === id)) return 'urgent'
    if (todoItems.find(i => i.id === id)) return 'todo'
    return null
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = active.id as string
    const overId = over.id as string
    const activeContainer = findContainer(activeId)
    const overContainer = (findContainer(overId) ?? overId) as TodoCategory
    if (!activeContainer || activeContainer === overContainer) return

    setLocalTodos(prev => {
      const activeArr = prev.filter(t => t.category === activeContainer && !t.isCompleted)
      const overArr   = prev.filter(t => t.category === overContainer   && !t.isCompleted)
      const activeIdx = activeArr.findIndex(t => t.id === activeId)
      const overIdx   = overArr.findIndex(t => t.id === overId)
      const movedItem = { ...activeArr[activeIdx], category: overContainer }
      const newActiveArr = activeArr.filter(t => t.id !== activeId)
      const newOverArr   = [...overArr]
      newOverArr.splice(overIdx >= 0 ? overIdx : newOverArr.length, 0, movedItem)
      return prev.map(t => {
        const inActive = newActiveArr.find(x => x.id === t.id)
        if (inActive) return inActive
        const inOver = newOverArr.find(x => x.id === t.id)
        if (inOver) return inOver
        if (t.id === activeId) return movedItem
        return t
      })
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const activeId = active.id as string
    const overId   = over.id as string
    const activeContainer = findContainer(activeId)
    if (!activeContainer) return

    const containerItems = activeContainer === 'urgent' ? urgentItems : todoItems
    const oldIdx = containerItems.findIndex(t => t.id === activeId)
    const newIdx = containerItems.findIndex(t => t.id === overId)

    let finalItems: TodoDoc[]
    if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
      finalItems = arrayMove(containerItems, oldIdx, newIdx)
      setLocalTodos(prev => {
        const others = prev.filter(t => !(t.category === activeContainer && !t.isCompleted))
        return [...others, ...finalItems]
      })
    } else {
      finalItems = containerItems
    }

    // Persist order + category
    const moved = localTodos.find(t => t.id === activeId)
    if (moved) {
      updateDoc(doc(db, 'todos', activeId), { category: moved.category })
    }
    finalItems.forEach((t, i) => {
      updateDoc(doc(db, 'todos', t.id), { order: i })
    })
  }

  async function addTodo(category: TodoCategory) {
    if (!profile || !newTitle.trim()) return
    const title = newTitle.trim()
    setNewTitle('')
    setAddingIn(null)
    const items = category === 'urgent' ? urgentItems : todoItems
    await addDoc(collection(db, 'todos'), {
      studentId:   profile.uid,
      title,
      description: '',
      category,
      isCompleted: false,
      completedAt: null,
      createdAt:   serverTimestamp(),
      order:       items.length,
    })
  }

  async function toggleTodo(todo: TodoDoc) {
    setFadingIds(prev => new Set([...prev, todo.id]))
    setTimeout(async () => {
      await updateDoc(doc(db, 'todos', todo.id), {
        isCompleted: true,
        completedAt: serverTimestamp(),
      })
      setFadingIds(prev => { const s = new Set(prev); s.delete(todo.id); return s })
    }, 1000)
  }

  async function deleteTodo(id: string) {
    await deleteDoc(doc(db, 'todos', id))
  }

  const activeTodo = activeId ? localTodos.find(t => t.id === activeId) : null

  function Column({ category, items, label, color }: {
    category: TodoCategory
    items: TodoDoc[]
    label: string
    color: { bg: string; light: string; text: string; border: string }
  }) {
    return (
      <div className={`flex-1 bg-zinc-900 rounded-2xl border-2 ${color.border} overflow-hidden`}>
        <div className={`px-4 py-3 ${color.light} border-b ${color.border} flex items-center justify-between`}>
          <h3 className={`text-sm font-bold ${color.text}`}>{label}</h3>
          <button
            onClick={() => { setAddingIn(category); setNewTitle('') }}
            className={`p-1 rounded-lg ${color.text} hover:${color.light} transition-colors`}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 space-y-2 min-h-[120px]">
          {addingIn === category && (
            <form
              onSubmit={e => { e.preventDefault(); addTodo(category) }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setAddingIn(null)}
                className="input flex-1 text-sm py-1.5"
                placeholder="Task title…"
              />
              <button type="submit" className="btn-primary py-1.5 px-3 text-sm">Add</button>
              <button type="button" onClick={() => setAddingIn(null)} className="btn-secondary py-1.5 px-3 text-sm">✕</button>
            </form>
          )}
          <SortableContext items={items.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {items.map(todo => (
              <SortableTodoItem
                key={todo.id}
                todo={todo}
                fading={fadingIds.has(todo.id)}
                onToggle={() => toggleTodo(todo)}
                onDelete={() => deleteTodo(todo.id)}
              />
            ))}
          </SortableContext>
          {items.length === 0 && !addingIn && (
            <p className="text-xs text-zinc-400 text-center py-4">No tasks — press + to add one</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col sm:flex-row gap-4">
        <Column
          category="urgent"
          items={urgentItems}
          label="🔴 Urgent"
          color={{ bg: 'bg-rose-500', light: 'bg-rose-950/40', text: 'text-rose-300', border: 'border-rose-800/50' }}
        />
        <Column
          category="todo"
          items={todoItems}
          label="🔵 To-Do"
          color={{ bg: 'bg-blue-500', light: 'bg-blue-950/40', text: 'text-blue-300', border: 'border-blue-800/50' }}
        />
      </div>
      <DragOverlay>
        {activeTodo && (
          <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-xl px-3 py-2.5 shadow-xl opacity-90">
            <GripVertical className="w-4 h-4 text-zinc-300" />
            <span className="text-sm text-zinc-200">{activeTodo.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function MyPlan() {
  const { state: locState } = useLocation()
  const [tab, setTab] = useState<'plan' | 'todos'>((locState as any)?.tab ?? 'todos')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">My Development Plan</h1>
        <p className="text-zinc-500 text-sm mt-1">Track your learning goals with the NOPRA framework, and manage your personal tasks.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('todos')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'todos' ? 'bg-zinc-900 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <ListTodo className="w-4 h-4" /> To-Do
        </button>
        <button
          onClick={() => setTab('plan')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'plan' ? 'bg-zinc-900 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <ClipboardList className="w-4 h-4" /> My Plan
        </button>
      </div>

      {tab === 'todos' ? <TodoTab /> : <NopraTab />}
    </div>
  )
}
