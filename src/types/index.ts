import type { Timestamp } from 'firebase/firestore'

// ─────────────────────────────────────────────────────────────────────────────
// Enums / union types
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = 'student' | 'teacher' | 'admin'

export type SubmissionStatus = 'draft' | 'submitted' | 'graded'

export type AssignmentType = 'practical' | 'test'

export type QuestionType = 'multiple_choice' | 'multiple_select' | 'true_false' | 'short_answer' | 'ordering' | 'rating'

export type PointsReason = 'test_pass' | 'assignment_graded' | 'redemption' | 'bonus' | 'attendance' | 'absence_penalty'

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
  options: string[]            // for MC / MS / TF / ordering items
  correctAnswer: string        // for MC, TF, SA: index string or text
  correctAnswers?: string[]    // for multiple_select: array of index strings
  correctOrder?: string[]      // for ordering: correct sequence of option indices as strings
  ratingScale?: number         // for rating: max value (default 5)
  ratingLabels?: [string, string] // for rating: [low label, high label]
  points: number
}

export interface GradedAnswer {
  questionId: string
  answer?: string        // MC / TF / SA student answer
  answers?: string[]     // multiple_select student answers
  isCorrect: boolean | null  // null = pending (short_answer)
  pointsAwarded: number | null
}

export interface TestAnswer {
  questionId: string
  answer: string
  isCorrect: boolean | null
}

