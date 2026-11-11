import { useSchool } from '@/contexts/SchoolContext'
import { effectiveModules, isModuleOn, type ModuleFlags, type ModuleId } from '@/lib/features'

/** Enabled modules — explicit on the school doc, or derived from its tier */
export function useModules(): { modules: ModuleFlags; explicit: boolean; isOn: (m: ModuleId) => boolean } {
  const { tier, modules } = useSchool()
  const effective = effectiveModules({ tier, modules })
  return { modules: effective, explicit: !!modules, isOn: m => isModuleOn(effective, m) }
}

/**
 * For screens no feature gated before modules existed: hidden only when the
 * school has explicit modules with this one off, so legacy schools keep
 * exactly what they see today.
 */
export function useModuleGate(module: ModuleId): boolean {
  const { modules } = useSchool()
  return !modules || isModuleOn(modules, module)
}
