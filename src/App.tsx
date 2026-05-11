import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { MicrosoftAuthProvider } from '@/contexts/MicrosoftAuthContext'
import { SchoolProvider } from '@/contexts/SchoolContext'
import RoleRoute     from '@/components/layout/RoleRoute'
import RoleRedirect  from '@/components/layout/RoleRedirect'
import StudentLayout from '@/components/layout/StudentLayout'
import TeacherLayout from '@/components/layout/TeacherLayout'
import AdminLayout   from '@/components/layout/AdminLayout'

// Auth
import Login         from '@/pages/auth/Login'
import AcceptInvite  from '@/pages/auth/AcceptInvite'

// Student
import RoomBooking        from '@/pages/student/RoomBooking'
import Booking            from '@/pages/student/Booking'
import StudentDashboard    from '@/pages/student/Dashboard'
import StudentCalendar     from '@/pages/student/Calendar'
import SubjectList         from '@/pages/student/SubjectList'
import StudentSubjectDetail from '@/pages/student/SubjectDetail'
import Prizes              from '@/pages/student/Prizes'
import CheckIn              from '@/pages/student/CheckIn'
import StudentAssignments  from '@/pages/student/Assignments'
import Profile            from '@/pages/shared/Profile'
import AssignmentDetail    from '@/pages/student/AssignmentDetail'
import TestTake           from '@/pages/student/TestTake'
import TestResults        from '@/pages/student/TestResults'
import StudentResources   from '@/pages/student/Resources'
import MyPlan             from '@/pages/student/MyPlan'

// Teacher
import TeacherDashboard from '@/pages/teacher/Dashboard'
import Students         from '@/pages/teacher/Students'
import Lessons          from '@/pages/teacher/Lessons'
import LessonBuilder    from '@/pages/teacher/LessonBuilder'
import TestList          from '@/pages/teacher/TestList'
import TestBuilder       from '@/pages/teacher/TestBuilder'
import TestGrader        from '@/pages/teacher/TestGrader'
import Assignments       from '@/pages/teacher/Assignments'
import AssignmentBuilder from '@/pages/teacher/AssignmentBuilder'
import GradeBook        from '@/pages/teacher/GradeBook'
import PrizeManager     from '@/pages/teacher/PrizeManager'
import SubjectManager   from '@/pages/teacher/SubjectManager'
import SubjectDetail    from '@/pages/teacher/SubjectDetail'
import TeacherProduction from '@/pages/teacher/Production'
import StudentProduction from '@/pages/student/Production'
import VideoPlayer        from '@/pages/shared/VideoPlayer'
import StudentVideoLibrary from '@/pages/student/VideoLibrary'
import TeacherVideoLibrary from '@/pages/teacher/VideoLibrary'
import TeacherResources    from '@/pages/teacher/Resources'
import StudentDetail       from '@/pages/teacher/StudentDetail'
import StudentPlan        from '@/pages/teacher/StudentPlan'
import SemesterWheel      from '@/pages/teacher/SemesterWheel'

// Admin
import UserManager      from '@/pages/admin/UserManager'
import CohortManager    from '@/pages/admin/CohortManager'
import CohortDetail     from '@/pages/admin/CohortDetail'
import SchoolInfo          from '@/pages/admin/SchoolInfo'
import StudentPreview      from '@/pages/admin/StudentPreview'
import BookingHub          from '@/pages/admin/BookingHub'
import FoodBoxOrders       from '@/pages/admin/FoodBoxOrders'
import MinivanBookings     from '@/pages/admin/MinivanBookings'
import EmailConfig         from '@/pages/admin/EmailConfig'
import LessonCategories    from '@/pages/admin/LessonCategories'
import SharePointSettings  from '@/pages/admin/SharePointSettings'
import GuideEditor          from '@/pages/admin/GuideEditor'
import NavSettings         from '@/pages/admin/NavSettings'
import SemesterEvents      from '@/pages/admin/SemesterEvents'
import QrDevices           from '@/pages/admin/QrDevices'
import StudentGuide         from '@/pages/student/Guide'
import BookingOverview  from '@/pages/teacher/BookingOverview'
import VideoLab           from '@/pages/student/VideoLab'
import VideoLabPlayer     from '@/pages/student/VideoLabPlayer'
import TeacherVideoLab    from '@/pages/teacher/VideoLab'
import AdminVideoLab      from '@/pages/admin/VideoLab'

// Chat
import ChatPage from '@/pages/chat/ChatPage'
import NotificationInit from '@/components/NotificationInit'

// Super admin
import SuperAdmin from '@/pages/SuperAdmin'

// Public
import RoomDisplay  from '@/pages/RoomDisplay'
import QrDisplay    from '@/pages/QrDisplay'
import PrivacyPolicy from '@/pages/PrivacyPolicy'

