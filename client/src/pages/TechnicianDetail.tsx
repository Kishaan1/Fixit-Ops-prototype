import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Calendar,
  ChevronRight,
  Clock,
  Edit3,
  IndianRupee,
  KeyRound,
  Mail,
  Phone,
  ShieldCheck,
  User,
  Wrench,
} from 'lucide-react'
import { api, errorMessage, qs } from '../lib/api'
import { useToast } from '../lib/toast'
import { date, money, number, percent } from '../lib/format'
import type { TechnicianDetailPerformance } from '../lib/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SectionTitle,
  Select,
  StatCard,
} from '../components/ui'
import { Rating, StatusBadge } from '../components/badges'
import { AvatarUpload } from '../components/AvatarUpload'

const PERIODS = [
  ['month', 'This month'],
  ['week', 'Last 7 days'],
  ['today', 'Today'],
  ['year', 'This year'],
  ['all', 'All time'],
]

export default function TechnicianDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { success, error } = useToast()
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState('month')
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    userId: '',
    email: '',
    phone: '',
    designation: '',
    specialization: '',
    incentiveRate: '10',
    profileImageUrl: null as string | null,
    active: true,
  })
  const [formError, setFormError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['technician', id, period],
    queryFn: () =>
      api.get<
        TechnicianDetailPerformance & {
          activityLogs?: Array<{
            id: string
            activityType: string
            activityDescription: string
            timestamp: string
            ip: string | null
          }>
        }
      >(`/technicians/${id}/performance${qs({ period })}`),
    enabled: Boolean(id),
  })

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/technicians/${id}`, body),
    onSuccess: () => {
      success('Technician details updated')
      setEditOpen(false)
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['technician', id] })
      void queryClient.invalidateQueries({ queryKey: ['technicians'] })
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const resetPassword = useMutation({
    mutationFn: () => api.post<{ ok: boolean; temporaryPassword: string }>(`/technicians/${id}/reset-password`, {}),
    onSuccess: (res) => {
      alert(`Temporary password generated for this technician: ${res.temporaryPassword}\n\nThe technician must change this password on next login.`)
      void queryClient.invalidateQueries({ queryKey: ['technician', id] })
    },
    onError: (err) => error(errorMessage(err)),
  })

  if (query.isLoading) return <LoadingState label="Loading technician…" />
  if (query.isError)
    return (
      <Card padded={false}>
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      </Card>
    )
  if (!query.data) return null

  const { technician, summary, repairs, range, activityLogs = [] } = query.data

  const openEdit = () => {
    setForm({
      name: technician.name,
      userId: technician.userId,
      email: technician.email,
      phone: technician.phone ?? '',
      designation: technician.designation ?? '',
      specialization: technician.specialization ?? '',
      incentiveRate: String(technician.incentiveRate),
      profileImageUrl: technician.profileImageUrl ?? null,
      active: technician.active,
    })
    setFormError(null)
    setEditOpen(true)
  }

  const submit = () => {
    setFormError(null)
    if (form.name.trim().length < 2) {
      setFormError('Enter the technician name.')
      return
    }
    update.mutate({
      name: form.name.trim(),
      userId: form.userId.trim() || undefined,
      email: form.email.trim(),
      phone: form.phone.trim(),
      designation: form.designation.trim(),
      specialization: form.specialization.trim(),
      incentiveRate: Number(form.incentiveRate) || 0,
      profileImageUrl: form.profileImageUrl,
      active: form.active,
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Technician Profile & Performance"
        title={technician.name}
        description={`${technician.designation || 'Technician'} · ${technician.specialization || 'General diagnostics'} · ${date(range.from)} – ${date(range.to)}`}
        actions={
          <>
            <Select value={period} onChange={(event) => setPeriod(event.target.value)} className="h-10 w-40">
              {PERIODS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button variant="outline" icon={ArrowLeft} onClick={() => navigate('/technicians')}>
              All technicians
            </Button>
            <Button
              variant="outline"
              icon={KeyRound}
              onClick={() => {
                if (confirm(`Reset password for ${technician.name}?`)) {
                  resetPassword.mutate()
                }
              }}
            >
              Reset Password
            </Button>
            <Button variant="outline" icon={Edit3} onClick={openEdit}>
              Edit Profile
            </Button>
          </>
        }
      />

      {/* Technician Identity Card */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#0d141d]">
        <div className="h-16 w-16 rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-xl font-bold">
          {technician.profileImageUrl ? (
            <img src={technician.profileImageUrl} alt={technician.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-indigo-600 dark:text-indigo-400">{technician.name[0]}</span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold text-slate-900 dark:text-white">{technician.name}</p>
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
              ID: {technician.userId}
            </span>
            <Badge tone={technician.active ? 'emerald' : 'red'} dot>
              {technician.active ? 'Active Account' : 'Inactive / Suspended'}
            </Badge>
            <Rating value={summary.avgRating} count={summary.feedbackCount} />
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> {technician.email}
            </span>
            {technician.phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> {technician.phone}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Joined:{' '}
              {technician.joiningDate ? new Date(technician.joiningDate).toLocaleDateString() : 'N/A'}
            </span>
            <span>Incentive: <strong className="text-emerald-600">{percent(technician.incentiveRate)}</strong></span>
          </div>
        </div>
      </div>

      {/* 8-Card Metric Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Repairs Assigned"
          value={number(summary.assigned)}
          hint={`${summary.completed} completed (${Math.round((summary.completed / (summary.assigned || 1)) * 100)}%)`}
          icon={Wrench}
          tone="indigo"
        />
        <StatCard
          label="Revenue Collected"
          value={money(summary.revenue)}
          hint={`Parts cost: ${money(summary.partsCost)}`}
          icon={IndianRupee}
          tone="emerald"
        />
        <StatCard
          label="Gross Shop Profit"
          value={money(summary.grossProfit)}
          hint="Revenue minus parts & direct costs"
          icon={ShieldCheck}
          tone="indigo"
        />
        <StatCard
          label="Net Contribution"
          value={money(summary.netContribution)}
          hint={`After ₹${summary.incentives.toLocaleString()} incentives`}
          icon={BadgeCheck}
          tone="emerald"
        />
      </div>

      {/* Repairs Table */}
      <Card padded={false}>
        <div className="p-5 sm:p-6">
          <SectionTitle
            title="Repairs in this period"
            description="Revenue is collected payments; parts cost is recorded purchase cost, not customer charge."
            icon={Clock}
          />
        </div>

        {!repairs.length ? (
          <EmptyState
            icon={Wrench}
            title="No repairs in this period"
            description="Try a wider date range or assign this technician to a repair."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-y border-slate-200/80 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Repair</th>
                  <th className="px-4 py-2.5 font-semibold">Customer</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Quote</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Revenue</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Parts cost</th>
                  <th className="px-4 py-2.5 font-semibold">Rating</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {repairs.map((repair) => (
                  <tr key={repair.id} className="transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3.5">
                      <Link
                        to={`/repairs/${repair.id}`}
                        className="font-semibold text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                      >
                        {repair.code}
                      </Link>
                      <p className="mt-0.5 max-w-56 truncate text-xs text-slate-500 dark:text-slate-400">
                        {repair.device}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">{repair.customer}</td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={repair.status} />
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-700 dark:text-slate-300">
                      {money(repair.quoteTotal)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-slate-800 dark:text-slate-200">
                      {money(repair.revenue)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-600 dark:text-slate-300">
                      {money(repair.partsCost)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Rating value={repair.rating} />
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Link to={`/repairs/${repair.id}`}>
                        <ChevronRight className="ml-auto h-4 w-4 text-slate-300 dark:text-slate-600" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Account Activity Audit Trail */}
      {activityLogs.length > 0 && (
        <Card padded={false}>
          <div className="p-5 sm:p-6 border-b border-slate-200 dark:border-white/10">
            <SectionTitle
              title="Technician Account Activity Trail"
              description="Chronological record of logins, password updates, and account status changes."
              icon={Activity}
            />
          </div>
          <div className="p-5 space-y-2">
            {activityLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between p-3 rounded-xl bg-slate-50/70 dark:bg-white/[0.02] border border-slate-200/70 dark:border-white/5 text-xs"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      {log.activityType.replace(/_/g, ' ')}
                    </p>
                    <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                      {log.activityDescription}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-[11px] text-slate-500">{new Date(log.timestamp).toLocaleString()}</p>
                  {log.ip && <p className="text-[10px] font-mono text-slate-400">IP: {log.ip}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Edit Technician Modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Technician Account"
        description="Update profile, user ID, contact info, or toggle account status."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button loading={update.isPending} onClick={submit}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
          <AvatarUpload
            name={form.name}
            currentUrl={form.profileImageUrl}
            onChange={(url) => setForm({ ...form, profileImageUrl: url })}
            label="Technician Profile Photo"
          />

          <Field label="Full Name" required>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="User ID" required>
              <Input
                value={form.userId}
                onChange={(event) => setForm({ ...form, userId: event.target.value.toUpperCase() })}
                className="font-mono uppercase"
              />
            </Field>
            <Field label="Email Address" required>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="Optional"
              />
            </Field>
            <Field label="Incentive Rate (%)">
              <Input
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={form.incentiveRate}
                onChange={(event) => setForm({ ...form, incentiveRate: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Designation">
              <Input
                value={form.designation}
                onChange={(event) => setForm({ ...form, designation: event.target.value })}
                placeholder="e.g. Diagnostic Lead"
              />
            </Field>
            <Field label="Specialization">
              <Input
                value={form.specialization}
                onChange={(event) => setForm({ ...form, specialization: event.target.value })}
                placeholder="e.g. Micro-soldering"
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-white/10">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm({ ...form, active: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                Account Active
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Inactive technicians cannot sign in to the application.
              </span>
            </span>
          </label>

          {formError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {formError}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
