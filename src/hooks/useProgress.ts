import { useDocument } from './useFirestore'
import type { ProgressDoc } from '@/types'
import { useAuth } from '@/contexts/AuthContext'

export function useMyProgress() {
  const { user } = useAuth()
  return useDocument<ProgressDoc>('progress', user?.uid)
}
