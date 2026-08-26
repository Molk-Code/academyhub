import React, { createContext, useContext, useEffect, useState } from 'react'
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import type { UserDoc, UserRole } from '@/types'

class DisabledAccountError extends Error {
  constructor() { super('Your account has been deactivated. Contact your teacher.') }
}

interface AuthState {
  user:               User | null
  profile:            UserDoc | null
  role:               UserRole | null
  roles:              UserRole[]
  cohortId:           string | null
  previewCohortId:    string | null
  setPreviewCohortId: (id: string | null) => void
  loading:            boolean
  signIn:             (email: string, password: string) => Promise<void>
  signOut:            () => Promise<void>
  refreshToken:       () => Promise<void>
  refreshProfile:     () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,            setUser]            = useState<User | null>(null)
  const [profile,         setProfile]         = useState<UserDoc | null>(null)
  const [role,            setRole]            = useState<UserRole | null>(null)
  const [roles,           setRoles]           = useState<UserRole[]>([])
  const [cohortId,        setCohortId]        = useState<string | null>(null)
  const [previewCohortId, setPreviewCohortId] = useState<string | null>(null)
  const [loading,         setLoading]         = useState(true)

  useEffect(() => {
    let profileUnsub: (() => void) | null = null

    const authUnsub = onIdTokenChanged(auth, async (u) => {
      profileUnsub?.()
      profileUnsub = null

      if (!u) {
        setUser(null)
        setProfile(null)
        setRole(null)
        setRoles([])
        setCohortId(null)
        setLoading(false)
        return
      }

      setUser(u)

      // Safety net: on mobile, getDoc/getIdTokenResult can hang indefinitely when
      // the network is slow or the app was backgrounded. Force-clear loading after 8s.
      const loadingTimeout = setTimeout(() => setLoading(false), 8000)

      try {
        const tokenResult = await u.getIdTokenResult()
        const claimRole = (tokenResult.claims.role as UserRole) ?? null
        setRole(claimRole)

        // One-time fetch to get initial cohortId for the claims check
        const snap = await getDoc(doc(db, 'users', u.uid))
        const claimCohortId = (tokenResult.claims.cohortId as string) ?? null
        if (snap.exists()) {
          const data = snap.data() as UserDoc
          if (data.disabled === true) {
            sessionStorage.setItem('auth_disabled', '1')
            await firebaseSignOut(auth)
            return
          }
          const profileDoc = { ...data, uid: snap.id }
          setProfile(profileDoc)
          // Fall back to Firestore role when custom claims haven't propagated yet
          // (e.g. right after account creation before onUserCreate Cloud Function finishes)
          const effectiveRole = claimRole ?? ((data.role as UserRole) || null)
          setRole(effectiveRole)
          // Always include the primary role in the roles array so switch buttons appear correctly.
          // Multi-role users (e.g. teacher+admin) have a roles[] in Firestore; single-role users just get [primaryRole].
          const firestoreRoles: UserRole[] = profileDoc.roles?.length ? profileDoc.roles as UserRole[] : []
          const mergedRoles = effectiveRole && !firestoreRoles.includes(effectiveRole)
            ? [effectiveRole, ...firestoreRoles]
            : firestoreRoles.length ? firestoreRoles : (effectiveRole ? [effectiveRole] : [])
          setRoles(mergedRoles)
          // Teachers and admins are never bound to a cohort — always use Firestore doc
          const isStaff = effectiveRole === 'teacher' || effectiveRole === 'admin'
          setCohortId(isStaff ? (profileDoc.cohortId ?? null) : (claimCohortId ?? profileDoc.cohortId ?? null))
        } else if (claimRole) {
          setRoles([claimRole])
        }

        // Track last-seen values so the listener can detect permission changes
        const lastSeen = {
          role:     (snap.exists() ? snap.data()?.role : null) ?? null,
          cohortId: (snap.exists() ? snap.data()?.cohortId : null) ?? null,
        }

        // Live listener — keeps profile/role/cohortId current and forces a token
        // refresh when role or cohortId changes so Firestore rules pick up new claims.
        profileUnsub = onSnapshot(
          doc(db, 'users', u.uid),
          (s) => {
            if (s.exists()) {
              const updated = { ...s.data() as UserDoc, uid: s.id }

              // Admin deactivated this account — sign out immediately on all devices
              if (updated.disabled === true) {
                sessionStorage.setItem('auth_disabled', '1')
                firebaseSignOut(auth)
                return
              }

              setProfile(updated)

              // Keep primary role and cohortId in sync with Firestore immediately
              const updatedRole = (updated.role as UserRole) ?? null
              setRole(updatedRole)
              setCohortId(updated.cohortId ?? null)

              // Keep roles array in sync, always including the primary role
              setRoles(prev => {
                const base: UserRole[] = updated.roles?.length ? updated.roles as UserRole[] : []
                const primary = prev.find(r => r === updated.role) ?? updated.role as UserRole ?? null
                if (primary && !base.includes(primary)) return [primary, ...base]
                return base.length ? base : prev
              })

              // When role or cohortId changed, force a token refresh so Auth claims
              // match Firestore (the onUserDocUpdated Cloud Function syncs them server-
              // side; we give it 2 s to finish before invalidating the cached token).
              const newRole     = updated.role     ?? null
              const newCohortId = updated.cohortId ?? null
              if (newRole !== lastSeen.role || newCohortId !== lastSeen.cohortId) {
                lastSeen.role     = newRole
                lastSeen.cohortId = newCohortId
                setTimeout(() => auth.currentUser?.getIdToken(true), 2000)
              }
            }
          },
          (err) => { console.warn('Profile listener error:', err) },
        )
      } catch (err) {
        console.error('Failed to hydrate auth state:', err)
      } finally {
        clearTimeout(loadingTimeout)
        setLoading(false)
      }
    })

    return () => {
      authUnsub()
      profileUnsub?.()
    }
  }, [])

  async function signIn(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password)
    // Check disabled flag immediately after sign-in (before onIdTokenChanged fires)
    const snap = await getDoc(doc(db, 'users', auth.currentUser!.uid))
    if (snap.exists() && (snap.data() as UserDoc).disabled === true) {
      await firebaseSignOut(auth)
      throw new DisabledAccountError()
    }
  }

  async function signOut() {
    await firebaseSignOut(auth)
  }

  async function refreshToken() {
    if (auth.currentUser) {
      await auth.currentUser.getIdToken(true)
    }
  }

  // Refresh token when the tab becomes visible again — prevents stale-token
  // permission errors on iOS/Safari after the app is backgrounded.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && auth.currentUser) {
        auth.currentUser.getIdToken(true).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  async function refreshProfile() {
    if (!auth.currentUser) return
    const snap = await getDoc(doc(db, 'users', auth.currentUser.uid))
    if (snap.exists()) {
      setProfile({ ...snap.data() as UserDoc, uid: snap.id })
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, role, roles, cohortId, previewCohortId, setPreviewCohortId, loading, signIn, signOut, refreshToken, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
