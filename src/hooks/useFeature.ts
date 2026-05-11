import { useSchool } from '@/contexts/SchoolContext'

export function useFeature(feature: string): boolean {
  const { features } = useSchool()
  // During beta, all features enabled by default if not explicitly set
  return features[feature] !== false
}
