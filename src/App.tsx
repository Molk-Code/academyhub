import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { MicrosoftAuthProvider } from '@/contexts/MicrosoftAuthContext'
import { SchoolProvider } from '@/contexts/SchoolContext'
import RoleRoute     from '@/components/layout/RoleRoute'
import RoleRedirect  from '@/components/layout/RoleRedirect'
import StudentLayout, { StudentLayoutSkeleton } from '@/components/layout/StudentLayout'
import TeacherLayout from '@/components/layout/TeacherLayout'
import AdminLayout, { AdminLayoutSkeleton } from '@/components/layout/AdminLayout'

// Auth — kept static (critical path, tiny)
import Login         from '@/pages/auth/Login'
import AcceptInvite  from '@/pages/auth/AcceptInvite'

// Public — kept static (no auth loading, tiny)
import RoomDisplay  from '@/pages/RoomDisplay'
import QrDisplay    from '@/pages/QrDisplay'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import SuperAdmin from '@/pages/SuperAdmin'
import SchoolSignup from '@/pages/SchoolSignup'

import NotificationInit from '@/components/NotificationInit'
import FeatureGate from '@/components/FeatureGate'
import UpgradePage from '@/pages/UpgradePage'

// ── Shared lazy ─────────────────────────────────────────────────────────────
const Profile       = lazy(() => import('@/pages/shared/Profile'))
const VideoPlayer   = lazy(() => import('@/pages/shared/VideoPlayer'))
const ChatPage      = lazy(() => import('@/pages/chat/ChatPage'))

// ── Student lazy ─────────────────────────────────────────────────────────────
const StudentDashboard      = lazy(() => import('@/pages/student/Dashboard'))
const StudentCalendar       = lazy(() => import('@/pages/student/Calendar'))
const SubjectList           = lazy(() => import('@/pages/student/SubjectList'))
const StudentSubjectDetail  = lazy(() => import('@/pages/student/SubjectDetail'))
const Prizes                = lazy(() => import('@/pages/student/Prizes'))
const CheckIn               = lazy(() => import('@/pages/student/CheckIn'))
const StudentAssignments    = lazy(() => import('@/pages/student/Assignments'))
const AssignmentDetail      = lazy(() => import('@/pages/student/AssignmentDetail'))
const TestTake              = lazy(() => import('@/pages/student/TestTake'))
const TestResults           = lazy(() => import('@/pages/student/TestResults'))
const StudentResources      = lazy(() => import('@/pages/student/Resources'))
const MyPlan                = lazy(() => import('@/pages/student/MyPlan'))
const ProductionEditor      = lazy(() => import('@/pages/student/ProductionEditor'))
const StudentProduction     = lazy(() => import('@/pages/student/Production'))
const StudentProductionPeriod = lazy(() => import('@/pages/student/ProductionPeriod'))
const StudentGuide          = lazy(() => import('@/pages/student/Guide'))
const StudentVideoLibrary   = lazy(() => import('@/pages/student/VideoLibrary'))
const VideoLab              = lazy(() => import('@/pages/student/VideoLab'))
const VideoLabPlayer        = lazy(() => import('@/pages/student/VideoLabPlayer'))
const RoomBooking           = lazy(() => import('@/pages/student/RoomBooking'))
const Booking               = lazy(() => import('@/pages/student/Booking'))
const SemesterOverview      = lazy(() => import('@/pages/student/SemesterOverview'))
const FoodBoxOrder          = lazy(() => import('@/pages/student/FoodBoxOrder'))
const VehicleBooking        = lazy(() => import('@/pages/student/VehicleBooking'))

