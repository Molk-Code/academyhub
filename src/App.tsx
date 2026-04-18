import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import RoleRoute from '@/components/layout/RoleRoute'
import StudentLayout from '@/components/layout/StudentLayout'
import TeacherLayout from '@/components/layout/TeacherLayout'

// Auth
import Login         from '@/pages/auth/Login'
import AcceptInvite  from '@/pages/auth/AcceptInvite'

// Student
import StudentDashboard from '@/pages/student/Dashboard'
import StudentCalendar  from '@/pages/student/Calendar'
import SubjectList      from '@/pages/student/SubjectList'
import Prizes           from '@/pages/student/Prizes'

// Teacher
import TeacherDashboard from '@/pages/teacher/Dashboard'
import Students         from '@/pages/teacher/Students'
import LessonBuilder    from '@/pages/teacher/LessonBuilder'
import TestBuilder      from '@/pages/teacher/TestBuilder'
import GradeBook        from '@/pages/teacher/GradeBook'
import PrizeManager     from '@/pages/teacher/PrizeManager'

// Admin
import UserManager   from '@/pages/admin/UserManager'
import CohortManager from '@/pages/admin/CohortManager'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ── Public ──────────────────────────────────────────────────── */}
          <Route path="/login"          element={<Login />} />
          <Route path="/accept-invite"  element={<AcceptInvite />} />

          {/* ── Student ─────────────────────────────────────────────────── */}
          <Route element={<RoleRoute role="student"><StudentLayout /></RoleRoute>}>
            <Route path="/dashboard" element={<StudentDashboard />} />
            <Route path="/calendar"  element={<StudentCalendar />} />
            <Route path="/subjects"  element={<SubjectList />} />
            <Route path="/prizes"    element={<Prizes />} />
          </Route>

          {/* ── Teacher ─────────────────────────────────────────────────── */}
          <Route element={<RoleRoute role="teacher"><TeacherLayout /></RoleRoute>}>
            <Route path="/teacher"                   element={<TeacherDashboard />} />
            <Route path="/teacher/students"          element={<Students />} />
            <Route path="/teacher/lessons/new"       element={<LessonBuilder />} />
            <Route path="/teacher/lessons/:id/edit"  element={<LessonBuilder />} />
            <Route path="/teacher/tests/new"         element={<TestBuilder />} />
            <Route path="/teacher/gradebook"         element={<GradeBook />} />
            <Route path="/teacher/prizes"            element={<PrizeManager />} />
          </Route>

          {/* ── Admin (dark teacher layout re-used) ─────────────────────── */}
          <Route element={<RoleRoute role="admin"><TeacherLayout /></RoleRoute>}>
            <Route path="/admin"          element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/users"    element={<UserManager />} />
            <Route path="/admin/cohorts"  element={<CohortManager />} />
          </Route>

          {/* ── Default redirect ────────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
