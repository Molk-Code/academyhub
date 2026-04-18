import type { Timestamp } from 'firebase/firestore'

// ─────────────────────────────────────────────────────────────────────────────
// Enums / union types
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = 'student' | 'teacher' | 'admin'

export type SubmissionStatus = 'draft' | 'submitted' | 'graded'

export type AssignmentType = 'practical' | 'test'

export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer'

export type PointsReason = 'test_pass' | 'assignment_graded' | 'redemption' | 'bonus'

export type ClaimStatus = 'pending' | 'fulfilled' | 'rejected'

export type EquipmentCondition = 'excellent' | 'good' | 'fair' | 'maintenance'

export type BookingStatus = 'requested' | 'approved' | 'rejected' | 'returned'

export type ResourceType = 'file' | 'video' | 'link' | 'youtube'

// ─────────────────────────────────────────────────────────────────────────────
// Embedded types
// ─────────────────────────────────────────────────────────────────────────────

export interface ResourceEmbed {
  type: ResourceType
  label: string
  url: string
  storagePath: string | null
}

export interface Question {
  id: string
  text: string
  type: QuestionType
  options: string[]           // for MC / true_false
  correctAnswer: string       // option text or index string
  points: number
}

export interface TestAnswer {
  questionId: string
  answer: string
  isCorrect: boolean | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore document types
// ─────────────────────────────────────────────────────────────────────────────

export interface UserDoc {
  uid: string
  email: string
  displayName: string
  role: UserRole
  avatarUrl: string | null
  cohortId: string | null
  enrolledAt: Timestamp
  totalPoints: number
  pointsRedeemed: number
  isActive: boolean
}

export interface CohortDoc {
  id: string
  name: string
  startDate: Timestamp
  endDate: Timestamp
  teacherIds: string[]
  studentIds: string[]
  programYear: 1 | 2
}

export interface SubjectDoc {
  id: string
  title: string
  description: string
  color: string        // Tailwind bg class, e.g. 'bg-indigo-500'
  iconEmoji: string
  programYear: 1 | 2
  order: number
  createdBy: string
}

export interface LessonDoc {
  id: string
  subjectId: string
  cohortId: string
  title: string
  description: string
  teacherId: string
  classroom: string
  startTime: Timestamp
  endTime: Timestamp
  isOnline: boolean
  resources: ResourceEmbed[]
  createdAt: Timestamp
}

export interface AssignmentDoc {
  id: string
  subjectId: string
  cohortId: string
  createdBy: string
  title: string
  description: string
  type: AssignmentType
  dueDate: Timestamp
  pointsValue: number
  passingScore: number | null   // null for practical
  resources: ResourceEmbed[]
  isPublished: boolean
  createdAt: Timestamp
}

export interface TestDoc {
  id: string
  assignmentId: string
  questions: Question[]
  shuffleQuestions: boolean
  timeLimitMinutes: number | null
  maxAttempts: number
}

export interface SubmissionDoc {
  id: string
  assignmentId: string
  studentId: string
  cohortId: string
  type: AssignmentType
  status: SubmissionStatus
  submittedAt: Timestamp | null
  gradedAt: Timestamp | null
  gradedBy: string | null
  score: number | null
  maxScore: number
  percentageScore: number | null
  passed: boolean | null
  feedback: string | null
  resources: ResourceEmbed[]     // student uploads
  testAnswers: TestAnswer[] | null
  pointsAwarded: number | null
  attemptNumber: number
}

export interface PointsLogDoc {
  id: string
  studentId: string
  points: number
  reason: PointsReason
  referenceId: string
  awardedBy: string | null
  createdAt: Timestamp
}

export interface PrizeDoc {
  id: string
  title: string
  description: string
  imageUrl: string | null
  pointsCost: number
  quantity: number | null
  quantityClaimed: number
  isActive: boolean
  createdBy: string
  cohortIds: string[] | null
}

export interface PrizeClaimDoc {
  id: string
  prizeId: string
  studentId: string
  pointsSpent: number
  status: ClaimStatus
  claimedAt: Timestamp
  fulfilledAt: Timestamp | null
  fulfilledBy: string | null
  notes: string | null
}

export interface SubjectProgress {
  completed: number
  total: number
  percentage: number
}

export interface ProgressDoc {
  studentId: string
  cohortId: string
  totalAssignments: number
  completedAssignments: number
  passedTests: number
  totalTests: number
  overallPercentage: number
  subjectProgress: Record<string, SubjectProgress>
  streakDays: number
  lastActivityAt: Timestamp
  updatedAt: Timestamp
}

// ── Phase 5: Equipment ────────────────────────────────────────────────────────

export interface EquipmentDoc {
  id: string
  name: string
  category: string
  serialNumber: string
  isAvailable: boolean
  condition: EquipmentCondition
  imageUrl: string | null
  notes: string
}

export interface EquipmentBookingDoc {
  id: string
  itemId: string
  studentId: string
  approvedBy: string | null
  startTime: Timestamp
  endTime: Timestamp
  status: BookingStatus
  notes: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth / session types
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthClaims {
  role: UserRole
  cohortId: string | null
}
