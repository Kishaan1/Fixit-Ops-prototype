import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  ChevronRight,
  Clock,
  Plus,
  Power,
  Shield,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react'
import { api, errorMessage, qs } from '../lib/api'
import { useToast } from '../lib/toast'
import { date, money, number, percent } from '../lib/format'
import type { DateRange, TechnicianPerformance } from '../lib/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonRows,
  StatCard,
} from '../components/ui'
import { Rating } from '../components/badges'

const PERIODS = [
  ['month', 'This month'],
  ['week', 'Last 7 days'],
  ['today', 'Today'],
  ['year', 'This year'],
  ['all', 'All time'],
]

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  specialization: '',
  incentiveRate: '10',
  password: '',
}

export default function Technicians() {
  const { success, error } = useToast()
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState('month')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)

  const performance = useQuery({
    queryKey: ['technicians', 'performance', period],
    queryFn: () =>
      api.get<{ items: TechnicianPerformance[]; range: DateRange }>(
        `/technicians/performance${qs({ period })}`,
      ),
  })

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/technicians', body),
    onSuccess: () => {
      success('Technician added', 'They can now sign in with the email and password you set.')
      setOpen(false)
      setForm(emptyForm)
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['technicians'] })
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const deactivate = useMutation({
    mutationFn: (tech: TechnicianPerformance) => api.delete(`/technicians/${tech.id}`),
    onSuccess: () => {
      success('Technician deactivated', 'Their open sessions were signed out.')
      void queryClient.invalidateQueries({ queryKey: ['technicians'] })
    },
    onError: (err) => error('Could not deactivate', errorMessage(err)),
  })

  const submit = () => {
    setFormError(null)
    if (form.name.trim().length < 2) return setFormError('Enter the technician name.')
    if (!form.email.includes('@')) return setFormError('Enter a valid email address.')
    if (form.password.length < 10) return setFormError('Use a password of at least 10 characters.')
    create.mutate({
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      specialization: form.specialization.trim(),
      incentiveRate: Number(form.incentiveRate) || 0,
      password: form.password,
    })
  }

  const items = performance.data?.items ?? []
  const active = items.filter((tech) => tech.active)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Team"
        title="Technicians"
        description="Workload, completion quality and net contribution for each technician. Figures are calculated server-side from recorded repairs, parts and incentives."
        actions={
          <>
            <Select value={period} onChange={(event) => setPeriod(event.target.value)} className="h-10 w-40">
              {PERIODS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Link to="/owner/technicians">
              <Button variant="outline" icon={Shield}>
                Account Management
              </Button>
            </Link>
            <Button icon={UserPlus} onClick={() => setOpen(true)}>
              Add technician
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active technicians"
          value={number(active.length)}
          hint={`${items.length} total accounts`}
          icon={Users}
          tone="indigo"
        />
        <StatCard
          label="Completed repairs"
          value={number(items.reduce((sum, tech) => sum + tech.completed, 0))}
          hint={performance.data ? `${date(performance.data.range.from)} – ${date(performance.data.range.to)}` : '—'}
          icon={BadgeCheck}
          tone="emerald"
        />
        <StatCard
          label="Pending workload"
          value={number(items.reduce((sum, tech) => sum + tech.pending, 0))}
          hint="Active repairs assigned"
          icon={Clock}
          tone="amber"
        />
        <StatCard
          label="Net contribution"
          value={money(items.reduce((sum, tech) => sum + tech.netContribution, 0))}
          hint="After parts, costs and incentives"
          icon={ShieldCheck}
          tone="violet"
        />
      </div>

      <Card padded={false}>
        {performance.isLoading ? (
          <SkeletonRows rows={5} />
        ) : performance.isError ? (
          <ErrorState
            message="Technician performance could not be loaded."
            onRetry={() => performance.refetch()}
          />
        ) : !items.length ? (
          <EmptyState
            icon={UserCog}
            title="No technicians yet"
            description="Add your first technician to assign repairs and track their contribution."
            action={
              <Button icon={UserPlus} onClick={() => setOpen(true)}>
                Add technician
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="border-b border-slate-200/80 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Technician</th>
                  <th className="px-4 py-3 text-center font-semibold">Assigned</th>
                  <th className="px-4 py-3 text-center font-semibold">Completed</th>
                  <th className="px-4 py-3 text-right font-semibold">Revenue</th>
                  <th className="px-4 py-3 text-right font-semibold">Parts cost</th>
                  <th className="px-4 py-3 text-right font-semibold">Incentives</th>
                  <th className="px-4 py-3 text-right font-semibold">Net contribution</th>
                  <th className="px-4 py-3 font-semibold">Quality</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {items.map((tech) => (
                  <tr key={tech.id} className="transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3.5">
                      <Link to={`/technicians/${tech.id}`} className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                          {tech.profileImageUrl ? (
                            <img src={tech.profileImageUrl} alt={tech.name} className="h-full w-full object-cover" />
                          ) : (
                            <Avatar name={tech.name} />
                          )}
                        </div>
                        <span>
                          <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                            {tech.name}
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400">
                              {tech.userId}
                            </span>
                            {!tech.active ? <Badge tone="red">Inactive</Badge> : null}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                            {tech.designation || tech.specialization || tech.email}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-center text-slate-700 dark:text-slate-300">
                      {tech.assigned}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {tech.completed}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        {tech.pending} pending
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-slate-800 dark:text-slate-200">
                      {money(tech.revenue)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-600 dark:text-slate-300">
                      {money(tech.partsCost)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-600 dark:text-slate-300">
                      {money(tech.incentives)}
                      <span className="block text-[11px] text-slate-400">
                        {percent(tech.incentiveRate)} rate
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {money(tech.netContribution)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Rating value={tech.avgRating} count={tech.feedbackCount} />
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {tech.avgCompletionDays === null
                          ? 'No completion data'
                          : `${tech.avgCompletionDays.toFixed(1)} days avg`}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/technicians/${tech.id}`}>
                          <Button variant="ghost" size="sm">
                            View <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        {tech.active ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Power}
                            className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                            onClick={() => deactivate.mutate(tech)}
                            loading={deactivate.isPending && deactivate.variables?.id === tech.id}
                            aria-label={`Deactivate ${tech.name}`}
                          >
                            Deactivate
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a technician"
        description="Creates a technician account. Share the initial password securely and ask them to change it later."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button icon={Plus} loading={create.isPending} onClick={submit}>
              Create account
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. Ravi Kumar"
              />
            </Field>
            <Field label="Email" required>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="name@shop.com"
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="Optional"
                inputMode="tel"
              />
            </Field>
            <Field label="Specialisation">
              <Input
                value={form.specialization}
                onChange={(event) => setForm({ ...form, specialization: event.target.value })}
                placeholder="e.g. iPhone board repair"
              />
            </Field>
            <Field label="Incentive rate (%)" hint="Used when calculating technician incentives on approved quotes.">
              <Input
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={form.incentiveRate}
                onChange={(event) => setForm({ ...form, incentiveRate: event.target.value })}
              />
            </Field>
            <Field label="Initial password" required hint="At least 10 characters.">
              <Input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                placeholder="Temporary password"
              />
            </Field>
          </div>
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
