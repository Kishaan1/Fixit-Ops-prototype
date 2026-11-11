import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  KeyRound,
  Mail,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Wrench,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { Button, Field, Input } from '../components/ui'

export default function ForgotPassword() {
  const [searchParams] = useSearchParams()
  const initialPortal = searchParams.get('portal')?.toUpperCase() === 'OWNER' ? 'OWNER' : 'TECHNICIAN'
  const [portal, setPortal] = useState<'OWNER' | 'TECHNICIAN'>(initialPortal)

  // Technician state
  const [techIdentifier, setTechIdentifier] = useState('')
  const [techNotes, setTechNotes] = useState('')
  const [techLoading, setTechLoading] = useState(false)
  const [techSuccess, setTechSuccess] = useState<string | null>(null)
  const [techError, setTechError] = useState<string | null>(null)

  // Owner state
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerLoading, setOwnerLoading] = useState(false)
  const [ownerSuccess, setOwnerSuccess] = useState<{ message: string; resetUrl?: string } | null>(null)
  const [ownerError, setOwnerError] = useState<string | null>(null)

  const handleTechSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTechError(null)
    setTechSuccess(null)
    setTechLoading(true)
    try {
      const res = await api.post<{ ok: boolean; message: string }>('/auth/forgot-password/technician', {
        identifier: techIdentifier.trim(),
        notes: techNotes.trim() || undefined,
      })
      setTechSuccess(res.message)
    } catch (err) {
      setTechError(errorMessage(err))
    } finally {
      setTechLoading(false)
    }
  }

  const handleOwnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setOwnerError(null)
    setOwnerSuccess(null)
    setOwnerLoading(true)
    try {
      const res = await api.post<{ ok: boolean; message: string; resetUrl?: string }>('/auth/forgot-password/owner', {
        email: ownerEmail.trim(),
      })
      setOwnerSuccess({ message: res.message, resetUrl: res.resetUrl })
    } catch (err) {
      setOwnerError(errorMessage(err))
    } finally {
      setOwnerLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#070b11] py-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
      <div className="max-w-md w-full space-y-6">
        {/* Brand header */}
        <div className="text-center">
          <Link to="/login" className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 mb-6 transition">
            <ArrowLeft className="h-4 w-4" /> Back to Sign In
          </Link>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/30">
            <KeyRound className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Password Recovery
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Select your account type to recover your FIXIT AI credentials
          </p>
        </div>

        {/* Portal Switcher Tabs */}
        <div className="grid grid-cols-2 p-1.5 bg-slate-200/70 dark:bg-slate-800/80 rounded-2xl gap-1 text-sm font-semibold">
          <button
            type="button"
            onClick={() => {
              setPortal('TECHNICIAN')
              setTechError(null)
            }}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition ${
              portal === 'TECHNICIAN'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Wrench className="h-4 w-4" /> Technician
          </button>
          <button
            type="button"
            onClick={() => {
              setPortal('OWNER')
              setOwnerError(null)
            }}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition ${
              portal === 'OWNER'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShieldCheck className="h-4 w-4" /> Shop Owner
          </button>
        </div>

        {/* Content Card */}
        <div className="bg-white dark:bg-[#0c121e] border border-slate-200/80 dark:border-white/10 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-900/5">
          {portal === 'TECHNICIAN' ? (
            <div>
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                <Clock className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div>
                  <p className="font-semibold">Owner-Managed Password Recovery</p>
                  <p className="mt-0.5 leading-relaxed text-blue-800 dark:text-blue-300">
                    Submitting this form notifies the shop owner directly in their dashboard. The owner will review and issue a temporary login password or reset link.
                  </p>
                </div>
              </div>

              {techSuccess ? (
                <div className="space-y-4 text-center py-4">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    Request Transmitted!
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {techSuccess}
                  </p>
                  <div className="pt-2">
                    <Link to="/login?role=technician">
                      <Button variant="outline" className="w-full">
                        Return to Technician Login
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleTechSubmit} className="space-y-4">
                  <Field label="Technician User ID or Email" htmlFor="tech-identifier">
                    <div className="relative">
                      <UserCheck className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="tech-identifier"
                        type="text"
                        required
                        value={techIdentifier}
                        onChange={(e) => setTechIdentifier(e.target.value)}
                        placeholder="e.g. TECH01 or tech1@fixit.local"
                        className="pl-12"
                      />
                    </div>
                  </Field>

                  <Field label="Optional Note or Reason" htmlFor="tech-notes">
                    <textarea
                      id="tech-notes"
                      rows={2}
                      value={techNotes}
                      onChange={(e) => setTechNotes(e.target.value)}
                      placeholder="e.g. Forgot password after device change..."
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
                    />
                  </Field>

                  {techError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 flex items-start gap-2">
                      <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{techError}</span>
                    </div>
                  )}

                  <Button type="submit" size="lg" className="w-full" loading={techLoading}>
                    Send Reset Request to Owner
                  </Button>
                </form>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <p className="font-semibold">Independent Owner Recovery</p>
                  <p className="mt-0.5 leading-relaxed text-amber-800 dark:text-amber-300">
                    Enter the verified shop owner email address to generate an authenticated password reset link with a 1-hour security token.
                  </p>
                </div>
              </div>

              {ownerSuccess ? (
                <div className="space-y-4 text-center py-4">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    Reset Link Generated
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {ownerSuccess.message}
                  </p>
                  {ownerSuccess.resetUrl && (
                    <div className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-left">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                        Direct Security Link:
                      </p>
                      <Link
                        to={ownerSuccess.resetUrl}
                        className="text-xs font-mono text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                      >
                        {window.location.origin}{ownerSuccess.resetUrl}
                      </Link>
                    </div>
                  )}
                  <div className="pt-2">
                    {ownerSuccess.resetUrl ? (
                      <Link to={ownerSuccess.resetUrl}>
                        <Button size="lg" className="w-full">
                          Proceed to Reset Password
                        </Button>
                      </Link>
                    ) : (
                      <Link to="/login?role=owner">
                        <Button variant="outline" className="w-full">
                          Back to Owner Login
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              ) : (
                <form onSubmit={handleOwnerSubmit} className="space-y-4">
                  <Field label="Owner Registered Email" htmlFor="owner-email">
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="owner-email"
                        type="email"
                        required
                        value={ownerEmail}
                        onChange={(e) => setOwnerEmail(e.target.value)}
                        placeholder="owner@fixit.local"
                        className="pl-12"
                      />
                    </div>
                  </Field>

                  {ownerError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 flex items-start gap-2">
                      <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{ownerError}</span>
                    </div>
                  )}

                  <Button type="submit" size="lg" className="w-full" loading={ownerLoading}>
                    Generate Secure Reset Token
                  </Button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

