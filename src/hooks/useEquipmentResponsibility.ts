import { useAuth } from '@/contexts/AuthContext'
import { useDocument } from '@/hooks/useFirestore'
import type { EquipmentResponsibility } from '@/types'

// The signed-in staff member's booking categories (unset = all of them)
export function useEquipmentResponsibility() {
  const { profile } = useAuth()
  const { data, loading } = useDocument<{ id: string; responsibility?: Record<string, EquipmentResponsibility> }>('settings', 'equipment')
  const map = data?.responsibility ?? {}
  return { mine: profile ? map[profile.uid] : undefined, map, loading }
}