// Admin GDPR
import GdprDashboard from '@/pages/admin/Gdpr'

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
          <Route path="/accept-invite" element={<AcceptInvite />} />

          {/* ── Post-login landing: waits for auth to settle, then redirects */}
          <Route path="/" element={<RoleRedirect />} />

          {/* ── Student ─────────────────────────────────────────────────── */}
          <Route element={<RoleRoute role={['student', 'admin']}><StudentLayout /></RoleRoute>}>
            <Route path="/dashboard" element={<StudentDashboard />} />
            <Route path="/calendar"  element={<StudentCalendar />} />
            <Route path="/subjects"     element={<SubjectList />} />
            <Route path="/subjects/:id" element={<StudentSubjectDetail />} />
            <Route path="/prizes"    element={<Prizes />} />
            <Route path="/checkin"              element={<CheckIn />} />
            <Route path="/assignments"           element={<StudentAssignments />} />
            <Route path="/profile"               element={<Profile />} />
            <Route path="/assignments/:id"       element={<AssignmentDetail />} />
            <Route path="/assignments/:id/test"  element={<TestTake />} />
            <Route path="/submissions/:id/results" element={<TestResults />} />
            <Route path="/room-booking" element={<RoomBooking standalone />} />
            <Route path="/booking"      element={<Booking />} />
            <Route path="/resources"    element={<StudentResources />} />
            <Route path="/chat"         element={<ChatPage />} />
            <Route path="/production"   element={<StudentProduction />} />
            <Route path="/guide"        element={<StudentGuide />} />
            <Route path="/videos"           element={<StudentVideoLibrary />} />
            <Route path="/videos/:id"       element={<VideoPlayer />} />
            <Route path="/video-lab"        element={<VideoLab />} />
            <Route path="/video-lab/:id"    element={<VideoLabPlayer />} />
            <Route path="/my-plan"          element={<MyPlan />} />
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
            <Route path="/teacher/prizes"            element={<PrizeManager />} />
            <Route path="/teacher/room-bookings"     element={<BookingOverview />} />
            <Route path="/teacher/resources"         element={<TeacherResources />} />
            <Route path="/teacher/chat"              element={<ChatPage />} />
            <Route path="/teacher/production"          element={<TeacherProduction />} />
            <Route path="/teacher/videos"             element={<TeacherVideoLibrary />} />
            <Route path="/teacher/videos/:id"         element={<VideoPlayer />} />
            <Route path="/teacher/video-lab"          element={<VideoLab />} />
            <Route path="/teacher/video-lab/:id"      element={<VideoLabPlayer />} />
            <Route path="/teacher/guide"                      element={<StudentGuide />} />
            <Route path="/teacher/students/:uid/plan"         element={<StudentPlan />} />
            <Route path="/teacher/semester-wheel"             element={<SemesterWheel />} />
          </Route>

          {/* ── Admin ───────────────────────────────────────────────────── */}
          <Route element={<RoleRoute role="admin"><AdminLayout /></RoleRoute>}>
            <Route path="/admin"           element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/users"         element={<UserManager />} />
            <Route path="/admin/cohorts"       element={<CohortManager />} />
            <Route path="/admin/cohorts/:id"   element={<CohortDetail />} />
            <Route path="/admin/school-info"   element={<SchoolInfo />} />
            <Route path="/admin/bookings"      element={<BookingHub />} />
            <Route path="/admin/food-orders"   element={<FoodBoxOrders />} />
            <Route path="/admin/minivan"       element={<MinivanBookings />} />
            <Route path="/admin/email-config"  element={<EmailConfig />} />
            <Route path="/admin/preview"       element={<StudentPreview />} />
            <Route path="/admin/lessons"        element={<LessonCategories />} />
            <Route path="/admin/chat"          element={<ChatPage />} />
            <Route path="/admin/sharepoint"    element={<SharePointSettings />} />
            <Route path="/admin/guide"         element={<GuideEditor />} />
            <Route path="/admin/video-lab"     element={<AdminVideoLab />} />
            <Route path="/admin/video-lab/:id" element={<VideoLabPlayer />} />
            <Route path="/admin/nav-settings"       element={<NavSettings />} />
            <Route path="/admin/semester-events"    element={<SemesterEvents />} />
            <Route path="/admin/qr-devices"         element={<QrDevices />} />
            <Route path="/admin/gdpr"               element={<GdprDashboard />} />
          </Route>

          {/* ── Public display (no auth) ────────────────────────────────── */}
          <Route path="/room-display" element={<RoomDisplay />} />
          <Route path="/qr-display"   element={<QrDisplay />} />
          <Route path="/privacy"      element={<PrivacyPolicy />} />
          <Route path="/superadmin"   element={<SuperAdmin />} />

          {/* ── Fallback ────────────────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </MicrosoftAuthProvider>
    </AuthProvider>
    </SchoolProvider>
  )
}