// ── Teacher lazy ─────────────────────────────────────────────────────────────
const TeacherDashboard           = lazy(() => import('@/pages/teacher/Dashboard'))
const Students                   = lazy(() => import('@/pages/teacher/Students'))
const StudentDetail              = lazy(() => import('@/pages/teacher/StudentDetail'))
const StudentPlan                = lazy(() => import('@/pages/teacher/StudentPlan'))
const Lessons                    = lazy(() => import('@/pages/teacher/Lessons'))
const LessonBuilder              = lazy(() => import('@/pages/teacher/LessonBuilder'))
const TestList                   = lazy(() => import('@/pages/teacher/TestList'))
const TestBuilder                = lazy(() => import('@/pages/teacher/TestBuilder'))
const TestGrader                 = lazy(() => import('@/pages/teacher/TestGrader'))
const Assignments                = lazy(() => import('@/pages/teacher/Assignments'))
const AssignmentBuilder          = lazy(() => import('@/pages/teacher/AssignmentBuilder'))
const GradeBook                  = lazy(() => import('@/pages/teacher/GradeBook'))
const PrizeManager               = lazy(() => import('@/pages/teacher/PrizeManager'))
const SubjectManager             = lazy(() => import('@/pages/teacher/SubjectManager'))
const SubjectDetail              = lazy(() => import('@/pages/teacher/SubjectDetail'))
const TeacherProduction          = lazy(() => import('@/pages/teacher/Production'))
const TeacherProductionPlanning  = lazy(() => import('@/pages/teacher/ProductionPlanning'))
const TeacherProductionPeriod    = lazy(() => import('@/pages/teacher/ProductionPeriod'))
const TeacherVideoLibrary        = lazy(() => import('@/pages/teacher/VideoLibrary'))
const TeacherResources           = lazy(() => import('@/pages/teacher/Resources'))
const BookingOverview            = lazy(() => import('@/pages/teacher/BookingOverview'))
const EquipmentRequests          = lazy(() => import('@/pages/teacher/EquipmentRequests'))
const SemesterWheel              = lazy(() => import('@/pages/teacher/SemesterWheel'))
const Notebook                   = lazy(() => import('@/pages/teacher/Notebook'))
const TeacherVideoLab            = lazy(() => import('@/pages/teacher/VideoLab'))
const GuestTeacherBank           = lazy(() => import('@/pages/teacher/GuestTeacherBank'))

// ── Admin lazy ──────────────────────────────────────────────────────────────
const UserManager       = lazy(() => import('@/pages/admin/UserManager'))
const CohortManager     = lazy(() => import('@/pages/admin/CohortManager'))
const CohortDetail      = lazy(() => import('@/pages/admin/CohortDetail'))
const SchoolInfo        = lazy(() => import('@/pages/admin/SchoolInfo'))
const StudentPreview    = lazy(() => import('@/pages/admin/StudentPreview'))
const BookingHub        = lazy(() => import('@/pages/admin/BookingHub'))
const FoodBoxOrders     = lazy(() => import('@/pages/admin/FoodBoxOrders'))
const MinivanBookings   = lazy(() => import('@/pages/admin/MinivanBookings'))
const EmailConfig       = lazy(() => import('@/pages/admin/EmailConfig'))
const LessonCategories  = lazy(() => import('@/pages/admin/LessonCategories'))
const SharePointSettings = lazy(() => import('@/pages/admin/SharePointSettings'))
const OfficeCalendarSync = lazy(() => import('@/pages/admin/OfficeCalendarSync'))
const GuideEditor       = lazy(() => import('@/pages/admin/GuideEditor'))
const NavSettings       = lazy(() => import('@/pages/admin/NavSettings'))
const ProductionRoles   = lazy(() => import('@/pages/admin/ProductionRoles'))
const SemesterEvents    = lazy(() => import('@/pages/admin/SemesterEvents'))
const QrDevices         = lazy(() => import('@/pages/admin/QrDevices'))
const GdprDashboard     = lazy(() => import('@/pages/admin/Gdpr'))
const BugReportsPage    = lazy(() => import('@/pages/admin/BugReports'))
const AdminVideoLab     = lazy(() => import('@/pages/admin/VideoLab'))
const ExperienceLevels  = lazy(() => import('@/pages/admin/ExperienceLevels'))

// ── Equipment lazy ──────────────────────────────────────────────────────────
const EquipmentBookingPage = lazy(() => import('@/pages/equipment/EquipmentBookingPage'))
const AdminEquipmentPage   = lazy(() => import('@/pages/equipment/AdminEquipmentPage'))
const InventoryPage        = lazy(() => import('@/pages/equipment/InventoryPage'))
const ScanPage             = lazy(() => import('@/pages/equipment/ScanPage'))
const PublicShopPage       = lazy(() => import('@/pages/equipment/PublicShopPage'))

