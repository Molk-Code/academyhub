import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { uploadWithQuota } from '@/lib/uploadWithQuota'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { PrizeDoc, PrizeClaimDoc, UserDoc } from '@/types'
import { Gift, Plus, CheckCircle2, XCircle, Sparkles, ImagePlus, X, Pencil, Trash2 } from 'lucide-react'
import Avatar from '@/components/common/Avatar'

const schema = z.object({
  title:       z.string().min(2),
  description: z.string().min(5),
  pointsCost:  z.coerce.number().min(1),
})
type FormData = z.infer<typeof schema>

export default function PrizeManager() {
  const { profile } = useAuth()
  const [showForm,     setShowForm]    = useState(false)
  const [editingPrize, setEditingPrize]= useState<PrizeDoc | null>(null)
  const [saving,       setSaving]      = useState(false)
  const [imageFile,    setImageFile]   = useState<File | null>(null)
  const [imagePreview, setImagePreview]= useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: prizes } = useCollection<PrizeDoc>('prizes')
  const { data: claims  } = useCollection<PrizeClaimDoc>('prize_claims', [where('status', '==', 'pending')])
  const { data: students } = useCollection<UserDoc>('users', [where('role', '==', 'student')])
  const studentMap = Object.fromEntries(students.map(s => [s.uid, s]))

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { pointsCost: 100 },
  })

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setImageFile(file)
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => setImagePreview(reader.result as string)
      reader.readAsDataURL(file)
    } else {
      setImagePreview(null)
    }
  }

  function clearImage() {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function startEdit(prize: PrizeDoc) {
    setEditingPrize(prize)
    reset({ title: prize.title, description: prize.description, pointsCost: prize.pointsCost })
    setImagePreview(prize.imageUrl ?? null)
    setShowForm(true)
  }

  async function deletePrize(prize: PrizeDoc) {
    if (!confirm(`Delete "${prize.title}"? This cannot be undone.`)) return
    await deleteDoc(doc(db, 'prizes', prize.id))
  }

  async function onSubmit(data: FormData) {
    if (!profile) return
    setSaving(true)
    try {
      let imageUrl: string | null = editingPrize?.imageUrl ?? null
      if (imageFile) {
        imageUrl = await uploadWithQuota(imageFile, `prizes/${Date.now()}_${imageFile.name}`)
      }
      if (editingPrize) {
        await updateDoc(doc(db, 'prizes', editingPrize.id), { ...data, imageUrl })
        setEditingPrize(null)
      } else {
        await addDoc(collection(db, 'prizes'), {
          ...data,
          imageUrl,
          quantity:        null,
          quantityClaimed: 0,
          isActive:        true,
          createdBy:       profile.uid,
          cohortIds:       null,
        })
      }
      reset()
      clearImage()
      setShowForm(false)
    } catch (e) {
      console.error('Failed to save prize:', e)
    } finally {
      setSaving(false)
    }
  }

  async function fulfillClaim(claimId: string) {
    await httpsCallable(functions, 'fulfillClaim')({ claimId, action: 'fulfilled' })
  }

  async function rejectClaim(claimId: string) {
    await httpsCallable(functions, 'fulfillClaim')({ claimId, action: 'rejected' })
  }

  async function toggleActive(prize: PrizeDoc) {
    await updateDoc(doc(db, 'prizes', prize.id), { isActive: !prize.isActive })
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Prize Manager</h1>
          <p className="text-zinc-400 text-sm mt-1">Create rewards students can redeem with their points.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary py-2.5">
          <Plus className="w-4 h-4" /> Add Prize
        </button>
      </div>

      {/* New prize form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">{editingPrize ? 'Edit prize' : 'New prize'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label text-zinc-300">Title</label>
              <input {...register('title')} className="input bg-zinc-700 border-slate-600 text-white" placeholder="e.g. Coffee voucher" />
              {errors.title && <p className="text-xs text-rose-400 mt-1">{errors.title.message}</p>}
            </div>
            <div>
              <label className="label text-zinc-300">Point cost</label>
              <input {...register('pointsCost')} type="number" min="1" className="input bg-zinc-700 border-slate-600 text-white" />
              {errors.pointsCost && <p className="text-xs text-rose-400 mt-1">{errors.pointsCost.message}</p>}
            </div>
          </div>
          <div>
            <label className="label text-zinc-300">Description</label>
            <textarea {...register('description')} rows={2} className="input bg-zinc-700 border-slate-600 text-white resize-none" />
            {errors.description && <p className="text-xs text-rose-400 mt-1">{errors.description.message}</p>}
          </div>
          <div>
            <label className="label text-zinc-300">Image <span className="text-zinc-500">(optional)</span></label>
            {imagePreview ? (
              <div className="relative w-32 h-32 rounded-xl overflow-hidden group">
                <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-1 right-1 p-1 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-slate-600 text-zinc-400 hover:border-brand-500 hover:text-brand-400 transition-colors text-sm"
              >
                <ImagePlus className="w-4 h-4" /> Upload image
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary py-2">
              {saving ? 'Saving…' : 'Create prize'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditingPrize(null); reset() }} className="btn-secondary bg-zinc-700 border-slate-600 text-zinc-300 hover:bg-slate-600 py-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Pending claims */}
      {claims.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-white mb-3">Pending Claims ({claims.length})</h2>
          <div className="space-y-2">
            {claims.map(claim => {
              const student = studentMap[claim.studentId]
              const prize   = prizes.find(p => p.id === claim.prizeId)
              return (
                <div key={claim.id} className="flex items-center gap-3 p-4 bg-slate-800 rounded-xl">
                  {student && <Avatar uid={student.uid} name={student.displayName} size="sm" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{student?.displayName}</p>
                    <p className="text-xs text-zinc-400">wants: <span className="text-amber-400">{prize?.title}</span></p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-amber-400 mr-2">
                    <Sparkles className="w-3.5 h-3.5" />
                    {claim.pointsSpent} pts
                  </div>
                  <button onClick={() => fulfillClaim(claim.id)} className="p-1.5 text-emerald-400 hover:text-emerald-300 transition-colors" title="Fulfil">
                    <CheckCircle2 className="w-5 h-5" />
                  </button>
                  <button onClick={() => rejectClaim(claim.id)} className="p-1.5 text-rose-400 hover:text-rose-300 transition-colors" title="Reject">
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Prize list */}
      <div>
        <h2 className="text-base font-semibold text-white mb-3">All Prizes</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {prizes.map(prize => (
            <div key={prize.id} className={`bg-slate-800 rounded-xl overflow-hidden ${!prize.isActive ? 'opacity-50' : ''}`}>
              {prize.imageUrl && (
                <img src={prize.imageUrl} alt={prize.title} className="w-full h-32 object-cover" />
              )}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-white text-sm">{prize.title}</h3>
                  <div className="flex items-center gap-1 text-amber-400 text-xs font-bold">
                    <Sparkles className="w-3 h-3" />
                    {prize.pointsCost}
                  </div>
                </div>
                <p className="text-xs text-zinc-400 line-clamp-2">{prize.description}</p>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(prize)} className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-lg transition-colors" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deletePrize(prize)} className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => toggleActive(prize)}
                    className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${
                      prize.isActive
                        ? 'text-rose-400 hover:bg-rose-900/30'
                        : 'text-emerald-400 hover:bg-emerald-900/30'
                    }`}
                  >
                    {prize.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {prizes.length === 0 && (
            <div className="col-span-3 flex items-center justify-center gap-3 py-12 text-zinc-500">
              <Gift className="w-6 h-6" />
              <span className="text-sm">No prizes yet. Add one above.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
