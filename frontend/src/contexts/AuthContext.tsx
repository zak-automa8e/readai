import React, { createContext, useContext, useEffect, useState } from 'react'
import { toast } from '@/hooks/use-toast'
import { renewSession, SESSION_ENDED, SESSION_RENEWED, type StoredSession } from '@/lib/session'

// Renew this long before the access token expires
const RENEW_EARLY_MS = 60 * 1000

interface User {
  id: string
  email: string
  display_name: string
  profile?: any
}

interface Session {
  access_token: string
  refresh_token: string
  expires_at: number
}

interface AuthError {
  message: string
}

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signUp: (email: string, password: string, displayName?: string) => Promise<{ user: User | null; error: AuthError | null }>
  signIn: (email: string, password: string) => Promise<{ user: User | null; error: AuthError | null }>
  signOut: () => Promise<{ error: AuthError | null }>
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>
  refreshToken: () => Promise<{ error: AuthError | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: React.ReactNode
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  // Helper function to make authenticated API calls
  const apiCall = async (endpoint: string, options: RequestInit = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'API request failed')
    }

    return response.json()
  }

  // Load session from localStorage on mount
  useEffect(() => {
    const savedSession = localStorage.getItem('readai_session')
    const savedUser = localStorage.getItem('readai_user')

    if (savedSession && savedUser) {
      try {
        const parsedSession = JSON.parse(savedSession)
        const parsedUser = JSON.parse(savedUser)

        // Check if session is still valid
        if (parsedSession.expires_at > Date.now() / 1000) {
          setSession(parsedSession)
          setUser(parsedUser)
        } else {
          // Session expired, try to refresh
          refreshTokenInternal()
        }
      } catch (error) {
        clearSession()
      }
    }
    setLoading(false)
  }, [])

  // Keep the session alive while the app is open: renew a minute before expiry, and at once when
  // the tab comes back after its timer was held up (background tabs run timers late)
  useEffect(() => {
    if (!session) return
    const renewAt = session.expires_at * 1000 - RENEW_EARLY_MS
    const timer = window.setTimeout(() => void renewSession(), Math.max(renewAt - Date.now(), 0))
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= renewAt) void renewSession()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session])

  // Renewals made anywhere (timer or a refused request) land here; a refused refresh token ends the session
  useEffect(() => {
    const onRenewed = (event: Event) => setSession((event as CustomEvent<StoredSession>).detail)
    const onEnded = () => {
      clearSession()
      toast({ title: 'Your session ended', description: 'Sign in again to continue.' })
    }
    window.addEventListener(SESSION_RENEWED, onRenewed)
    window.addEventListener(SESSION_ENDED, onEnded)
    return () => {
      window.removeEventListener(SESSION_RENEWED, onRenewed)
      window.removeEventListener(SESSION_ENDED, onEnded)
    }
  }, [])

  const saveSession = (user: User, session: Session) => {
    setUser(user)
    setSession(session)
    localStorage.setItem('readai_user', JSON.stringify(user))
    localStorage.setItem('readai_session', JSON.stringify(session))
  }

  const clearSession = () => {
    setUser(null)
    setSession(null)
    localStorage.removeItem('readai_user')
    localStorage.removeItem('readai_session')
  }

  // Through the shared renewal (lib/session): the refresh token is single-use
  const refreshTokenInternal = async () => {
    try {
      const newSession = await renewSession()
      if (!newSession) {
        throw new Error('Token refresh failed')
      }

      // Get updated user profile
      const userResponse = await fetch(`${API_BASE_URL}/auth/profile`, {
        headers: {
          'Authorization': `Bearer ${newSession.access_token}`,
        },
      })

      if (userResponse.ok) {
        const userData = await userResponse.json()
        saveSession(userData.user, newSession)
      }
    } catch (error) {
      clearSession()
    }
  }

  const signUp = async (email: string, password: string, displayName?: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        return { user: null, error: { message: data.error } }
      }

      return { user: data.user, error: null }
    } catch (error) {
      return { user: null, error: { message: 'Registration failed' } }
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        return { user: null, error: { message: data.error } }
      }

      saveSession(data.user, data.session)
      return { user: data.user, error: null }
    } catch (error) {
      return { user: null, error: { message: 'Login failed' } }
    }
  }

  const signOut = async () => {
    try {
      if (session?.access_token) {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        })
      }
    } catch (error) {
      // ignore logout error
    } finally {
      clearSession()
    }
    return { error: null }
  }

  const resetPassword = async (email: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        return { error: { message: data.error } }
      }

      return { error: null }
    } catch (error) {
      return { error: { message: 'Password reset failed' } }
    }
  }

  const refreshToken = async () => {
    if (!session?.refresh_token) {
      return { error: { message: 'No refresh token available' } }
    }

    try {
      await refreshTokenInternal()
      return { error: null }
    } catch (error) {
      return { error: { message: 'Token refresh failed' } }
    }
  }

  const value = {
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword,
    refreshToken,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
