import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldAlert, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { Button, Field, Input, LoadingState } from '../components/ui'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const [verifying, setVerifying] = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [accountEmail, setAccountEmail] = useState('')
  const [accountName, setAccountName] = useState('')
  const [verifyError, setVerifyError] = useState('')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) {
      setVerifying(false)
      setTokenValid(false)
      setVerifyError('No password reset token provided. Please request a new link.')
      return
    }

    const checkToken = async () => {
      try {
        const res = await api.get<{ valid: boolean; email: string; name: string }>(
          `/auth/verify-reset-token/${encodeURIComponent(token)}`,
        )
        if (res.valid) {
          setTokenValid(true)
          setAccountEmail(res.email)
          setAccountName(res.name)
        } else {
          setTokenValid(false)
          setVerifyError('The reset link is invalid or has expired.')
        }
      } catch (err) {
        setTokenValid(false)
        setVerifyError(errorMessage(err) || 'The reset link is invalid or has expired.')
      } finally {
        setVerifying(false)
      }
    }

    void checkToken()
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters long.')
      return
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setFormError('Password must contain at least one letter and one number.')
      return
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/auth/reset-password', {
        token,
        newPassword: password,
      })
      setSuccess(true)
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#070b11]">
        <LoadingState label="Verifying security token..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#070b11] py-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/30">
            <KeyRound className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Set New Password
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Secure password replacement for FIXIT AI
          </p>
        </div>

        <div className="bg-white dark:bg-[#0c121e] border border-slate-200/80 dark:border-white/10 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-900/5">
          {!tokenValid ? (
            <div className="space-y-4 text-center py-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Invalid or Expired Link
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {verifyError}
              </p>
              <div className="pt-2">
                <Link to="/forgot-password?portal=owner">
                  <Button size="lg" className="w-full">
                    Request New Reset Link
                  </Button>
                </Link>
              </div>
            </div>
          ) : success ? (
            <div className="space-y-4 text-center py-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Password Reset Complete!
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Your password has been updated securely. You can now log into your account using your new credentials.
              </p>
              <div className="pt-2">
                <Button size="lg" className="w-full" onClick={() => navigate('/login?role=owner')}>
                  Sign In with New Password
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div>
                  <span className="font-semibold text-slate-900 dark:text-white">{accountName}</span> ({accountEmail})
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Security token verified. Enter your replacement password below.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="New Password" htmlFor="new-password">
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters..."
                      className="pl-12 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>

                <Field label="Confirm New Password" htmlFor="confirm-password">
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password..."
                      className="pl-12"
                    />
                  </div>
                </Field>

                {formError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                    {formError}
                  </div>
                )}

                <Button type="submit" size="lg" className="w-full" loading={submitting}>
                  Save New Password
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

