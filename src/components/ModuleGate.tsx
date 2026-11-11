import { Navigate } from 'react-router-dom'
import { useSchool } from '@/contexts/SchoolContext'
import { isModuleOn, publicShopOpen, type ModuleId } from '@/lib/features'

interface Props {
  /** Open when any of these modules is on */
  module: ModuleId | ModuleId[]
  children: React.ReactNode
  redirectTo?: string
}

/**
 * Route guard for screens that belong to a module but had no feature gate
 * before modules existed. Only schools with explicit modules are gated —
 * legacy schools keep exactly what they had (see useModuleGate).
 */
export default function ModuleGate({ module, children, redirectTo = '/' }: Props) {
  const { modules } = useSchool()
  const wanted = Array.isArray(module) ? module : [module]
  if (modules && !wanted.some(m => isModuleOn(modules, m))) return <Navigate to={redirectTo} replace />
  return <>{children}</>
}

/** /shop: module-based schools need Rental & Inventory with the public shop switched on */
export function PublicShopGate({ children }: { children: React.ReactNode }) {
  const { modules, productType, publicShop } = useSchool()
  if (modules && !publicShopOpen({ modules, productType, publicShop })) return <Navigate to="/login" replace />
  return <>{children}</>
}
