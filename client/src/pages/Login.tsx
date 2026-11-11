import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Crown,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wrench,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { api, errorMessage } from '../lib/api'
import { Button, Field, Input } from '../components/ui'

const features = [
  {
    icon: Sparkles,
    title: 'AI-assisted, never AI-decided',
    text: 'Diagnosis ideas stay labelled as suggestions until a technician verifies them.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy-first public reports',
    text: 'Customers see what was fixed and what they paid — never your costs or margins.',
  },
  {
    icon: Wrench,
    title: 'One workflow, start to finish',
    text: 'Intake, quotes, parts, payments, warranty and QR service reports in one place.',
  },
]

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  // The one-click demo buttons only appear when the server explicitly opts in
  // (local UI-preview harness). Production installs never advertise credentials.
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ demoLoginHints?: boolean }>('/health'),
    retry: false,
  })
  const demoHints = health.data?.demoLoginHints === true

  // Determine current portal: 'OWNER' | 'TECHNICIAN'
  const roleParam = searchParams.get('role')?.toUpperCase()
  const initialPortal: 'OWNER' | 'TECHNICIAN' =
    roleParam === 'TECHNICIAN' ? 'TECHNICIAN' : 'OWNER'

  const [portal, setPortal] = useState<'OWNER' | 'TECHNICIAN'>(initialPortal)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Sync state if query parameter changes
  useEffect(() => {
    if (roleParam === 'TECHNICIAN' || roleParam === 'OWNER') {
      setPortal(roleParam)
    }
  }, [roleParam])

  const switchPortal = (nextPortal: 'OWNER' | 'TECHNICIAN') => {
    setPortal(nextPortal)
    setError('')
    setSearchParams({ role: nextPortal.toLowerCase() }, { replace: true })
    setIdentifier('')
    setPassword('')
  }

  const from =
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    typeof (location.state as { from?: unknown }).from === 'string'
      ? (location.state as { from: string }).from
      : '/dashboard'

  useEffect(() => {
    document.title = `${portal === 'OWNER' ? 'Owner Portal' : 'Technician Portal'} · FIXIT AI`
  }, [portal])

  if (user) return <Navigate to={from} replace />

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(identifier.trim(), password, portal, rememberMe)
      navigate(from, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const fillDemo = (demoType: 'owner' | 'tech1' | 'tech2') => {
    if (demoType === 'owner') {
      switchPortal('OWNER')
      setIdentifier('OWNER01')
      setPassword('Fixit@12345')
    } else if (demoType === 'tech1') {
      switchPortal('TECHNICIAN')
      setIdentifier('TECH01')
      setPassword('Fixit@12345')
    } else {
      switchPortal('TECHNICIAN')
      setIdentifier('TECH02')
      setPassword('Fixit@12345')
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-50 dark:bg-[#070b11]">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        {/* Left Branding Column */}
        <div className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="grid-bg absolute inset-0 opacity-70" />
          <div className="absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-indigo-600/25 blur-3xl" />
          <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-violet-600/20 blur-3xl" />

          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500 shadow-lg shadow-indigo-500/30">
                <Wrench className="h-5 w-5" />
              </span>
              <div>
                <p className="text-lg font-bold tracking-tight">FIXIT AI</p>
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-indigo-200/70">
                  Repair Intelligence Platform
                </p>
              </div>
            </div>

            <h1 className="mt-14 max-w-lg text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Enterprise Device Diagnostics &amp;{' '}
              <span className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-transparent">
                Service Center Management
              </span>
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">
              Dedicated role-separated workspaces for shop proprietors and service technicians with real-time analytics and hardware repair workflows.
            </p>
          </div>

          <div className="relative mt-12 space-y-5">
            {features.map((feature) => (
              <div key={feature.title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-indigo-300">
                  <feature.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{feature.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{feature.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="relative mt-12 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
            <span>Role-Based Access Control Active</span>
            <span>v2.4 Production Engine</span>
          </div>
        </div>

        {/* Right Form Column */}
        <div className="flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-md">
            {/* Mobile Header */}
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/25">
                <Wrench className="h-4.5 w-4.5" />
              </span>
              <div>
                <p className="text-base font-bold tracking-tight text-slate-900 dark:text-white">FIXIT AI</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
                  Repair Intelligence
                </p>
              </div>
            </div>

            {/* Portal Selection Tabs */}
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/80 p-1 dark:bg-slate-800/80">
              <button
                type="button"
                onClick={() => switchPortal('OWNER')}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-xs font-bold transition-all sm:px-3 ${
                  portal === 'OWNER'
                    ? 'bg-white dark:bg-[#0c121e] text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Crown className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="truncate">Shop Owner Login</span>
              </button>
              <button
                type="button"
                onClick={() => switchPortal('TECHNICIAN')}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-xs font-bold transition-all sm:px-3 ${
                  portal === 'TECHNICIAN'
                    ? 'bg-white dark:bg-[#0c121e] text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Wrench className="h-4 w-4 shrink-0 text-indigo-500" />
                <span className="truncate">Technician Login</span>
              </button>
            </div>

            {/* Title & Portal Badge */}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                  {portal === 'OWNER' ? 'Owner Sign In' : 'Technician Sign In'}
                </h2>
                <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                  {portal === 'OWNER'
                    ? 'Complete administrative control & financial management'
                    : 'Assigned repairs, diagnostics, and parts workflow'}
                </p>
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase leading-tight tracking-wider ${
                  portal === 'OWNER'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                    : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300'
                }`}
              >
                {portal === 'OWNER' ? (
                  <>
                    <Crown className="h-3 w-3" /> Owner Portal
                  </>
                ) : (
                  <>
                    <Wrench className="h-3 w-3" /> Tech Portal
                  </>
                )}
              </span>
            </div>

            {/* Form */}
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <Field
                label={portal === 'OWNER' ? 'Owner User ID or Email' : 'Technician User ID or Email'}
                htmlFor="identifier"
              >
                <div className="relative">
                  {portal === 'OWNER' ? (
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  ) : (
                    <UserCheck className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  )}
                  <Input
                    id="identifier"
                    type="text"
                    required
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder={
                      portal === 'OWNER'
                        ? 'e.g. OWNER01 or owner@fixit.local'
                        : 'e.g. TECH01 or tech1@fixit.local'
                    }
                    className="pl-12"
                  />
                </div>
              </Field>

              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••••"
                    className="pl-12 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 dark:border-white/20 dark:bg-white/5"
                  />
                  <span>Remember me</span>
                </label>

                <Link
                  to={`/forgot-password?portal=${portal.toLowerCase()}`}
                  className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

              {error ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span>{error}</span>
                    {error.includes('Owner Portal') && (
                      <button
                        type="button"
                        onClick={() => switchPortal('TECHNICIAN')}
                        className="block mt-1 font-bold underline hover:text-rose-900 dark:hover:text-white"
                      >
                        Click here to switch to Technician Login
                      </button>
                    )}
                    {error.includes('Technician Portal') && (
                      <button
                        type="button"
                        onClick={() => switchPortal('OWNER')}
                        className="block mt-1 font-bold underline hover:text-rose-900 dark:hover:text-white"
                      >
                        Click here to switch to Owner Login
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              <Button type="submit" size="lg" className="w-full" loading={submitting}>
                Sign in to {portal === 'OWNER' ? 'Owner Dashboard' : 'Technician Workspace'}
              </Button>
            </form>

            {/* Quick-Fill Demo Accounts (preview harness only — the server
                reports demoLoginHints; production never shows credentials) */}
            {demoHints ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  One-Click Demo Credentials
                </p>
                <span className="text-[10px] text-slate-400 font-mono">Password: Fixit@12345</span>
              </div>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
                <button
                  type="button"
                  onClick={() => fillDemo('owner')}
                  className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50/60 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  <Crown className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Ravi (Owner)</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('tech1')}
                  className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-indigo-300/60 bg-indigo-50/60 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-800 transition hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
                >
                  <Wrench className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Arjun (Tech 1)</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('tech2')}
                  className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-indigo-300/60 bg-indigo-50/60 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-800 transition hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
                >
                  <Wrench className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Meena (Tech 2)</span>
                </button>
              </div>
            </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
