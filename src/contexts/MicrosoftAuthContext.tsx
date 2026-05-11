import React, { createContext, useContext, useState, useRef, useCallback } from 'react'
import { PublicClientApplication, type AccountInfo, InteractionRequiredAuthError } from '@azure/msal-browser'
import { useDocument } from '@/hooks/useFirestore'

export interface SharePointConfigDoc {
  id: string
  tenantId: string
  clientId: string
  siteUrl: string
  siteId: string   // resolved after successful test; stored to avoid re-resolution
  basePath: string // root folder inside the drive, e.g. "CineForge"
}

const GRAPH_SCOPES = [
  'https://graph.microsoft.com/Files.ReadWrite.All',
  'https://graph.microsoft.com/Sites.ReadWrite.All',
]

interface MicrosoftAuthState {
  config: SharePointConfigDoc | null
  configLoading: boolean
  isConfigured: boolean
  msAccount: AccountInfo | null
  isMsSignedIn: boolean
  signInWithMicrosoft: () => Promise<void>
  signOutMicrosoft: () => Promise<void>
  getAccessToken: () => Promise<string | null>
}

const MicrosoftAuthContext = createContext<MicrosoftAuthState | null>(null)

export function MicrosoftAuthProvider({ children }: { children: React.ReactNode }) {
  const { data: config, loading: configLoading } = useDocument<SharePointConfigDoc>('settings', 'sharepoint')
  const [msAccount, setMsAccount] = useState<AccountInfo | null>(null)
  const pcaRef = useRef<PublicClientApplication | null>(null)
  const pcaInitRef = useRef<Promise<PublicClientApplication> | null>(null)

  const getPca = useCallback(async (): Promise<PublicClientApplication | null> => {
    if (!config?.clientId || !config?.tenantId) return null

    // Return existing initialized instance
    if (pcaRef.current) return pcaRef.current

    // Deduplicate concurrent initialization calls
    if (pcaInitRef.current) return pcaInitRef.current

    pcaInitRef.current = (async () => {
      const pca = new PublicClientApplication({
        auth: {
          clientId: config.clientId,
          authority: `https://login.microsoftonline.com/${config.tenantId}`,
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: 'sessionStorage' },
      })
      await pca.initialize()

      // Restore any cached account
      const accounts = pca.getAllAccounts()
      if (accounts.length > 0) setMsAccount(accounts[0])

      pcaRef.current = pca
      return pca
    })()

    return pcaInitRef.current
  }, [config?.clientId, config?.tenantId])

  const signInWithMicrosoft = useCallback(async () => {
    const pca = await getPca()
    if (!pca) throw new Error('SharePoint not configured')

    const result = await pca.loginPopup({ scopes: GRAPH_SCOPES })
    setMsAccount(result.account)
  }, [getPca])

  const signOutMicrosoft = useCallback(async () => {
    const pca = await getPca()
    if (!pca || !msAccount) return
    await pca.logoutPopup({ account: msAccount })
    setMsAccount(null)
  }, [getPca, msAccount])

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const pca = await getPca()
    if (!pca) return null

    const accounts = pca.getAllAccounts()
    if (accounts.length === 0) return null

    const account = msAccount ?? accounts[0]
    try {
      const result = await pca.acquireTokenSilent({ scopes: GRAPH_SCOPES, account })
      return result.accessToken
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        const result = await pca.acquireTokenPopup({ scopes: GRAPH_SCOPES, account })
        return result.accessToken
      }
      throw err
    }
  }, [getPca, msAccount])

  const isConfigured = !!(config?.clientId && config?.tenantId && config?.siteId)
  const isMsSignedIn = msAccount !== null

  return (
    <MicrosoftAuthContext.Provider value={{
      config,
      configLoading,
      isConfigured,
      msAccount,
      isMsSignedIn,
      signInWithMicrosoft,
      signOutMicrosoft,
      getAccessToken,
    }}>
      {children}
    </MicrosoftAuthContext.Provider>
  )
}

export function useMicrosoftAuth(): MicrosoftAuthState {
  const ctx = useContext(MicrosoftAuthContext)
  if (!ctx) throw new Error('useMicrosoftAuth must be used within <MicrosoftAuthProvider>')
  return ctx
}
