import { useSchool } from '@/contexts/SchoolContext'
import { deriveProductType, type ProductType } from '@/lib/features'

export function useProductType(): ProductType {
  const { productType, tier, modules } = useSchool()
  return deriveProductType({ productType, tier, modules })
}
