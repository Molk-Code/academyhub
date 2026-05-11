import { createContext, useContext, useState } from 'react'

interface AttendanceContextValue {
  startAttendance: (lessonId: string, lessonTitle: string) => void
  stopAttendance: () => void
  openPanel: () => void
  dismissPanel: () => void
  lessonId: string | null
  lessonTitle: string
  visible: boolean
  externalDeviceName: string
  setExternalDeviceName: (name: string) => void
}

const AttendanceContext = createContext<AttendanceContextValue | null>(null)

export function useAttendance() {
  const ctx = useContext(AttendanceContext)
  if (!ctx) throw new Error('useAttendance must be used within AttendanceProvider')
  return ctx
}

export function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const [lessonId,           setLessonId]           = useState<string | null>(null)
  const [lessonTitle,        setLessonTitle]        = useState('')
  const [visible,            setVisible]            = useState(false)
  const [externalDeviceName, setExternalDeviceName] = useState('')

  function startAttendance(id: string, title: string) {
    setLessonId(id)
    setLessonTitle(title)
    setVisible(true)
  }

  function stopAttendance() {
    setLessonId(null)
    setLessonTitle('')
    setVisible(false)
    setExternalDeviceName('')
  }

  function openPanel() {
    setVisible(true)
  }

  function dismissPanel() {
    setVisible(false)
  }

  return (
    <AttendanceContext.Provider value={{
      startAttendance,
      stopAttendance,
      openPanel,
      dismissPanel,
      lessonId,
      lessonTitle,
      visible,
      externalDeviceName,
      setExternalDeviceName,
    }}>
      {children}
    </AttendanceContext.Provider>
  )
}
