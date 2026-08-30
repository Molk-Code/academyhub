import { useSchool } from '@/contexts/SchoolContext'
import type { ProductType } from '@/lib/features'

export function useProductType(): ProductType {
  const school = useSchool()
  return school.productType ?? 'education'
}
