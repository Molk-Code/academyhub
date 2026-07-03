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
        const primaryRole = (tokenResult.claims.role as UserRole) ?? null
        setRole(primaryRole)

        // One-time fetch to get initial cohortId for the claims check
        const snap = await getDoc(doc(db, 'users', u.uid))
        const claimCohortId = (tokenResult.claims.cohortId as string) ?? null
        if (snap.exists()) {
          const data = snap.data() as UserDoc
          if (data.disabled === true) {
            await firebaseSignOut(auth)
            return
          }
          const profileDoc = { ...data, uid: snap.id }
          setProfile(profileDoc)
          setRoles(profileDoc.roles?.length ? profileDoc.roles : (primaryRole ? [primaryRole] : []))
          setCohortId(claimCohortId ?? profileDoc.cohortId ?? null)
        } else if (primaryRole) {
          setRoles([primaryRole])
        }

        // Live listener so totalPoints and other fields stay current
        profileUnsub = onSnapshot(
          doc(db, 'users', u.uid),
          (s) => {
            if (s.exists()) {
              setProfile(prev => {
                const updated = { ...s.data() as UserDoc, uid: s.id }
                if (!prev) return updated
                return updated
              })
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
