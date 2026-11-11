import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { User } from './types'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (
    identifier: string,
    password: string,
    portal?: 'OWNER' | 'TECHNICIAN',
    rememberMe?: boolean,
  ) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  updateUser: (updated: Partial<User>) => void
  firstLoginChangePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const queryClient = useQueryClient()

  const refresh = useCallback(async () => {
    try {
      const result = await api.get<{ user: User | null }>('/auth/me')
      setUser(result.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (
      identifier: string,
      password: string,
      portal?: 'OWNER' | 'TECHNICIAN',
      rememberMe = false,
    ) => {
      const result = await api.post<{ user: User }>('/auth/login', {
        identifier,
        password,
        portal,
        rememberMe,
      })
      setUser(result.user)
      await queryClient.invalidateQueries()
      return result.user
    },
    [queryClient],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      setUser(null)
      queryClient.clear()
    }
  }, [queryClient])

  const updateUser = useCallback((updated: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...updated } : prev))
  }, [])

  const firstLoginChangePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await api.post('/auth/first-login-change-password', {
        currentPassword,
        newPassword,
      })
      setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev))
    },
    [],
  )

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      refresh,
      updateUser,
      firstLoginChangePassword,
    }),
    [user, loading, login, logout, refresh, updateUser, firstLoginChangePassword],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
