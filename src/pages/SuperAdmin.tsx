import { useAuth } from '@/contexts/AuthContext'

const SUPER_ADMIN_EMAILS = ['fredrik.fridlund@gmail.com']

export default function SuperAdmin() {
  const { profile } = useAuth()

  if (!profile?.email || !SUPER_ADMIN_EMAILS.includes(profile.email)) {
    return <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p>Access denied</p>
    </div>
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold mb-2">Super Admin</h1>
      <p className="text-gray-400 mb-8">CineForge Platform Management</p>
      <div className="bg-zinc-900 rounded-xl p-6 border border-white/10">
        <h2 className="font-semibold mb-4">Schools</h2>
        <p className="text-gray-500 text-sm">Multi-tenancy not yet active. Currently serving: Molkom (beta)</p>
      </div>
    </div>
  )
}
