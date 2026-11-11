import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleUserRound,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Moon,
  PackageSearch,
  PlusCircle,
  QrCode,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  UserCheck,
  UserCog,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { useToast } from '../lib/toast'
import { relative } from '../lib/format'
import type { NotificationItem } from '../lib/types'
import { Avatar, Badge, Button, Dialog, Field, Input, cn } from './ui'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  ownerOnly?: boolean
  end?: boolean
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/repairs/new', label: 'New Repair', icon: PlusCircle },
  { to: '/diagnostics', label: 'AI Diagnostics', icon: Sparkles },
  { to: '/repairs', label: 'Repairs', icon: Wrench, end: true },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/owner/technicians', label: 'Technician Accounts', icon: Shield, ownerOnly: true },
  { to: '/technicians', label: 'Technician Profiles', icon: UserCog, ownerOnly: true },
  { to: '/owner/password-requests', label: 'Password Requests', icon: KeyRound, ownerOnly: true },
  { to: '/parts', label: 'Spare Parts', icon: PackageSearch },
  { to: '/inventory', label: 'Inventory', icon: Boxes, ownerOnly: true },
  { to: '/reports', label: 'QR Reports', icon: QrCode },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, ownerOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, ownerOnly: true },
]

export default function Layout() {
  const { user, logout, firstLoginChangePassword } = useAuth()
  const { theme, toggle } = useTheme()
  const { error } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const profileRef = useRef<HTMLDivElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)

  // Mandatory password change state
  const [tempPass, setTempPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmNewPass, setConfirmNewPass] = useState('')
  const [showMandatoryPass, setShowMandatoryPass] = useState(false)
  const [mandatorySubmitting, setMandatorySubmitting] = useState(false)
  const [mandatoryError, setMandatoryError] = useState('')

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  })

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  useEffect(() => {
    setMobileOpen(false)
    setProfileOpen(false)
    setNotificationsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false)
      if (notificationsRef.current && !notificationsRef.current.contains(target))
        setNotificationsOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const handleLogout = async () => {
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      error('Could not sign out', 'Please try again.')
    }
  }

  const handleMandatoryPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMandatoryError('')
    if (newPass.length < 8) {
      setMandatoryError('New password must be at least 8 characters long.')
      return
    }
    if (newPass !== confirmNewPass) {
      setMandatoryError('New passwords do not match.')
      return
    }
    setMandatorySubmitting(true)
    try {
      await firstLoginChangePassword(tempPass, newPass)
      setTempPass('')
      setNewPass('')
      setConfirmNewPass('')
    } catch (err: any) {
      setMandatoryError(err?.message || 'Failed to update password.')
    } finally {
      setMandatorySubmitting(false)
    }
  }

  const items = navItems.filter((item) => !item.ownerOnly || user?.role === 'OWNER')
  const unread = notifications.data?.unread ?? 0

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 px-5 border-b border-slate-200/80 dark:border-white/10">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/25">
          <Wrench className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-white">FIXIT AI</p>
          <p className="truncate text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
            {user?.role === 'OWNER' ? 'Owner Portal' : 'Technician Hub'}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-primary/5 text-primary dark:bg-primary/10 dark:text-primary'
                  : 'text-text-hover hover:text-primary dark:text-text-secondary hover:bg-surface-subtle dark:hover:bg-surface-subtle',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition',
                    isActive
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300',
                  )}
                />
                <span className="truncate">{item.label}</span>
                {item.to === '/repairs' && unread > 0 ? (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        ))}

        {/* Technician specific Profile shortcut */}
        {user?.role === 'TECHNICIAN' && (
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-primary/5 text-primary dark:bg-primary/10 dark:text-primary'
                  : 'text-text-hover hover:text-primary dark:text-text-secondary hover:bg-surface-subtle dark:hover:bg-surface-subtle',
              )
            }
          >
            <CircleUserRound className="h-4 w-4 shrink-0 text-slate-400" />
            <span>My Profile</span>
          </NavLink>
        )}
      </nav>

      {/* Logged in role footer */}
      <div className="shrink-0 border-t border-slate-200/80 p-3 dark:border-white/10">
        <NavLink
          to="/profile"
          className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-slate-100 dark:hover:bg-white/5"
        >
          <div className="h-8 w-8 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
            {user?.profileImageUrl ? (
              <img
                src={user.profileImageUrl}
                alt={user.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="font-bold text-xs text-indigo-600 dark:text-indigo-400">
                {user?.name?.[0] || 'U'}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
              {user?.name}
            </p>
            <p className="truncate text-[10px] font-mono text-slate-500 dark:text-slate-400">
              {user?.userId || user?.role}
            </p>
          </div>
        </NavLink>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#070b11]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200/80 bg-white lg:block dark:border-white/10 dark:bg-[#0a1017]">
        {sidebar}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fade-in absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0a1017]">
            <button
              type="button"
              className="absolute right-3 top-4 rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-[#070b11]/80">
          <div className="flex h-16 min-w-0 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-white/10"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <form
              className="relative hidden max-w-md flex-1 sm:block"
              onSubmit={(event) => {
                event.preventDefault()
                if (search.trim()) navigate(`/repairs?q=${encodeURIComponent(search.trim())}`)
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search repairs, customers, devices…"
                className="h-9 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:bg-white/[0.06]"
              />
            </form>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* Theme toggle */}
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                onClick={toggle}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
              </Button>

              {/* Notifications */}
              <div className="relative" ref={notificationsRef}>
                <button
                  type="button"
                  onClick={() => setNotificationsOpen((open) => !open)}
                  className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
                  aria-label="Notifications"
                >
                  <Bell className="h-5 w-5" />
                  {unread > 0 ? (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  ) : null}
                </button>

                {notificationsOpen ? (
                  <div className="fade-in absolute right-0 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#0d141d]">
                    <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        Notifications
                      </p>
                      {unread > 0 ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                          onClick={() => markAll.mutate()}
                        >
                          Mark all read
                        </button>
                      ) : null}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifications.isLoading ? (
                        <p className="p-4 text-sm text-slate-500">Loading…</p>
                      ) : !notifications.data?.items.length ? (
                        <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                          You're all caught up.
                        </p>
                      ) : (
                        notifications.data.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              if (!item.read) markOne.mutate(item.id)
                              if (item.link) navigate(item.link)
                              setNotificationsOpen(false)
                            }}
                            className={cn(
                              'flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-0 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.04]',
                              !item.read && 'bg-indigo-50/40 dark:bg-indigo-500/[0.06]',
                            )}
                          >
                            <span
                              className={cn(
                                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                                item.read ? 'bg-slate-300 dark:bg-slate-600' : 'bg-indigo-500',
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block break-words text-sm font-medium leading-snug text-slate-800 dark:text-slate-100">
                                {item.title}
                              </span>
                              {item.body ? (
                                <span className="mt-0.5 line-clamp-2 block break-words text-xs leading-snug text-slate-500 dark:text-slate-400">
                                  {item.body}
                                </span>
                              ) : null}
                              <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">
                                {relative(item.createdAt)}
                              </span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Profile dropdown */}
              <div className="relative" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen((open) => !open)}
                  className="flex items-center gap-2.5 rounded-xl p-1 pl-2 transition hover:bg-slate-100 dark:hover:bg-white/10"
                >
                  <div className="hidden text-right sm:block">
                    <p className="max-w-32 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {user?.name}
                    </p>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                      {user?.role === 'OWNER' ? 'Shop Owner' : 'Technician'}
                    </p>
                  </div>

                  <div className="h-9 w-9 rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    {user?.profileImageUrl ? (
                      <img
                        src={user.profileImageUrl}
                        alt={user.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-bold text-xs text-indigo-600 dark:text-indigo-400">
                        {user?.name?.[0] || 'U'}
                      </span>
                    )}
                  </div>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
                </button>

                {profileOpen ? (
                  <div className="fade-in absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#0d141d]">
                    <div className="border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {user?.name}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {user?.email}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] font-mono text-slate-500">
                          ID: {user?.userId || 'N/A'}
                        </span>
                        <Badge tone={user?.role === 'OWNER' ? 'amber' : 'indigo'}>
                          {user?.role === 'OWNER' ? 'Owner' : 'Technician'}
                        </Badge>
                      </div>
                    </div>

                    <div className="p-1.5 space-y-0.5">
                      <button
                        type="button"
                        onClick={() => navigate('/profile')}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                      >
                        <CircleUserRound className="h-4 w-4 text-indigo-500" />
                        My Profile &amp; Settings
                      </button>

                      {user?.role === 'OWNER' && (
                        <>
                          <button
                            type="button"
                            onClick={() => navigate('/owner/technicians')}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            <Shield className="h-4 w-4 text-amber-500" />
                            Technician Accounts
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate('/owner/password-requests')}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            <KeyRound className="h-4 w-4 text-indigo-500" />
                            Password Reset Requests
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate('/settings')}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            <Settings className="h-4 w-4 text-slate-500" />
                            Shop Settings
                          </button>
                        </>
                      )}

                      <div className="border-t border-slate-100 dark:border-white/5 my-1" />

                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                      >
                        <LogOut className="h-4 w-4" /> Sign out
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>

      {/* Mandatory Password Change Dialog on First Login */}
      {user?.mustChangePassword && (
        <Dialog
          open={true}
          onOpenChange={() => {}}
          title="Mandatory Password Update"
          description="You are currently signed in with a temporary password. You must set a new personal password before you can continue."
        >
          <form onSubmit={handleMandatoryPasswordSubmit} className="space-y-4 py-2">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/20 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Your shop administrator has reset or created your credentials with a temporary password. Please establish your private password now.
              </span>
            </div>

            <Field label="Current Temporary Password" htmlFor="mand-curr">
              <Input
                id="mand-curr"
                type={showMandatoryPass ? 'text' : 'password'}
                required
                value={tempPass}
                onChange={(e) => setTempPass(e.target.value)}
                placeholder="Enter the temporary password..."
              />
            </Field>

            <Field label="New Password (min. 8 characters)" htmlFor="mand-new">
              <Input
                id="mand-new"
                type={showMandatoryPass ? 'text' : 'password'}
                required
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Create your new password..."
              />
            </Field>

            <Field label="Confirm New Password" htmlFor="mand-cnew">
              <Input
                id="mand-cnew"
                type={showMandatoryPass ? 'text' : 'password'}
                required
                value={confirmNewPass}
                onChange={(e) => setConfirmNewPass(e.target.value)}
                placeholder="Re-enter your new password..."
              />
            </Field>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-500">
                <input
                  type="checkbox"
                  checked={showMandatoryPass}
                  onChange={(e) => setShowMandatoryPass(e.target.checked)}
                />
                <span>Show passwords</span>
              </label>
            </div>

            {mandatoryError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {mandatoryError}
              </div>
            )}

            <div className="pt-2">
              <Button type="submit" size="lg" className="w-full" loading={mandatorySubmitting}>
                Save Password &amp; Enter Workspace
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  )
}
