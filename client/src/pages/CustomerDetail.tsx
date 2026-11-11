import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Edit3,
  IndianRupee,
  Mail,
  MapPin,
  Phone,
  Plus,
  Smartphone,
  StickyNote,
  Wrench,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useToast } from '../lib/toast'
import { date, money, number, relative } from '../lib/format'
import type { CustomerDetail as CustomerDetailType } from '../lib/types'
import {
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
  StatCard,
  Textarea,
} from '../components/ui'
import { StatusBadge } from '../components/badges'

export default function CustomerDetail() {
  const { id = '' } = useParams()
  const { success, error } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', notes: '' })
  const [formError, setFormError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerDetailType>(`/customers/${id}`),
    enabled: Boolean(id),
  })

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/customers/${id}`, body),
    onSuccess: () => {
      success('Customer updated')
      setEditOpen(false)
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['customer', id] })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  if (query.isLoading) return <LoadingState label="Opening customer…" />
  if (query.isError)
    return (
      <Card padded={false}>
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      </Card>
    )
  if (!query.data) return null

  const { customer, summary, repairs, scopeNote } = query.data

  const openEdit = () => {
    setForm({
      name: customer.name,
      phone: customer.phone,
      email: customer.email ?? '',
      address: customer.address ?? '',
      notes: customer.notes ?? '',
    })
    setFormError(null)
    setEditOpen(true)
  }

  const submit = () => {
    setFormError(null)
    if (form.name.trim().length < 2) {
      setFormError('Enter the customer name.')
      return
    }
    if (form.phone.trim().length < 7) {
      setFormError('Enter a valid phone number.')
      return
    }
    update.mutate({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer"
        title={customer.name}
        description={`Customer since ${date(customer.createdAt)}${customer.isDemo ? ' · demo record' : ''}`}
        actions={
          <>
            <Button variant="outline" icon={ArrowLeft} onClick={() => navigate('/customers')}>
              All customers
            </Button>
            <Button variant="outline" icon={Edit3} onClick={openEdit}>
              Edit details
            </Button>
            <Button icon={Plus} onClick={() => navigate('/repairs/new')}>
              New repair
            </Button>
          </>
        }
      />

      {scopeNote ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300">
          {scopeNote}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Visits"
          value={number(summary.visits)}
          hint={`${summary.completed} completed`}
          icon={Wrench}
          tone="indigo"
        />
        <StatCard
          label="Lifetime spend"
          value={money(summary.totalSpent)}
          hint="Payments collected"
          icon={IndianRupee}
          tone="emerald"
        />
        <StatCard
          label="Devices on file"
          value={number(summary.devices.length)}
          hint="Linked to this customer"
          icon={Smartphone}
          tone="violet"
        />
        <StatCard
          label="Last service"
          value={date(summary.lastServiceDate)}
          hint={summary.lastServiceDate ? relative(summary.lastServiceDate) : 'No repairs yet'}
          icon={CalendarClock}
          tone="amber"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_2fr]">
        <Card>
          <SectionTitle title="Contact details" icon={Phone} />
          <div className="mt-4 space-y-3 text-sm">
            <p className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              {customer.phone}
            </p>
            <p className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              {customer.email || <span className="text-slate-400">No email on file</span>}
            </p>
            <p className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              {customer.address || <span className="text-slate-400">No address on file</span>}
            </p>
            {customer.notes ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <StickyNote className="h-3.5 w-3.5" /> Notes
                </p>
                <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {customer.notes}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {summary.returning ? <Badge tone="emerald">Returning customer</Badge> : null}
              {customer.isDemo ? <Badge tone="amber">Demo data</Badge> : null}
            </div>
          </div>

          <div className="mt-5 border-t border-slate-200/80 pt-4 dark:border-white/10">
            <SectionTitle title="Devices" icon={Smartphone} />
            {summary.devices.length ? (
              <ul className="mt-3 space-y-2">
                {summary.devices.map((device) => (
                  <li
                    key={device.id ?? `${device.brand}-${device.model}`}
                    className="rounded-xl border border-slate-200 px-3 py-2.5 dark:border-white/10"
                  >
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {device.brand} {device.model}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {device.category}
                      {device.color ? ` · ${device.color}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-slate-400">No devices recorded yet.</p>
            )}
          </div>
        </Card>

        <Card padded={false}>
          <div className="p-5 sm:p-6">
            <SectionTitle
              title="Service history"
              description="Repairs, charges and the technician who handled each job."
              icon={Wrench}
            />
          </div>

          {!repairs.length ? (
            <EmptyState
              icon={Wrench}
              title="No repairs for this customer"
              description="Create a repair to start their service history."
              action={
                <Link to="/repairs/new">
                  <Button icon={Plus} size="sm">
                    New repair
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {repairs.map((repair) => (
                <Link
                  key={repair.id}
                  to={`/repairs/${repair.id}`}
                  className="flex items-start gap-4 px-5 py-4 transition hover:bg-slate-50 dark:hover:bg-white/[0.03] sm:px-6"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{repair.code}</p>
                      <StatusBadge status={repair.status} />
                    </div>
                    <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                      {repair.device.brand} {repair.device.model} · {repair.device.category}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                      {repair.problem}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span>{date(repair.createdAt)}</span>
                      <span>{repair.technicianName ?? 'Unassigned'}</span>
                      <span>Quote {money(repair.quoteTotal)}</span>
                      <span>Paid {money(repair.paymentTotal)}</span>
                      {repair.parts.length ? (
                        <span>
                          {repair.parts.reduce((sum, part) => sum + part.quantity, 0)} part
                          {repair.parts.reduce((sum, part) => sum + part.quantity, 0) === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit customer"
        description="Changes are recorded in the audit log."
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
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="Phone" required>
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                inputMode="tel"
              />
            </Field>
          </div>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="Optional"
            />
          </Field>
          <Field label="Address">
            <Input
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
              placeholder="Optional"
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Optional"
            />
          </Field>
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
