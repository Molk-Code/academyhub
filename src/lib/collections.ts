import { SCHOOL_ID } from './school'

// During beta: returns 'lessons', 'users', etc. (flat — no change to existing queries)
// For multi-tenant: change to return 'schools/molkom/lessons' etc.
export const col = {
  users:               'users',
  lessons:             'lessons',
  cohorts:             'cohorts',
  subjects:            'subjects',
  assignments:         'assignments',
  submissions:         'submissions',
  tests:               'tests',
  attendance:          (lessonId: string) => `lessons/${lessonId}/attendance`,
  attendanceSessions:  'attendance_sessions',
  chatChannels:        'chat_channels',
  roomBookings:        'room_bookings',
  rooms:               'rooms',
  pointsLog:           'points_log',
  todos:               'todos',
  notifications:       'notifications',
  guideArticles:       'guide_articles',
  guideSections:       'guide_sections',
  semesterEvents:      'semester_events',
  qrDisplayDevices:    'qr_display_devices',
  settings:            'settings',
  schools:             'schools',
  // schoolId for reference
  schoolId:            SCHOOL_ID,
} as const
