import { useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Clock, Trophy, Link2, Video, FileText, Youtube, PlayCircle, Upload, CheckCircle2, Loader2, X, Paperclip } from 'lucide-react'
import Breadcrumb from '@/components/common/Breadcrumb'
import { useDocument } from '@/hooks/useFirestore'
import { useCollection, where } from '@/hooks/useFirestore'
import { shortDate, toDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { isPast } from 'date-fns'
import type { AssignmentDoc, SubjectDoc, SubmissionDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { useAuth } from '@/contexts/AuthContext'
import { uploadFile } from '@/lib/cloudinary'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

function ResourceIcon({ type }: { type: string }) {
  if (type === 'youtube') return <Youtube className="w-4 h-4 text-rose-400" />
  if (type === 'video')   return <Video   className="w-4 h-4 text-sky-400" />
  if (type === 'file')    return <FileText className="w-4 h-4 text-amber-400" />
  return <Link2 className="w-4 h-4 text-brand-400" />
}

export default function AssignmentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: assignment, loading } = useDocument<AssignmentDoc>('assignments', id ?? '')
  const { data: subjects } = useCollection<SubjectDoc>('subjects')
  const { data: submissions } = useCollection<SubmissionDoc>(
    'submissions',
    profile ? [where('studentId', '==', profile.uid), where('assignmentId', '==', id ?? '')] : [],
    !!(profile && id),
  )

  // Practical submission state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [noteText, setNoteText]         = useState('')
  const [uploadedFile, setUploadedFile] = useState<{ name: string; url: string; publicId: string } | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [submitting, setSubmitting]     = useState(false)
  const [submitError, setSubmitError]   = useState<string | null>(null)
  const [justSubmitted, setJustSubmitted] = useState(false)

  if (loading) return <LoadingSpinner />
  if (!assignment) return (
    <div className="text-center py-16 text-zinc-500">Assignment not found.</div>
  )

  const subject    = subjects.find(s => s.id === assignment.subjectId)
  const dueDate    = toDate(assignment.dueDate)
  const isOverdue  = dueDate ? isPast(dueDate) : false
  const isTest     = assignment.type === 'test'
  const mySubmission = submissions.find(s => s.status !== 'draft')
  const alreadySubmitted = !!mySubmission

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadProgress(0)
    setSubmitError(null)
    try {
      const result = await uploadFile(file, pct => setUploadProgress(pct))
      setUploadedFile({ name: file.name, url: result.secureUrl, publicId: result.publicId })
    } catch (err) {
      setSubmitError('File upload failed. Please try again.')
    } finally {
      setUploadProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSubmit() {
    if (!profile || !id || !assignment) return
    if (!uploadedFile && !noteText.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const resources = uploadedFile
        ? [{ type: 'file' as const, label: uploadedFile.name, url: uploadedFile.url, storagePath: null }]
        : []
      await addDoc(collection(db, 'submissions'), {
        assignmentId:     id,
        studentId:        profile.uid,
        cohortId:         profile.cohortId ?? '',
        type:             'practical',
        status:           'submitted',
        submittedAt:      serverTimestamp(),
        gradedAt:         null,
        gradedBy:         null,
        score:            null,
        maxScore:         assignment.pointsValue,
        percentageScore:  null,
        passed:           null,
        feedback:         noteText.trim() || null,
        resources,
        testAnswers:      null,
        pointsAwarded:    null,
        attemptNumber:    1,
      })
    } catch (err) {
      setSubmitError('Submission failed. Please try again.')
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    setJustSubmitted(true)
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Breadcrumb items={[
        { label: 'Home', href: '/dashboard' },
        { label: 'Assignments', href: '/assignments' },
        { label: assignment.title },
      ]} />

      <div>
        <h1 className="page-title">{assignment.title}</h1>
        {subject && (
          <p className="text-sm text-zinc-500 mt-0.5">{subject.iconEmoji} {subject.title}</p>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className={cn(
          'flex items-center gap-1.5 text-sm font-medium',
          isOverdue ? 'text-rose-600' : 'text-zinc-400',
        )}>
          <Clock className="w-4 h-4" />
          {isOverdue ? 'Overdue · ' : 'Due '}
          {dueDate ? shortDate(assignment.dueDate) : '—'}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-amber-600 font-medium">
          <Trophy className="w-4 h-4" />
          {assignment.pointsValue} points
        </div>
        {assignment.type === 'test' && (
          <span className="badge badge-indigo">Test</span>
        )}
      </div>

      {/* Description */}
      {assignment.description && (
        <div className="card">
          <h2 className="section-title mb-3">Brief</h2>
          <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{assignment.description}</p>
        </div>
      )}

      {/* Resources */}
      {assignment.resources && assignment.resources.length > 0 && (
        <div className="card">
          <h2 className="section-title mb-3">Resources</h2>
          <div className="space-y-2">
            {assignment.resources.map((r, i) => (
              <a
                key={i}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-white/8 hover:border-brand-200 hover:bg-brand-50 transition-all group"
              >
                <ResourceIcon type={r.type} />
                <span className="text-sm font-medium text-zinc-300 group-hover:text-brand-700 flex-1 truncate">
                  {r.label}
                </span>
                <Link2 className="w-3.5 h-3.5 text-zinc-300 group-hover:text-brand-400 flex-shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Test action */}
      {isTest && (
        <div className="card">
          {alreadySubmitted ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-300">Test submitted</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Score: {mySubmission.percentageScore !== null ? `${mySubmission.percentageScore}%` : 'Pending review'}
                </p>
              </div>
              <Link
                to={`/submissions/${mySubmission.id}/results`}
                className="btn-secondary py-2 px-4 text-sm"
              >
                View results
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-300">Ready to take this test?</p>
                <p className="text-xs text-zinc-400 mt-0.5">Once started, the timer begins.</p>
              </div>
              <button
                onClick={() => navigate(`/assignments/${id}/test`)}
                className="btn bg-brand-600 text-white hover:bg-brand-500 py-2 px-4 text-sm"
              >
                <PlayCircle className="w-4 h-4" /> Start Test
              </button>
            </div>
          )}
        </div>
      )}

      {/* Practical submission */}
      {!isTest && (
        <div className="space-y-4">

          {justSubmitted ? (
            <div className="text-center py-12 bg-emerald-900/20 border border-emerald-500/30 rounded-2xl">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-xl font-bold text-white mb-2">Submitted!</h2>
              <p className="text-gray-400 text-sm mb-1">Your work has been sent to your teacher.</p>
              <p className="text-gray-500 text-xs mb-6">You'll get a notification when it's been reviewed and feedback is available.</p>
              <div className="flex gap-3 justify-center">
                <a href="/assignments" className="bg-white/10 hover:bg-white/15 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors">
                  Back to assignments
                </a>
                <a href="/dashboard" className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors">
                  Go to dashboard
                </a>
              </div>
            </div>
          ) : (
          <div className="card space-y-4">
          <h2 className="section-title">Your Submission</h2>

          {alreadySubmitted ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-500">
                <CheckCircle2 className="w-5 h-5" />
                <span className="text-sm font-semibold">Submitted — awaiting review</span>
              </div>
              {mySubmission.resources.length > 0 && (
                <div className="flex items-center gap-2 p-3 bg-zinc-800 rounded-xl">
                  <Paperclip className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <a
                    href={mySubmission.resources[0].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brand-400 hover:text-brand-300 truncate"
                  >
                    {mySubmission.resources[0].label}
                  </a>
                </div>
              )}
              {mySubmission.feedback && (
                <p className="text-sm text-zinc-400 bg-zinc-800/50 rounded-xl p-3 whitespace-pre-wrap">
                  {mySubmission.feedback}
                </p>
              )}
              {mySubmission.status === 'graded' && (
                <div className="p-3 bg-amber-950/40 rounded-xl space-y-1">
                  <p className="text-xs text-zinc-400">Grade</p>
                  <p className="text-lg font-bold text-amber-500">
                    {mySubmission.percentageScore !== null ? `${mySubmission.percentageScore}%` : '—'}
                  </p>
                  {mySubmission.feedback && (
                    <p className="text-sm text-zinc-400 mt-1">{mySubmission.feedback}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* File upload */}
              <div>
                <p className="text-xs text-zinc-500 mb-2">Attach a file (optional)</p>
                {uploadedFile ? (
                  <div className="flex items-center gap-2 p-3 bg-zinc-800 rounded-xl">
                    <Paperclip className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className="text-sm text-zinc-300 flex-1 truncate">{uploadedFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setUploadedFile(null)}
                      className="p-1 text-zinc-500 hover:text-zinc-300 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : uploadProgress !== null ? (
                  <div className="p-3 bg-zinc-800 rounded-xl">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-zinc-400">Uploading…</span>
                      <span className="text-xs text-zinc-400">{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-white/10 hover:border-brand-500/50 hover:bg-brand-500/5 text-zinc-500 hover:text-zinc-300 transition-all text-sm"
                  >
                    <Upload className="w-4 h-4" />
                    Click to upload file
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

              {/* Note */}
              <div>
                <p className="text-xs text-zinc-500 mb-2">Add a note (optional)</p>
                <textarea
                  rows={4}
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  className="input resize-none"
                  placeholder="Describe your work, add links, or leave a comment for your teacher…"
                />
              </div>

              {submitError && (
                <p className="text-sm text-rose-500">{submitError}</p>
              )}

              <button
                type="button"
                disabled={submitting || (!uploadedFile && !noteText.trim()) || uploadProgress !== null}
                onClick={handleSubmit}
                className="btn-primary py-2.5 px-6 disabled:opacity-50 w-full sm:w-auto"
              >
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                  : <><CheckCircle2 className="w-4 h-4" /> Submit Assignment</>
                }
              </button>
            </div>
          )}
          </div>
          )}
        </div>
      )}
    </div>
  )
}