export interface TestDoc {
  id: string
  assignmentId: string
  title?: string
  subjectId?: string
  cohortId?: string
  questions: Question[]
  shuffleQuestions: boolean
  timeLimitMinutes: number | null
  maxAttempts: number
  isPublished?: boolean
  createdBy?: string
  createdAt?: import('firebase/firestore').Timestamp
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore document types
// ─────────────────────────────────────────────────────────────────────────────

export interface UserDoc {
  id:  string   // Firestore document ID (same as uid)
  uid: string
  email: string
  displayName: string
  role: UserRole
  roles: UserRole[]   // all roles this user can switch between
  avatarUrl: string | null
  cohortId: string | null
  enrolledAt: Timestamp
  totalPoints: number
  pointsRedeemed: number
  isActive: boolean
  bio?: string
  portfolioUrl?: string
  fcmTokens?: string[]
  phoneNumber?: string
  schoolEmail?: string
  calendarColor?: string
  disabled?: boolean
  hasSeenWelcome?: boolean
  notifiedLevelIds?: string[]
}

export interface CohortDoc {
  id: string
  name: string
  startDate: Timestamp
  endDate: Timestamp
  teacherIds: string[]
  studentIds: string[]
  programYear: 1 | 2
  semesterStartDate?: string      // "YYYY-MM-DD" — Semester 1 start, overrides global
  semesterEndDate?: string        // "YYYY-MM-DD" — Semester 1 end
  semesterSem2StartDate?: string  // "YYYY-MM-DD" — Semester 2 start
  semesterSem2EndDate?: string    // "YYYY-MM-DD" — Semester 2 end
  color?: string
}

export interface SubjectResource {
  id: string
  type: 'link' | 'file'
  title: string
  url: string
  storagePath: string | null
}

export interface CurriculumItem {
  id: string
  order: number
  semester: number   // 1, 2, …
  title: string      // topic / module name
  content: string    // what is covered
  method: string     // how it's delivered – free text, e.g. "Lecture + Workshop"
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
  curriculum: CurriculumItem[]
  resources: SubjectResource[]
}

export interface ClassroomDoc {
  id: string
  name: string
  notes?: string
  order: number
}

export interface LessonBlockDoc {
  id: string
  name: string           // e.g. "Block 1"
  startTime: string      // "HH:MM"
  endTime: string        // "HH:MM"
  daysOfWeek: number[]   // 0=Sun 1=Mon … 6=Sat; empty = all days
  order: number
}

export interface LessonDoc {
  id: string
  subjectId: string
  categoryId?: string     // lesson category (e.g. "Theory", "Practical")
  cohortId: string
  title: string
  iconEmoji?: string
  description: string
  teacherId: string       // legacy – kept for backward compat
  teacherIds: string[]   // multi-teacher support
  classroom: string
  startTime: Timestamp
  endTime: Timestamp
  isOnline: boolean
  resources: ResourceEmbed[]
  coveredCurriculumIds?: string[]   // curriculum item IDs covered in this lesson
  createdAt: Timestamp
  penaltiesAppliedAt?: Timestamp
}

export interface SubjectTeacherDoc {
  id: string
  userId: string | null   // linked UserDoc uid (null for guest teachers)
  name: string
  title: string           // work title e.g. "Senior Cinematographer"
  description: string
  imageUrl: string | null
  storagePath: string | null
  portfolioUrl: string | null
  isGuest: boolean
  order: number
}

export interface LessonCategoryDoc {
  id: string
  name: string
  color: string   // hex color e.g. "#f59e0b"
  order: number
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
  testAnswers: GradedAnswer[] | null
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
  id: string
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

// ── Equipment Booking System ──────────────────────────────────────────────────

export type EquipmentCategory = 'CAMERA' | 'GRIP' | 'LIGHTS' | 'SOUND' | 'LOCATION' | 'BOOKS' | 'OTHER'
export type EquipmentBookingStatus = 'pending' | 'confirmed' | 'checked-out' | 'returned' | 'cancelled'
export type InventoryProjectStatus = 'active' | 'checked-out' | 'returned' | 'archived'
export type InventoryItemStatus = 'checked-out' | 'returned' | 'damaged' | 'missing'

export interface EquipmentDoc {
  id: string
  name: string
  category: EquipmentCategory
  description: string
  notes: string
  location: string
  priceExclVat: number
  priceInclVat: number
  available: number
  totalQuantity: number
  imageUrl: string
  qrCode: string
  included: string[]
  filmYear2Only: boolean
  allowedCohortIds?: string[]   // empty / absent = available to all
  requiresProduction?: boolean  // default true; false = bookable without a production
  isActive: boolean
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export interface EquipmentBookingItem {
  equipmentId: string
  equipmentName: string
  quantity: number
}

export interface EquipmentBookingDoc {
  id: string
  studentId: string
  studentName: string
  studentEmail: string
  cohortId: string
  projectName: string
  items: EquipmentBookingItem[]
  checkoutDate: string
  returnDate: string
  status: EquipmentBookingStatus
  teacherNotes: string
  productionId?: string
  productionTitle?: string
  productionReadiness?: { score: number; hasBreakdown: boolean; hasCrew: boolean; hasCast: boolean; hasLocations: boolean; hasSchedule: boolean }
  createdAt?: Timestamp
}

export interface InventoryProjectDoc {
  id: string
  name: string
  borrowers: string[]
  borrowerIds: string[]
  equipmentManagerId: string
  equipmentManagerName: string
  cohortId: string
  checkoutDate: string
  returnDate: string
  status: InventoryProjectStatus
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export interface InventoryItemDoc {
  id: string
  equipmentId: string
  equipmentName: string
  checkoutTimestamp: string
  checkinTimestamp: string
  status: InventoryItemStatus
  damageNotes: string
  assignedTo: string
  addonSessionId?: string
  addonDate?: string
  addonCollectedBy?: string
  addonManager?: string
}

// ── Attendance ────────────────────────────────────────────────────────────────

export interface AttendanceSessionDoc {
  id: string
  lessonId: string
  token: string
  expiresAt: Timestamp
  createdBy: string
  isActive: boolean
  createdAt: Timestamp
  displayDeviceId?: string | null
}

export interface QrDisplayDeviceDoc {
  id: string
  name: string
  isActive: boolean
  createdAt: Timestamp
  // Live session state — written by AttendancePanel, read by QrDisplay
  activeToken: string | null
  tokenExpiresAt: Timestamp | null
  activeLessonId: string | null
}

export interface AttendanceRecordDoc {
  studentId: string
  displayName: string
  checkedInAt: Timestamp
  sessionId: string
}

// ── Room Booking ──────────────────────────────────────────────────────────────

export interface RoomAvailabilityWindow {
  id: string
  days: number[]      // JS weekday numbers: 0=Sun, 1=Mon … 6=Sat
  startTime: string   // "HH:MM"
  endTime: string     // "HH:MM"
  startDate: string   // "YYYY-MM-DD" — period start (inclusive)
  endDate: string     // "YYYY-MM-DD" — period end (inclusive)
}

export interface RoomDoc {
  id: string
  name: string        // e.g. "Room A"
  description: string
  isActive: boolean
  order: number
  availability: RoomAvailabilityWindow[]  // empty = always available
}

export interface TimeBlockDoc {
  id: string
  label: string       // e.g. "09:00–11:00"
  startTime: string   // "HH:MM"
  endTime: string     // "HH:MM"
  days: number[]      // JS weekday numbers: 0=Sun, 1=Mon … 6=Sat
  order: number
}

export interface RoomBookingDoc {
  id: string
  roomId: string
  blockId?: string    // optional time block reference
  startTime: string   // "HH:MM" — the window's start time
  endTime: string     // "HH:MM" — the window's end time
  date: string        // "YYYY-MM-DD"
  studentId: string
  studentName: string
  createdAt: Timestamp
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth / session types
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthClaims {
  role: UserRole
  cohortId: string | null
}

export interface BookingSettingsDoc {
  id: string
  maxBookingsPerWeek: number | null  // null = unlimited
  foodBoxLeadDays?: number           // working days in advance required for food box orders (default 5)
}

export interface VehicleDoc {
  id: string
  name: string
  isActive: boolean
  order?: number
  leadDays?: number  // working days in advance required to book (default 5)
}

export interface SemesterSettingsDoc {
  id: string
  startDate: string   // semester 1 start "YYYY-MM-DD"
  endDate: string     // semester 1 end   "YYYY-MM-DD"
  sem2Start?: string  // semester 2 start "YYYY-MM-DD"
  sem2End?: string    // semester 2 end   "YYYY-MM-DD"
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface ChatAttachment {
  url: string
  name: string
  type: string   // MIME type
  size: number   // bytes
}

export interface ChatChannelDoc {
  id: string
  name: string
  description?: string
  order: number
  createdAt: Timestamp
  createdBy: string
  isPublic: boolean
  allowedRoles: UserRole[]
  allowedCohortIds: string[]
  allowedTeamIds: string[]    // production team IDs granted access
  memberIds: string[]
  isDM?: boolean
  lastMessageAt?: Timestamp
}

export interface Commandment {
  id: string
  text: string
  order: number
}

export interface ProductionTeamDoc {
  id: string
  cohortId: string
  name: string
  color: string         // hex color e.g. "#ef4444"
  emoji: string
  memberIds: string[]
  commandments: Commandment[]
  order: number
  createdAt: Timestamp
  createdBy: string
}

export interface ChatSettingsDoc {
  retentionDays: number | null  // null = keep forever
}

// ── Video ─────────────────────────────────────────────────────────────────────

export type VideoReviewStatus = 'pending' | 'reviewed'

export interface VideoDoc {
  id: string
  sharePointItemId: string
  name: string
  uploaderId: string
  uploaderName: string
  cohortId: string
  subjectId: string
  studentId: string
  durationSeconds: number | null
  fileSizeBytes: number
  mimeType: string
  thumbnailUrl: string | null
  createdAt: Timestamp
  reviewStatus: VideoReviewStatus
  grade: number | null
  gradedBy: string | null
  gradedAt: Timestamp | null
  feedback: string | null
}

export interface VideoCommentDoc {
  id: string
  videoId: string
  userId: string
  userName: string
  userAvatarUrl: string | null
  userRole: UserRole
  timestamp: number   // seconds
  text: string
  createdAt: Timestamp
}

// ── SharePoint / Microsoft Graph ──────────────────────────────────────────────

export interface SharePointConfigDoc {
  id: string
  tenantId: string
  clientId: string
  siteUrl: string
  siteId: string
  basePath: string
}

export interface ChatMessageDoc {
  id: string
  authorId: string
  authorName: string
  authorAvatarUrl: string | null
  content: string
  attachments: ChatAttachment[]
  reactions: Record<string, string[]>  // emoji → [userId, ...]
  createdAt: Timestamp
  editedAt?: Timestamp
}

// ── Absence Reports ───────────────────────────────────────────────────────────

export interface AbsenceReportDoc {
  id: string
  studentId: string
  studentName: string
  cohortId: string
  date: string          // YYYY-MM-DD
  type: 'full_day' | 'lesson'
  lessonId?: string
  lessonTitle?: string
  lessonStartTime?: string  // HH:mm
  lessonEndTime?: string    // HH:mm
  reason: string
  reportedAt: Timestamp
  status: 'pending' | 'reviewed'
}

// ── Food Box Orders ───────────────────────────────────────────────────────────

export interface FoodBoxOrderDoc {
  id: string
  studentId: string
  studentName: string
  cohortId: string | null
  date: string             // "YYYY-MM-DD"
  pickupTime?: string      // "HH:MM" — when food is picked up
  adminPickupTime?: string  // "HH:MM" — overridden by admin
  adminDate?: string        // "YYYY-MM-DD" — date overridden by admin
  pickupTimeModified?: boolean  // any admin schedule change
  // Morning coffee
  morningStudents: string[]
  morningDiet: string
  // Lunchbox
  lunchStudents: string[]
  lunchCanHeat: boolean | null
  lunchDiet: string
  // Dinnerbox
  dinnerStudents: string[]
  dinnerCanHeat: boolean | null
  dinnerDiet: string
  // Meta
  otherNotes: string
  contactPerson: string
  phoneNumber: string
  status: 'pending' | 'confirmed' | 'cancelled'
  createdAt: Timestamp
}

// ── Vehicle Bookings ──────────────────────────────────────────────────────────

export interface MinivanBookingDoc {
  id: string
  studentId: string
  studentName: string
  cohortId: string | null
  vehicle: string          // vehicle name
  dateFrom: string         // "YYYY-MM-DD"
  timeFrom: string         // "HH:MM"
  dateTo: string           // "YYYY-MM-DD"
  timeTo: string           // "HH:MM"
  adminTimeFrom?: string   // "HH:MM" — overridden by admin
  adminTimeTo?: string     // "HH:MM" — overridden by admin
  adminDateFrom?: string   // "YYYY-MM-DD" — overridden by admin
  adminDateTo?: string     // "YYYY-MM-DD" — overridden by admin
  scheduleModified?: boolean  // any admin schedule change (date or time)
  destination: string
  purpose: string
  driverName: string
  contactPerson: string
  phoneNumber: string
  notes: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: Timestamp
}

// ── Email Config ──────────────────────────────────────────────────────────────

export interface EmailConfigDoc {
  id: string
  foodBoxEmail: string     // recipient for food box orders
  minivanEmail: string     // recipient for minivan bookings
  fromName: string
  fromEmail: string        // verified sender address in Resend
}

// ── Team Resources ────────────────────────────────────────────────────────────

export interface ResourceFolderDoc {
  id: string
  name: string
  emoji: string
  cohortId: string | null
  createdBy: string
  createdAt: Timestamp
  order: number
}

export interface TeamResourceDoc {
  id: string
  title: string
  url: string
  type: ResourceType
  storagePath: string | null
  cohortId: string | null   // null = visible to all cohorts
  teamIds: string[] | null  // null = all teams / all students; otherwise specific team IDs
  folderId: string | null
  createdBy: string
  createdAt: Timestamp
  description?: string
}

// ── Video Lab (Beta) ──────────────────────────────────────────────────────────

export interface VideoLabDoc {
  id: string
  cloudinaryPublicId: string
  title: string
  description: string
  subjectId?: string
  uploaderId: string
  uploaderName: string
  duration: number   // seconds
  tags: string[]
  createdAt: Timestamp
}

export interface VideoLabCommentDoc {
  id: string
  text: string
  timestampSeconds: number
  userId: string
  userName: string
  createdAt: Timestamp
}

// ── Production Bible / Student Guide ─────────────────────────────────────────

export interface GuideSectionDoc {
  id: string
  title: string
  icon: string   // emoji
  order: number
  isPublished: boolean
}

export interface GuideArticleDoc {
  id: string
  sectionId: string
  title: string
  content: string  // markdown
  order: number
  isPublished: boolean
  updatedAt: Timestamp
}

export interface GuideContactDoc {
  id: string
  name: string
  role: string
  phone?: string
  email?: string
  order: number
}

// ── Semester Events (Annual Wheel) ───────────────────────────────────────────

export type SemesterEventCategory = string

export interface SemesterCategoryDoc {
  id: string
  name: string
  color: string   // hex e.g. '#3b82f6'
  createdAt: Timestamp
}

export interface SemesterEventDoc {
  id: string
  title: string
  description: string
  color: string             // hex e.g. '#3b82f6'
  startDate: string         // 'MM-DD'
  endDate: string           // 'MM-DD'
  category: SemesterEventCategory
  isActive: boolean
  createdBy: string
  createdAt: Timestamp
}

// ── Individual Development Plan (NOPRA) ───────────────────────────────────────

export type NopraStepKey = 'situation' | 'goal' | 'obstacles' | 'resources' | 'action' | 'evaluation'

export interface DevelopmentPlan {
  id: string          // = studentId
  studentId: string
  cohortId: string | null
  situation: string
  goal: string
  obstacles: string
  resources: string
  action: string
  evaluation: string
  updatedAt: Timestamp
  createdAt: Timestamp
}

export interface PlanComment {
  id: string
  studentId: string
  teacherId: string
  teacherName: string
  teacherAvatarUrl: string | null
  step: NopraStepKey
  text: string
  createdAt: Timestamp
}

// ── Schools (multi-tenant registry) ──────────────────────────────────────────

export type SchoolStatus = 'active' | 'trial' | 'suspended'
export type SchoolTier   = 'studio' | 'academy' | 'campus'

export interface SchoolDoc {
  id: string              // = schoolId slug
  schoolId: string
  name: string
  status: SchoolStatus
  tier: SchoolTier
  isBeta: boolean
  onboardingDate: Timestamp
  contactEmail?: string
  // fields also used by SchoolContext (preserved)
  shortName?: string
  logoUrl?: string | null
  primaryColor?: string
  features?: Record<string, boolean>
  maxStudents?: number
  subscriptionStatus?: string
  storageQuotaGB?: number
  storageUsedBytes?: number
  roomDisplayUrl?: string
}

export interface TeacherAssessment {
  id: string              // = studentId
  studentId: string
  strengths: string
  developments: string
  updatedBy: string
  updatedByName: string
  updatedAt: Timestamp
}

// ── Personal To-Do ────────────────────────────────────────────────────────────

export type TodoCategory = 'urgent' | 'todo'

export interface TodoDoc {
  id: string
  studentId: string
  title: string
  description: string
  category: TodoCategory
  isCompleted: boolean
  completedAt: Timestamp | null
  createdAt: Timestamp
  order: number
}

export interface PersonalEventDoc {
  id: string
  userId: string
  role: 'student' | 'teacher'
  title: string
  startTime: Timestamp
  endTime: Timestamp | null
  allDay: boolean
  location?: string
  notes?: string
  inviteeIds?: string[]
  organizerName?: string
  createdAt: Timestamp
}

// ── Production Planning ───────────────────────────────────────────────────────

export interface ProductionDoc {
  id: string
  title: string
  cohortId: string
  createdBy: string
  collaborators: string[]   // can edit
  viewerIds: string[]       // view-only (populated from team shares)
  sharedTeams: { teamId: string; teamName: string }[]
  isPublic: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
  lastEditedBy?: string
  screenplayUrl?: string
  screenplayName?: string
  periodId?: string
  productionType?: 'period' | 'side'
  productionPeriodId?: string | null
  budgetLimit?: number
}

export interface ProductionLocationDoc {
  id: string
  name: string
  address: string    // street address
  zipCode?: string   // postal / zip code
  state?: string     // city / municipality / region
  notes?: string
}

export interface ProductionSceneDoc {
  id: string
  sceneNumber: number
  dayNight: 'Day' | 'Night'
  intExt: 'INT' | 'EXT'
  location: string
  locationId?: string   // reference to ProductionLocationDoc.id
  description: string
  castIds: number[]
  pages?: number        // eighths of a script page: 1=1/8, 8=1 page, 9=1 1/8, etc.
  props: string
  makeup: string
  costume: string
  notes: string
}

export interface ProductionCastDoc {
  id: string
  characterName: string
  actorName: string
  castId: number
  scenes: number[]
}

export interface ProductionShotDoc {
  id: string
  sceneId: string
  shotNumber: number
  subject: string
  size: string
  angle: string
  movement: string
  notes: string
}

export interface LocationMove {
  id: string
  afterSceneId: string  // scene doc id, or '__start__' for before first scene
  minutes: number
  note?: string
}

export interface ProductionShootingDayDoc {
  id: string
  dayNumber: number
  date: string
  workHours: string   // legacy display string e.g. "08:00–17:00"
  startTime?: string  // "HH:mm"
  endTime?: string    // "HH:mm"
  rtsTime?: string      // "HH:mm" — ready to shoot
  lunchStart?: string   // "HH:mm" — lunch break start
  lunchDuration?: number // minutes
  sceneIds: string[]
  notes: string
  locationMoves?: LocationMove[]
}

export interface CrewRoleDoc {
  id: string
  name: string
  order: number
  dayRate?: number
}

export interface ProductionCrewAssignmentDoc {
  id: string
  roleId: string
  roleName: string
  assignedUid?: string | null
  assignedName: string
}

export interface ProductionFeedbackDoc {
  id: string
  tab: string
  comment: string
  teacherId: string
  teacherName: string
  createdAt: Timestamp
}

// ── Production Period ─────────────────────────────────────────────────────────

export interface ProductionPeriodDoc {
  id: string
  title: string
  cohortId: string
  startDate: string      // yyyy-MM-dd
  endDate: string        // yyyy-MM-dd
  workingDays: string[]  // list of available shooting dates (yyyy-MM-dd)
  createdBy: string
  notes: string
  budgetPerProduction?: number
  budgetCurrency?: string
  budgetNotes?: string
}

export interface PeriodAllocationDoc {
  id: string
  productionId: string
  productionTitle: string  // denormalized
  date: string             // yyyy-MM-dd
  startTime: string        // HH:mm
  endTime: string          // HH:mm
  location: string
  crewNeeded: string[]     // user uids
  notes: string
  color: string            // hex, auto-assigned per production
}


// ── Meeting Agenda ────────────────────────────────────────────────────────────

export interface MeetingDoc {
  id: string
  title: string
  date: Timestamp
  cohortId: string
  status: 'draft' | 'published' | 'in-progress' | 'completed' | 'archived'
  createdBy: string
  collaboratorIds: string[]
  minutesNotes: string
  isRecurring: boolean
  recurringDay?: string
  recurringTime?: string
  createdAt: Timestamp
  publishedAt?: Timestamp
}

export interface MeetingItemDoc {
  id: string
  type: 'info' | 'discussion' | 'reminder' | 'decision'
  title: string
  body: string
  addedBy: string
  addedByName: string
  order: number
  isDone: boolean
  comments: Array<{ uid: string; name: string; text: string; createdAt: any }>
  decisionOutcome: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ── Notification inbox ───────────────────────────────────────────────────────

export interface NotificationDoc {
  id: string
  uid: string
  title: string
  body: string
  url?: string
  isRead: boolean
  createdAt: Timestamp
  type?: string
  levelName?: string
}

export interface ExperienceLevel {
  id: string
  name: string
  pointsRequired: number
}
