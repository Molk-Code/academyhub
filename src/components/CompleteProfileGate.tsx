import { useState, useRef } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { uploadWithQuota } from '@/lib/uploadWithQuota'
import { useAuth } from '@/contexts/AuthContext'
import { cn, initials, avatarColor } from '@/lib/utils'
import { Camera, Loader2, CheckCircle2, User, Phone, Mail } from 'lucide-react'
import firePng from '@/assets/fire.png'

export default function CompleteProfileGate({ children }: { children: React.ReactNode }) {
  const { profile, refreshProfile } = useAuth()

  const isComplete = !!(profile?.avatarUrl && profile?.phoneNumber?.trim() && profile?.schoolEmail?.trim())
  if (!profile || isComplete) return <>{children}</>

  return (
    <>
      {children}
      <ProfileCompleteOverlay />
    </>
  )
}

function ProfileCompleteOverlay() {
  const { profile, refreshProfile } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [name,         setName]         = useState(profile?.displayName ?? '')
  const [phone,        setPhone]        = useState(profile?.phoneNumber ?? '')
  const [schoolEmail,  setSchoolEmail]  = useState(profile?.schoolEmail ?? '')
  const [avatarFile,   setAvatarFile]   = useState<File | null>(null)
  const [preview,      setPreview]      = useState<string | null>(profile?.avatarUrl ?? null)
  const [uploading,    setUploading]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [photoError,   setPhotoError]   = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setPreview(URL.createObjectURL(file))
    setPhotoError(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (!avatarFile && !profile.avatarUrl) { setPhotoError(true); return }

    setSaving(true)
    try {
      let avatarUrl = profile.avatarUrl ?? null

      if (avatarFile) {
        setUploading(true)
        const path = `avatars/${profile.uid}`
        avatarUrl  = await uploadWithQuota(avatarFile, path)
        setUploading(false)
      }

      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: name.trim() || profile.displayName,
        phoneNumber: phone.trim(),
        schoolEmail: schoolEmail.trim(),
        ...(avatarUrl ? { avatarUrl } : {}),
      })

      await refreshProfile()
    } catch (err) {
      console.error('Profile save failed', err)
    } finally {
      setSaving(false)
      setUploading(false)
    }
  }

  const busy = saving || uploading
  const canSubmit = !busy && name.trim() && phone.trim() && schoolEmail.trim() && (!!avatarFile || !!profile?.avatarUrl)

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-900/50 flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-4">
            <img src={firePng} alt="CineForge" className="w-12 h-12 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Complete your profile</h1>
          <p className="text-zinc-500 text-sm">
            Add a photo, confirm your name, and enter your phone number to continue.
          </p>
        </div>

        <form onSubmit={handleSave} className="bg-zinc-900 rounded-2xl border border-white/10 p-6 space-y-6 shadow-sm">

          {/* Photo upload */}
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="relative group focus:outline-none"
            >
              {preview ? (
                <img
                  src={preview}
                  alt="Profile"
                  className="w-24 h-24 rounded-full object-cover ring-4 ring-white shadow-md"
                />
              ) : (
                <div className={cn(
                  'w-24 h-24 rounded-full flex items-center justify-center text-white text-2xl font-bold ring-4 ring-white shadow-md',
                  profile ? avatarColor(profile.uid) : 'bg-slate-300',
                )}>
                  {profile ? initials(profile.displayName) : <User className="w-8 h-8" />}
                </div>
              )}
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploading
                  ? <Loader2 className="w-6 h-6 text-white animate-spin" />
                  : <Camera className="w-6 h-6 text-white" />
                }
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="text-center">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-brand-600 hover:text-brand-700 font-medium disabled:opacity-50"
              >
                {preview ? 'Change photo' : 'Upload profile photo *'}
              </button>
              <p className="text-xs text-zinc-400 mt-0.5">JPG, PNG or WebP · max 5 MB</p>
            </div>
            {photoError && (
              <p className="text-xs text-rose-600 font-medium">A profile photo is required.</p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="label flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Full name *
            </label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="input w-full"
              placeholder="Your full name"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="label flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" /> Phone number *
            </label>
            <input
              required
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="input w-full"
              placeholder="+46 70 000 00 00"
            />
          </div>

          {/* School email */}
          <div>
            <label className="label flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> School email *
            </label>
            <input
              required
              type="email"
              value={schoolEmail}
              onChange={e => setSchoolEmail(e.target.value)}
              className="input w-full"
              placeholder="firstname.lastname@school.se"
            />
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full btn-primary py-3 text-base disabled:opacity-50"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {uploading ? 'Uploading photo…' : 'Saving…'}
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Continue to CineForge
              </span>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
