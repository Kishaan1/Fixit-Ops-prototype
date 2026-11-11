import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import type { PasswordResetRequestItem } from '../lib/types'
import { Button, Dialog, Input, LoadingState } from '../components/ui'

export default function PasswordResetRequests() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL')

  // Approval Modal state
  const [approvingRequest, setApprovingRequest] = useState<PasswordResetRequestItem | null>(null)
  const [customTempPassword, setCustomTempPassword] = useState('')
  const [rejectingRequest, setRejectingRequest] = useState<PasswordResetRequestItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // Result dialog for newly approved temporary password
  const [issuedResult, setIssuedResult] = useState<{
    open: boolean
    techName: string
    userId: string
    password: string
  }>({ open: false, techName: '', userId: '', password: '' })
  const [copied, setCopied] = useState(false)

  // Fetch Requests
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['password-requests'],
    queryFn: () => api.get<{ items: PasswordResetRequestItem[] }>('/technicians/password-requests'),
  })

  const items = data?.items ?? []

  // Approve Mutation
  const approveMutation = useMutation({
    mutationFn: async ({ id, tempPassword }: { id: string; tempPassword?: string }) => {
      return api.post<{ ok: boolean; temporaryPassword: string; message: string }>(
        `/technicians/password-requests/${id}/approve`,
        { temporaryPassword: tempPassword || undefined },
      )
    },
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['password-requests'] })
      queryClient.invalidateQueries({ queryKey: ['owner-technicians'] })
      const req = items.find((i) => i.id === variables.id)
      if (req) {
        setIssuedResult({
          open: true,
          techName: req.user.name,
          userId: req.user.userId || req.user.email,
          password: res.temporaryPassword,
        })
      }
      setApprovingRequest(null)
      setCustomTempPassword('')
    },
  })

  // Reject Mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      return api.post<{ ok: boolean; message: string }>(
        `/technicians/password-requests/${id}/reject`,
        { reason },
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['password-requests'] })
      setRejectingRequest(null)
      setRejectReason('')
    },
  })

  const openApprove = (req: PasswordResetRequestItem) => {
    setApprovingRequest(req)
    setCustomTempPassword(`Tech@${Math.floor(100000 + Math.random() * 900000)}`)
  }

  const handleApproveSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!approvingRequest) return
    approveMutation.mutate({
      id: approvingRequest.id,
      tempPassword: customTempPassword.trim(),
    })
  }

  const handleRejectSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!rejectingRequest) return
    rejectMutation.mutate({
      id: rejectingRequest.id,
      reason: rejectReason.trim(),
    })
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = search.toLowerCase()
      const matchesSearch =
        item.user.name.toLowerCase().includes(q) ||
        (item.user.userId && item.user.userId.toLowerCase().includes(q)) ||
        item.user.email.toLowerCase().includes(q)

      const matchesStatus =
        statusFilter === 'ALL' ? true : item.requestStatus === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [items, search, statusFilter])

  const copyCredentials = () => {
    const text = `FIXIT AI Password Reset Approved:\nTechnician: ${issuedResult.techName}\nUser ID: ${issuedResult.userId}\nTemporary Password: ${issuedResult.password}\n\nPlease sign in at ${window.location.origin}/login?role=technician and set your personal new password.`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const pendingCount = items.filter((i) => i.requestStatus === 'PENDING').length

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/owner/technicians"
              className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <KeyRound className="h-4 w-4" />
            </span>
            <h1 className="break-words text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
              Password Reset Requests
            </h1>
            {pendingCount > 0 && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {pendingCount} Pending
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Review technician recovery requests, issue temporary login credentials, or generate secure recovery links.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/owner/technicians">
            <Button variant="outline" size="sm" className="text-xs">
              <UserCheck className="h-3.5 w-3.5 mr-1.5" />
              Manage Technician Accounts
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="surface p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, ID, or email..."
            className="pl-12 text-xs"
          />
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Filter:</span>
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-xs dark:bg-slate-800/80">
            {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  statusFilter === s
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} title="Refresh requests">
            <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
          </Button>
        </div>
      </div>

      {/* Requests Table */}
      {isLoading ? (
        <div className="surface p-12">
          <LoadingState label="Loading password recovery requests..." />
        </div>
      ) : error ? (
        <div className="surface p-6 text-center text-xs text-rose-600">
          Failed to load requests: {errorMessage(error)}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="surface p-12 text-center space-y-3">
          <KeyRound className="mx-auto h-10 w-10 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            No Password Reset Requests
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {statusFilter !== 'ALL'
              ? `There are no requests with status "${statusFilter.toLowerCase()}".`
              : 'Technicians can request password recovery directly from the Technician Login page.'}
          </p>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 dark:bg-white/[0.02] border-b border-slate-200/80 dark:border-white/10 uppercase tracking-wider text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4">Technician</th>
                  <th className="py-3 px-4">User ID</th>
                  <th className="py-3 px-4">Request Date &amp; Time</th>
                  <th className="py-3 px-4">Notes / Reason</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-white/5">
                {filteredItems.map((item) => {
                  const isPending = item.requestStatus === 'PENDING'
                  const isApproved = item.requestStatus === 'APPROVED' || item.requestStatus === 'COMPLETED'
                  const isRejected = item.requestStatus === 'REJECTED'

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition"
                    >
                      {/* Technician Info */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                            {item.user.profileImageUrl ? (
                              <img
                                src={item.user.profileImageUrl}
                                alt={item.user.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="font-bold text-xs text-indigo-600">
                                {item.user.name[0]}
                              </span>
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white">
                              {item.user.name}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              {item.user.email}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* User ID */}
                      <td className="py-3 px-4">
                        <span className="font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-800 dark:text-slate-200">
                          {item.user.userId || '—'}
                        </span>
                      </td>

                      {/* Request Date */}
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 text-slate-400" />
                          <span>{new Date(item.requestDate).toLocaleString()}</span>
                        </div>
                      </td>

                      {/* Notes */}
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        <span className="italic line-clamp-1">
                          {item.notes || 'Password recovery requested'}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isPending
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                              : isApproved
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                          }`}
                        >
                          {isPending && <Clock className="h-2.5 w-2.5" />}
                          {isApproved && <CheckCircle2 className="h-2.5 w-2.5" />}
                          {isRejected && <XCircle className="h-2.5 w-2.5" />}
                          {item.requestStatus}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => openApprove(item)}
                            >
                              <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Approve &amp; Reset
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50"
                              onClick={() => {
                                setRejectingRequest(item)
                                setRejectReason('')
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : isApproved ? (
                          <span className="font-mono text-[11px] text-slate-500">
                            Temporary password issued
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Processed</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      <Dialog
        open={Boolean(approvingRequest)}
        onOpenChange={(open) => !open && setApprovingRequest(null)}
        title="Approve Password Reset"
        description="Issue a secure temporary password. The technician will be required to change it immediately after signing in."
      >
        {approvingRequest && (
          <form onSubmit={handleApproveSubmit} className="space-y-4 py-2">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs space-y-1">
              <p>
                <span className="text-slate-500">Technician:</span>{' '}
                <span className="font-bold text-slate-900 dark:text-white">
                  {approvingRequest.user.name}
                </span>
              </p>
              <p>
                <span className="text-slate-500">User ID:</span>{' '}
                <span className="font-mono font-semibold text-indigo-600">
                  {approvingRequest.user.userId || approvingRequest.user.email}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Requested At:</span>{' '}
                <span>{new Date(approvingRequest.requestDate).toLocaleString()}</span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Temporary Password to Issue:
              </label>
              <Input
                required
                value={customTempPassword}
                onChange={(e) => setCustomTempPassword(e.target.value)}
                placeholder="Temporary password..."
                className="font-mono text-sm"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                You can keep this auto-generated password or type your own.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
              <Button type="button" variant="outline" onClick={() => setApprovingRequest(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={approveMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                Approve &amp; Issue Password
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Reject Modal */}
      <Dialog
        open={Boolean(rejectingRequest)}
        onOpenChange={(open) => !open && setRejectingRequest(null)}
        title="Reject Password Reset Request"
        description="Provide an optional reason for denying this request."
      >
        {rejectingRequest && (
          <form onSubmit={handleRejectSubmit} className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Rejection Note / Reason:
              </label>
              <Input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Identity could not be verified, please see manager..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
              <Button type="button" variant="outline" onClick={() => setRejectingRequest(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={rejectMutation.isPending}
                className="bg-rose-600 hover:bg-rose-700 text-white"
              >
                Reject Request
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Success Dialog with Temporary Credentials */}
      <Dialog
        open={issuedResult.open}
        onOpenChange={(open) => !open && setIssuedResult((r) => ({ ...r, open: false }))}
        title="Temporary Password Generated"
        description="Provide this temporary password to the technician. Their old password has been invalidated."
      >
        <div className="space-y-4 py-2">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3 font-mono text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">Technician:</span>
              <span className="font-bold text-slate-900 dark:text-white font-sans">
                {issuedResult.techName}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">User ID:</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                {issuedResult.userId}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">Temporary Password:</span>
              <span className="font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 rounded border border-amber-200 dark:border-amber-800 text-sm">
                {issuedResult.password}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={copyCredentials} className="w-full text-xs">
              {copied ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Instructions
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIssuedResult((r) => ({ ...r, open: false }))}
              className="text-xs"
            >
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

