import React, { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import type { UserDoc, UserRole } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────

interface AuthState {
  user:        User | null
  profile:     UserDoc | null
  role:        UserRole | null
  cohortId:    string | null
  loading:     boolean
  signIn:      (email: string, password: string) => Promise<void>
  signOut:     () => Promise<void>
  refreshToken: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

// ─────────────────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,     setUser]     = useState<User | null>(null)
  const [profile,  setProfile]  = useState<UserDoc | null>(null)
  const [role,     setRole]     = useState<UserRole | null>(null)
  const [cohortId, setCohortId] = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)

  // Read role/cohortId from the JWT custom claims (set by Cloud Function)
  async function hydrateFromToken(u: User) {
    const tokenResult = await u.getIdTokenResult()
    setRole((tokenResult.claims.role as UserRole) ?? null)
    setCohortId((tokenResult.claims.cohortId as string) ?? null)

    // Load the Firestore user profile
    const snap = await getDoc(doc(db, 'users', u.uid))
    if (snap.exists()) {
      setProfile({ ...(snap.data() as UserDoc), uid: snap.id })
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        await hydrateFromToken(u)
      } else {
        setProfile(null)
        setRole(null)
        setCohortId(null)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  async function signIn(email: string, password: string) {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    await hydrateFromToken(credential.user)
  }

  async function signOut() {
    await firebaseSignOut(auth)
    setProfile(null)
    setRole(null)
    setCohortId(null)
  }

  // Force a token refresh — call this after accepting an invite so the
  // new custom claims (role, cohortId) take effect immediately.
  async function refreshToken() {
    if (auth.currentUser) {
      await auth.currentUser.getIdToken(true)
      await hydrateFromToken(auth.currentUser)
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, role, cohortId, loading, signIn, signOut, refreshToken }}>
      {children}
    </AuthContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