export default function App() {
  return (
    <SchoolProvider>
    <AuthProvider>
    <MicrosoftAuthProvider>
      <BrowserRouter>
        <NotificationInit />
        <Routes>
          {/* ── Public ──────────────────────────────────────────────────── */}
          <Route path="/login"         element={<Login />} />
          <Route path="/signup"        element={<SchoolSignup />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />

          {/* ── Post-login landing: waits for auth to settle, then redirects */}
          <Route path="/" element={<RoleRedirect />} />

          {/* ── Student ─────────────────────────────────────────────────── */}
          <Route element={<RoleRoute role={['student', 'admin']} skeleton={<StudentLayoutSkeleton />}><StudentLayout /></RoleRoute>}>
            <Route path="/dashboard" element={<StudentDashboard />} />
            <Route path="/calendar"  element={<StudentCalendar />} />
            <Route path="/subjects"     element={<SubjectList />} />
            <Route path="/subjects/:id" element={<StudentSubjectDetail />} />
            <Route path="/prizes"    element={<FeatureGate feature="prizes"><Prizes /></FeatureGate>} />
            <Route path="/checkin"              element={<CheckIn />} />
            <Route path="/assignments"           element={<StudentAssignments />} />
            <Route path="/profile"               element={<Profile />} />
            <Route path="/assignments/:id"       element={<AssignmentDetail />} />
            <Route path="/assignments/:id/test"  element={<TestTake />} />
            <Route path="/submissions/:id/results" element={<TestResults />} />
            <Route path="/room-booking" element={<RoomBooking standalone />} />
            <Route path="/booking"           element={<FeatureGate feature="booking"><Booking /></FeatureGate>} />
            <Route path="/booking/equipment" element={<FeatureGate feature="equipment"><EquipmentBookingPage /></FeatureGate>} />
            <Route path="/resources"    element={<FeatureGate feature="resources"><StudentResources /></FeatureGate>} />
            <Route path="/chat"         element={<ChatPage />} />
            <Route path="/production"            element={<FeatureGate feature="production"><StudentProduction /></FeatureGate>} />
            <Route path="/production/planning"     element={<Navigate to="/production" replace />} />
            <Route path="/production/planning/:id" element={<FeatureGate feature="production"><ProductionEditor /></FeatureGate>} />
            <Route path="/guide"        element={<StudentGuide />} />
            <Route path="/videos"           element={<StudentVideoLibrary />} />
            <Route path="/videos/:id"       element={<VideoPlayer />} />
            <Route path="/video-lab"        element={<FeatureGate feature="video_lab"><VideoLab /></FeatureGate>} />
            <Route path="/video-lab/:id"    element={<FeatureGate feature="video_lab"><VideoLabPlayer /></FeatureGate>} />
            <Route path="/my-plan"          element={<MyPlan />} />
            <Route path="/production-period" element={<StudentProductionPeriod />} />
            <Route path="/semester"          element={<Navigate to="/dashboard" replace />} />
            <Route path="/food-boxes"        element={<FeatureGate feature="food_box"><FoodBoxOrder standalone /></FeatureGate>} />
            <Route path="/vehicles"          element={<FeatureGate feature="vehicles"><VehicleBooking /></FeatureGate>} />
          </Route>

          {/* ── Teacher ─────────────────────────────────────────────────── */}
          <Route element={<RoleRoute role={['teacher', 'admin']}><TeacherLayout /></RoleRoute>}>
            <Route path="/teacher"                   element={<TeacherDashboard />} />
            <Route path="/teacher/students"          element={<Students />} />
            <Route path="/teacher/students/:uid"     element={<StudentDetail />} />
            <Route path="/teacher/lessons"           element={<Lessons />} />
            <Route path="/teacher/lessons/new"       element={<LessonBuilder />} />
            <Route path="/teacher/subjects"          element={<SubjectManager />} />
            <Route path="/teacher/subjects/:id"      element={<SubjectDetail />} />
            <Route path="/teacher/lessons/:id/edit"  element={<LessonBuilder />} />
            <Route path="/teacher/tests"                       element={<TestList />} />
            <Route path="/teacher/tests/new"                   element={<TestBuilder />} />
            <Route path="/teacher/tests/:id/edit"              element={<TestBuilder />} />
            <Route path="/teacher/tests/:testId/submissions"   element={<TestGrader />} />
            <Route path="/teacher/assignments"             element={<Assignments />} />
            <Route path="/teacher/assignments/new"        element={<AssignmentBuilder />} />
            <Route path="/teacher/assignments/:id/edit"   element={<AssignmentBuilder />} />
            <Route path="/teacher/profile"            element={<Profile />} />
            <Route path="/teacher/gradebook"         element={<GradeBook />} />
            <Route path="/teacher/prizes"            element={<FeatureGate feature="prizes" redirectTo="/teacher"><PrizeManager /></FeatureGate>} />
            <Route path="/teacher/room-bookings"     element={<FeatureGate feature="booking" redirectTo="/teacher"><BookingOverview /></FeatureGate>} />
            <Route path="/teacher/resources"         element={<FeatureGate feature="resources" redirectTo="/teacher"><TeacherResources /></FeatureGate>} />
            <Route path="/teacher/chat"              element={<ChatPage />} />
            <Route path="/teacher/production"                   element={<FeatureGate feature="production" redirectTo="/teacher"><TeacherProduction /></FeatureGate>} />
            <Route path="/teacher/production/planning"         element={<Navigate to="/teacher/production" replace />} />
            <Route path="/teacher/production/planning/:id"     element={<FeatureGate feature="production" redirectTo="/teacher"><ProductionEditor /></FeatureGate>} />
            <Route path="/teacher/videos"             element={<FeatureGate feature="video_lab" redirectTo="/teacher"><TeacherVideoLibrary /></FeatureGate>} />
            <Route path="/teacher/videos/:id"         element={<FeatureGate feature="video_lab" redirectTo="/teacher"><VideoPlayer /></FeatureGate>} />
            <Route path="/teacher/video-lab"          element={<FeatureGate feature="video_lab" redirectTo="/teacher"><TeacherVideoLab /></FeatureGate>} />
            <Route path="/teacher/video-lab/:id"      element={<FeatureGate feature="video_lab" redirectTo="/teacher"><VideoLabPlayer /></FeatureGate>} />
            <Route path="/teacher/guide"                      element={<StudentGuide />} />
            <Route path="/teacher/students/:uid/plan"         element={<StudentPlan />} />
            <Route path="/teacher/semester-wheel"             element={<FeatureGate feature="semester" redirectTo="/teacher"><SemesterWheel /></FeatureGate>} />
            <Route path="/teacher/production-period"          element={<TeacherProductionPeriod />} />
            <Route path="/teacher/inventory"                  element={<FeatureGate feature="inventory" redirectTo="/teacher"><InventoryPage /></FeatureGate>} />
            <Route path="/teacher/equipment-requests"         element={<FeatureGate feature="equipment" redirectTo="/teacher"><EquipmentRequests /></FeatureGate>} />
            <Route path="/teacher/notebook"                   element={<Notebook />} />
            <Route path="/teacher/guest-teachers"            element={<GuestTeacherBank />} />
          </Route>

          {/* ── Admin ───────────────────────────────────────────────────── */}
          <Route element={<RoleRoute role="admin" skeleton={<AdminLayoutSkeleton />}><AdminLayout /></RoleRoute>}>
            <Route path="/admin"           element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/users"         element={<UserManager />} />
            <Route path="/admin/cohorts"       element={<CohortManager />} />
            <Route path="/admin/cohorts/:id"   element={<CohortDetail />} />
            <Route path="/admin/school-info"   element={<SchoolInfo />} />
            <Route path="/admin/bookings"      element={<BookingHub />} />
            <Route path="/admin/food-box-orders" element={<FoodBoxOrders />} />
            <Route path="/admin/food-orders"    element={<Navigate to="/admin/food-box-orders" replace />} />
            <Route path="/admin/minivan"       element={<MinivanBookings />} />
            <Route path="/admin/email-config"  element={<EmailConfig />} />
            <Route path="/admin/preview"       element={<StudentPreview />} />
            <Route path="/admin/lessons"        element={<LessonCategories />} />
            <Route path="/admin/chat"          element={<ChatPage />} />
            <Route path="/admin/sharepoint"    element={<SharePointSettings />} />
            <Route path="/admin/calendar-sync" element={<OfficeCalendarSync />} />
            <Route path="/admin/guide"         element={<GuideEditor />} />
            <Route path="/admin/video-lab"     element={<AdminVideoLab />} />
            <Route path="/admin/video-lab/:id" element={<VideoLabPlayer />} />
            <Route path="/admin/nav-settings"       element={<NavSettings />} />
            <Route path="/admin/production-roles"   element={<ProductionRoles />} />
            <Route path="/admin/semester-events"    element={<SemesterEvents />} />
            <Route path="/admin/qr-devices"         element={<FeatureGate feature="checkin_devices" redirectTo="/admin/users"><QrDevices /></FeatureGate>} />
            <Route path="/admin/gdpr"               element={<GdprDashboard />} />
            <Route path="/admin/bug-reports"        element={<BugReportsPage />} />
            <Route path="/admin/experience-levels" element={<ExperienceLevels />} />
            <Route path="/admin/equipment"           element={<FeatureGate feature="equipment" redirectTo="/admin/users"><AdminEquipmentPage /></FeatureGate>} />
            <Route path="/admin/inventory"           element={<FeatureGate feature="inventory" redirectTo="/admin/users"><InventoryPage /></FeatureGate>} />
          </Route>

          {/* ── Equipment scanner (auth required, no layout) ─────────────── */}
          <Route path="/scan/:sessionId" element={<ScanPage />} />

          {/* ── Public display (no auth) ────────────────────────────────── */}
          <Route path="/room-display" element={<RoomDisplay />} />
          <Route path="/qr-display"   element={<QrDisplay />} />
          <Route path="/privacy"      element={<PrivacyPolicy />} />
          <Route path="/superadmin"   element={<SuperAdmin />} />
          <Route path="/upgrade"      element={<UpgradePage />} />
          <Route path="/shop"         element={<PublicShopPage />} />

          {/* ── Fallback ────────────────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </MicrosoftAuthProvider>
    </AuthProvider>
    </SchoolProvider>
  )
}
