import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  FlaskConical,
  Globe,
  History,
  ImagePlus,
  IndianRupee,
  Info,
  ListChecks,
  Loader2,
  Package,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Store,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { date, dateTime, money, number, relative, toDateInput } from '../lib/format'
import type {
  AiStatus,
  Diagnostic,
  InventoryTransaction,
  MoneySummary,
  OnlinePartListing,
  Quotation,
  Repair,
  RepairDetailResponse,
  RepairImage,
  SparePart,
  Technician,
} from '../lib/types'
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
  SectionTitle,
  Select,
  Tabs,
  Textarea,
  cn,
} from '../components/ui'
import { PriorityBadge, QuoteStatusBadge, Rating, StatusBadge, STATUS_LABELS } from '../components/badges'
import { ImageDropzone, IMAGE_FORMATS_LABEL, MAX_IMAGE_MB } from '../components/ImageDropzone'

const PHASES = [
  { label: 'Intake', statuses: ['NEW_REQUEST', 'DEVICE_RECEIVED'] },
  { label: 'Diagnose', statuses: ['AI_DIAGNOSIS_COMPLETED', 'AWAITING_INSPECTION'] },
  {
    label: 'Quote',
    statuses: ['ESTIMATE_PREPARED', 'AWAITING_OWNER_APPROVAL', 'AWAITING_CUSTOMER_APPROVAL'],
  },
  { label: 'Repair', statuses: ['PARTS_ORDERED', 'REPAIR_IN_PROGRESS', 'QUALITY_CHECK'] },
  { label: 'Handover', statuses: ['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'] },
]

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const QUALITIES = ['OEM', 'Compatible', 'Refurbished', 'Used', 'Aftermarket']
const PRICE_SOURCES = ['MANUAL', 'VERIFIED_LISTING', 'OFFLINE_STORE', 'ESTIMATE']
const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK', 'OTHER']

function parseArray(value: string | null | undefined): unknown[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.name ?? record.title ?? record.label ?? JSON.stringify(value))
  }
  return ''
}

export default function RepairDetail() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const { success, error } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('overview')
  const [statusOpen, setStatusOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [partOpen, setPartOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)

  const query = useQuery({
    queryKey: ['repair', id],
    queryFn: () => api.get<RepairDetailResponse>(`/repairs/${id}`),
    enabled: Boolean(id),
  })

  const aiStatus = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<AiStatus>('/ai/status'),
  })

  const technicians = useQuery({
    queryKey: ['technicians'],
    queryFn: () => api.get<{ items: Technician[] }>('/technicians'),
    enabled: user?.role === 'OWNER',
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['repair', id] })
    void queryClient.invalidateQueries({ queryKey: ['repairs'] })
    void queryClient.invalidateQueries({ queryKey: ['reports'] })
    void queryClient.invalidateQueries({ queryKey: ['overview'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  const statusMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/repairs/${id}/status`, body),
    onSuccess: () => {
      success('Status updated', 'The repair timeline and customer report were refreshed.')
      setStatusOpen(false)
      refresh()
    },
    onError: (err) => error('Could not update status', errorMessage(err)),
  })

  const editMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/repairs/${id}`, body),
    onSuccess: () => {
      success('Repair details saved')
      setEditOpen(false)
      refresh()
    },
    onError: (err) => error('Could not save', errorMessage(err)),
  })

  const diagnoseMutation = useMutation({
    mutationFn: (mode: 'ai' | 'checklist') => api.post(`/repairs/${id}/diagnose`, { mode }),
    onSuccess: (_data, mode) => {
      success(mode === 'ai' ? 'AI research completed' : 'Checklist generated', 'Review the suggestions before acting on them.')
      refresh()
    },
    onError: (err) => error('Diagnosis failed', errorMessage(err)),
  })

  const addPart = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/repairs/${id}/parts`, body),
    onSuccess: () => {
      success('Part added', 'Stock levels were updated where an inventory part was used.')
      setPartOpen(false)
      refresh()
    },
    onError: (err) => error('Could not add part', errorMessage(err)),
  })

  const removePart = useMutation({
    mutationFn: (partId: string) => api.delete(`/repairs/${id}/parts/${partId}`),
    onSuccess: () => {
      success('Part removed', 'Inventory was restored if the part came from stock.')
      refresh()
    },
    onError: (err) => error('Could not remove part', errorMessage(err)),
  })

  const createQuote = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/repairs/${id}/quote`, body),
    onSuccess: () => {
      success('Quotation prepared', 'It now needs owner approval before the customer can decide.')
      setQuoteOpen(false)
      refresh()
    },
    onError: (err) => error('Could not prepare quote', errorMessage(err)),
  })

  const approveQuote = useMutation({
    mutationFn: (quoteId: string) => api.post(`/repairs/${id}/quotations/${quoteId}/approve`),
    onSuccess: () => {
      success('Quotation approved', 'Record the customer decision next.')
      refresh()
    },
    onError: (err) => error('Could not approve quote', errorMessage(err)),
  })

  const rejectQuote = useMutation({
    mutationFn: (quoteId: string) => api.post(`/repairs/${id}/quotations/${quoteId}/reject`, {}),
    onSuccess: () => {
      success('Quotation rejected', 'Revise the quote and resubmit.')
      refresh()
    },
    onError: (err) => error('Could not reject quote', errorMessage(err)),
  })

  const customerDecision = useMutation({
    mutationFn: (accepted: boolean) => api.post(`/repairs/${id}/quote/customer-decision`, { accepted }),
    onSuccess: (_data, accepted) => {
      success(accepted ? 'Customer accepted' : 'Customer declined')
      refresh()
    },
    onError: (err) => error('Could not record decision', errorMessage(err)),
  })

  const addPayment = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/repairs/${id}/payments`, body),
    onSuccess: () => {
      success('Payment recorded', 'The balance and audit trail were updated.')
      setPaymentOpen(false)
      refresh()
    },
    onError: (err) => error('Could not record payment', errorMessage(err)),
  })

  const publishReport = useMutation({
    mutationFn: (rotate: boolean) => api.post(`/repairs/${id}/report`, { rotateToken: rotate }),
    onSuccess: (_data, rotate) => {
      success(rotate ? 'New QR link created' : 'Service report published', 'Share the QR code or link with the customer.')
      refresh()
    },
    onError: (err) => error('Could not publish report', errorMessage(err)),
  })

  if (query.isLoading) return <LoadingState label="Opening repair…" />
  if (query.isError)
    return (
      <Card padded={false}>
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      </Card>
    )
  if (!query.data) return null

  const { repair, money: summary, allowedStatuses } = query.data
  const reportable = ['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'].includes(repair.status)
  const approvedQuote = repair.quotations.find((quote) => quote.status === 'APPROVED')
  const latestQuote = repair.quotations[0]
  const phaseIndex = PHASES.findIndex((phase) => phase.statuses.includes(repair.status))
  const isOwner = user?.role === 'OWNER'

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/r/${token}`
    try {
      await navigator.clipboard.writeText(url)
      success('Link copied', url)
    } catch {
      error('Copy failed', 'Select and copy the link manually.')
    }
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate('/repairs')}
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All repairs
      </button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
            <Wrench className="h-5 w-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{repair.code}</h1>
              <StatusBadge status={repair.status} />
              <PriorityBadge priority={repair.priority} />
              {repair.isDemo ? <Badge tone="slate">Demo record</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {repair.device.brand} {repair.device.model} · {repair.device.category} · received{' '}
              {date(repair.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={Pencil} onClick={() => setEditOpen(true)}>
            Edit details
          </Button>
          <Button icon={ClipboardCheck} onClick={() => setStatusOpen(true)}>
            Update status
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Quoted total" value={money(summary.quotedTotal)} icon={FileText} hint={approvedQuote ? `Approved v${approvedQuote.version}` : latestQuote ? `v${latestQuote.version} ${latestQuote.status.toLowerCase()}` : 'No quotation yet'} tone="indigo" />
        <SummaryTile label="Paid" value={money(summary.paidTotal)} icon={IndianRupee} hint={`${repair.payments.length} payment${repair.payments.length === 1 ? '' : 's'}`} tone="emerald" />
        <SummaryTile label="Balance" value={money(summary.balance)} icon={Banknote} hint={summary.balance > 0 ? 'Outstanding from customer' : 'Settled'} tone={summary.balance > 0 ? 'amber' : 'slate'} />
        <SummaryTile
          label={isOwner ? 'Workshop cost' : 'Parts charged'}
          value={money(isOwner ? summary.partsCost : summary.partsCharged)}
          icon={Package}
          hint={isOwner ? 'Internal — never shown publicly' : `${repair.parts.length} part line${repair.parts.length === 1 ? '' : 's'}`}
          tone="violet"
        />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          {PHASES.map((phase, index) => {
            const done = phaseIndex > index
            const current = phaseIndex === index
            return (
              <div key={phase.label} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    done
                      ? 'bg-emerald-500 text-white'
                      : current
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-400 dark:bg-white/10 dark:text-slate-500',
                  )}
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span
                  className={cn(
                    'text-xs font-semibold',
                    current
                      ? 'text-indigo-700 dark:text-indigo-300'
                      : done
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-400 dark:text-slate-500',
                  )}
                >
                  {phase.label}
                </span>
                {index < PHASES.length - 1 ? (
                  <span
                    className={cn(
                      'hidden h-px flex-1 sm:block',
                      done ? 'bg-emerald-300 dark:bg-emerald-500/40' : 'bg-slate-200 dark:bg-white/10',
                    )}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
        {repair.status === 'CANCELLED' ? (
          <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
            This repair was cancelled on {date(repair.cancelledAt)}.
          </div>
        ) : null}
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'diagnosis', label: 'Diagnosis', count: repair.diagnostics.length },
          { id: 'parts', label: 'Parts', count: repair.parts.length },
          { id: 'quote', label: 'Quotation', count: repair.quotations.length },
          { id: 'payments', label: 'Payments', count: repair.payments.length },
          { id: 'photos', label: 'Photos', count: repair.images?.length },
          { id: 'report', label: 'QR report', count: repair.report ? 1 : undefined },
          { id: 'activity', label: 'Activity', count: repair.activities.length },
        ]}
      />

      {tab === 'overview' ? (
        <OverviewTab
          repair={repair}
          summary={summary}
          onEdit={() => setEditOpen(true)}
          onTab={setTab}
          isOwner={isOwner}
        />
      ) : null}

      {tab === 'diagnosis' ? (
        <DiagnosisTab
          repair={repair}
          aiConfigured={Boolean(aiStatus.data?.configured)}
          onRun={(mode) => diagnoseMutation.mutate(mode)}
          running={diagnoseMutation.isPending}
        />
      ) : null}

      {tab === 'parts' ? (
        <PartsTab
          repair={repair}
          isOwner={isOwner}
          onAdd={() => setPartOpen(true)}
          onRemove={(partId) => removePart.mutate(partId)}
          removing={removePart.isPending}
        />
      ) : null}

      {tab === 'quote' ? (
        <QuoteTab
          repair={repair}
          summary={summary}
          isOwner={isOwner}
          onCreate={() => setQuoteOpen(true)}
          onApprove={(quoteId) => approveQuote.mutate(quoteId)}
          onReject={(quoteId) => rejectQuote.mutate(quoteId)}
          onDecision={(accepted) => customerDecision.mutate(accepted)}
          busy={approveQuote.isPending || rejectQuote.isPending || customerDecision.isPending}
        />
      ) : null}

      {tab === 'payments' ? (
        <PaymentsTab repair={repair} summary={summary} onAdd={() => setPaymentOpen(true)} />
      ) : null}

      {tab === 'photos' ? <PhotosTab repair={repair} onChanged={refresh} /> : null}

      {tab === 'report' ? (
        <ReportTab
          repair={repair}
          reportable={reportable}
          onPublish={() => publishReport.mutate(false)}
          onRotate={() => publishReport.mutate(true)}
          publishing={publishReport.isPending}
          onCopy={copyLink}
        />
      ) : null}

      {tab === 'activity' ? <ActivityTab repair={repair} /> : null}

      <StatusModal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        repair={repair}
        allowedStatuses={allowedStatuses}
        submitting={statusMutation.isPending}
        onSubmit={(body) => statusMutation.mutate(body)}
      />

      <EditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        repair={repair}
        isOwner={isOwner}
        technicians={technicians.data?.items ?? []}
        submitting={editMutation.isPending}
        onSubmit={(body) => editMutation.mutate(body)}
      />

      <AddPartModal
        open={partOpen}
        onClose={() => setPartOpen(false)}
        repair={repair}
        submitting={addPart.isPending}
        onSubmit={(body) => addPart.mutate(body)}
      />

      <PaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        summary={summary}
        submitting={addPayment.isPending}
        onSubmit={(body) => addPayment.mutate(body)}
      />

      <QuoteModal
        open={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        repair={repair}
        summary={summary}
        isOwner={isOwner}
        submitting={createQuote.isPending}
        onSubmit={(body) => createQuote.mutate(body)}
      />
    </div>
  )
}

/* ------------------------------ overview ------------------------------ */

function SummaryTile({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  hint: string
  icon: typeof FileText
  tone: 'indigo' | 'emerald' | 'amber' | 'violet' | 'slate'
}) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
    slate: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
  }
  return (
    <div className="surface flex items-center gap-4 p-4">
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tones[tone])}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-lg font-bold text-slate-900 dark:text-white">{value}</p>
        <p className="truncate text-[11px] text-slate-400">{hint}</p>
      </div>
    </div>
  )
}

function OverviewTab({
  repair,
  summary,
  onEdit,
  onTab,
  isOwner,
}: {
  repair: Repair
  summary: MoneySummary
  onEdit: () => void
  onTab: (tab: string) => void
  isOwner: boolean
}) {
  const approved = repair.quotations.find((quote) => quote.status === 'APPROVED')
  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        <Card>
          <SectionTitle
            title="Reported problem"
            description={`Received ${dateTime(repair.createdAt)} · ${repair.createdBy?.name ?? 'Front desk'}`}
            action={
              <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit}>
                Edit
              </Button>
            }
          />
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {repair.problem}
          </p>
        </Card>

        <Card>
          <SectionTitle
            title="Diagnosis & repair record"
            description="Only the details you record here appear on the customer report."
            icon={Stethoscope}
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <DetailBlock label="Confirmed fault" value={repair.confirmedFault} />
            <DetailBlock label="Repair procedure" value={repair.repairProcedure} />
            <DetailBlock label="Testing results" value={repair.testingResults} />
            <DetailBlock label="Final condition" value={repair.finalCondition} />
          </div>
          {repair.internalNotes ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-500/25 dark:bg-amber-500/[0.07]">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Internal notes — never public
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                {repair.internalNotes}
              </p>
            </div>
          ) : null}
        </Card>

        <Card>
          <SectionTitle title="Quote snapshot" description="Financial detail is calculated on the server." icon={FileText} />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Parts charged" value={money(summary.partsCharged)} />
            <MiniStat label="Customer total" value={money(summary.quotedTotal)} />
            <MiniStat label="Outstanding" value={money(summary.balance)} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onTab('quote')}>
              Open quotation
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onTab('parts')}>
              Manage parts
            </Button>
            {approved ? (
              <Badge tone="emerald" className="self-center">
                Approved quotation v{approved.version}
              </Badge>
            ) : (
              <Badge tone="amber" className="self-center">
                No approved quotation yet
              </Badge>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <SectionTitle title="Customer" icon={UserRound} />
          <div className="mt-4 flex items-start gap-3">
            <Avatar name={repair.customer.name} />
            <div>
              <Link
                to={`/customers/${repair.customer.id}`}
                className="font-semibold text-slate-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
              >
                {repair.customer.name}
              </Link>
              <p className="text-sm text-slate-500 dark:text-slate-400">{repair.customer.phone}</p>
              {repair.customer.email ? (
                <p className="text-xs text-slate-400">{repair.customer.email}</p>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <a href={`tel:${repair.customer.phone}`} className="flex-1">
              <Button variant="outline" size="sm" className="w-full">
                Call customer
              </Button>
            </a>
            <Link to={`/repairs/new`} className="flex-1">
              <Button variant="ghost" size="sm" className="w-full">
                New repair
              </Button>
            </Link>
          </div>
        </Card>

        <Card>
          <SectionTitle title="Device" icon={Wrench} />
          <dl className="mt-4 space-y-2.5 text-sm">
            <DetailRow label="Device" value={`${repair.device.brand} ${repair.device.model}`} />
            <DetailRow label="Category" value={repair.device.category} />
            <DetailRow label="Colour" value={repair.device.color || '—'} />
            <DetailRow label="Serial" value={repair.device.serialNumber || '—'} />
            <DetailRow label="IMEI" value={repair.device.imei || '—'} />
            <DetailRow label="Accessories" value={repair.device.accessories || '—'} />
          </dl>
          {repair.device.conditionNotes ? (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-white/[0.03] dark:text-slate-400">
              {repair.device.conditionNotes}
            </p>
          ) : null}
        </Card>

        <Card>
          <SectionTitle title="Assignment & warranty" icon={ShieldCheck} />
          <dl className="mt-4 space-y-2.5 text-sm">
            <DetailRow label="Technician" value={repair.technician?.user.name ?? 'Unassigned'} />
            <DetailRow label="Estimated completion" value={repair.estimatedCompletion ? date(repair.estimatedCompletion) : '—'} />
            <DetailRow label="Warranty" value={repair.warrantyDays ? `${repair.warrantyDays} days` : '—'} />
            <DetailRow label="Completed" value={repair.completedAt ? date(repair.completedAt) : '—'} />
            <DetailRow label="Delivered" value={repair.deliveredAt ? date(repair.deliveredAt) : '—'} />
            {isOwner ? <DetailRow label="Workshop cost" value={money(summary.partsCost)} /> : null}
          </dl>
          {repair.warrantyTerms ? (
            <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{repair.warrantyTerms}</p>
          ) : null}
          {repair.feedback ? (
            <div className="mt-4 rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Customer feedback</p>
                <Rating value={repair.feedback.rating} />
              </div>
              {repair.feedback.comment ? (
                <p className="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                  “{repair.feedback.comment}”
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  )
}

function DetailBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3.5 dark:border-white/10">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {value || <span className="text-slate-400">Not recorded</span>}
      </p>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-muted p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  )
}

/* ------------------------------ diagnosis ------------------------------ */

function DiagnosisTab({
  repair,
  aiConfigured,
  onRun,
  running,
}: {
  repair: Repair
  aiConfigured: boolean
  onRun: (mode: 'ai' | 'checklist') => void
  running: boolean
}) {
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle
            title="Diagnostic assistance"
            description="Use a generic offline checklist any time. AI web research investigates global community forums and manufacturer documentation."
            icon={BrainCircuit}
          />
          <Link to={`/diagnostics?repairId=${repair.id}`}>
            <Button size="sm" variant="outline" icon={ExternalLink}>
              Open Full Diagnostics Workbench
            </Button>
          </Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <ListChecks className="h-4 w-4 text-indigo-500" /> Offline checklist
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              A rule-based starting point using the device category and reported problem. No internet or
              AI provider needed. Generic guidance only.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              loading={running}
              onClick={() => onRun('checklist')}
            >
              Generate checklist
            </Button>
          </div>
          <div
            className={cn(
              'rounded-xl border p-4',
              aiConfigured
                ? 'border-violet-200 bg-violet-50/40 dark:border-violet-500/25 dark:bg-violet-500/[0.06]'
                : 'border-slate-200 bg-slate-50/60 dark:border-white/10 dark:bg-white/[0.02]',
            )}
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <Sparkles className={cn('h-4 w-4', aiConfigured ? 'text-violet-500' : 'text-slate-400')} />
              AI research
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {aiConfigured
                ? 'Gemini suggests likely causes and verification tests. Suggestions are unverified until you confirm them.'
                : 'AI is not configured on this server. Manual entry and the offline checklist remain fully available.'}
            </p>
            <Button
              size="sm"
              variant={aiConfigured ? 'primary' : 'outline'}
              className={cn('mt-3', aiConfigured && 'bg-violet-600 hover:bg-violet-500')}
              disabled={!aiConfigured}
              loading={running}
              onClick={() => onRun('ai')}
            >
              {aiConfigured ? 'Run AI research' : 'AI not configured'}
            </Button>
          </div>
        </div>
      </Card>

      {repair.diagnostics.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={Stethoscope}
            title="No diagnostics recorded"
            description="Generate an offline checklist to guide inspection, or run AI research if configured. You can always work from your own inspection."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {repair.diagnostics.map((diagnostic) => (
            <DiagnosticCard key={diagnostic.id} diagnostic={diagnostic} />
          ))}
        </div>
      )}
    </div>
  )
}

function DiagnosticCard({ diagnostic }: { diagnostic: Diagnostic }) {
  const causes = parseArray(diagnostic.causes)
  const tests = parseArray(diagnostic.tests)
  const parts = parseArray(diagnostic.parts)
  const sources = parseArray(diagnostic.sources)
  const isAi = diagnostic.mode === 'AI'
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl',
              isAi
                ? 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400'
                : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400',
            )}
          >
            {isAi ? <Sparkles className="h-4.5 w-4.5" /> : <ListChecks className="h-4.5 w-4.5" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {isAi ? 'AI research (unverified)' : 'Offline checklist'}
            </p>
            <p className="text-xs text-slate-400">
              {dateTime(diagnostic.createdAt)}
              {diagnostic.provider ? ` · ${diagnostic.provider}` : ''}
              {diagnostic.model ? ` ${diagnostic.model}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {diagnostic.confidence !== null ? (
            <Badge tone={diagnostic.confidence >= 70 ? 'amber' : 'slate'}>
              {Math.round(diagnostic.confidence * (diagnostic.confidence <= 1 ? 100 : 1))}% confidence
            </Badge>
          ) : null}
          {diagnostic.difficulty ? <Badge tone="slate">{diagnostic.difficulty}</Badge> : null}
          {diagnostic.estimatedMinutes ? <Badge tone="slate">{diagnostic.estimatedMinutes} min</Badge> : null}
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{diagnostic.summary}</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <DiagnosticList title="Possible causes" items={causes} tone="amber" />
        <DiagnosticList title="Tests to verify" items={tests} tone="indigo" />
        <DiagnosticList title="Parts to inspect" items={parts} tone="violet" />
      </div>

      {sources.length > 0 ? (
        <div className="mt-4 border-t border-slate-200/80 pt-3 dark:border-white/10">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sources</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {sources.map((source, index) => {
              const record = source as Record<string, unknown>
              const url = typeof record.url === 'string' ? record.url : ''
              const title = asText(source) || url
              return url ? (
                <a
                  key={`${url}-${index}`}
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15"
                >
                  {title.slice(0, 48)} <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span key={index} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-white/10 dark:text-slate-300">
                  {title}
                </span>
              )
            })}
          </div>
        </div>
      ) : null}

      {diagnostic.rawText ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400">
            View raw response
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-300">
            {diagnostic.rawText}
          </pre>
        </details>
      ) : null}
    </Card>
  )
}

function DiagnosticList({
  title,
  items,
  tone,
}: {
  title: string
  items: unknown[]
  tone: 'amber' | 'indigo' | 'violet'
}) {
  const colors = {
    amber: 'border-amber-200 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-500/[0.05]',
    indigo: 'border-indigo-200 bg-indigo-50/50 dark:border-indigo-500/20 dark:bg-indigo-500/[0.05]',
    violet: 'border-violet-200 bg-violet-50/50 dark:border-violet-500/20 dark:bg-violet-500/[0.05]',
  }
  return (
    <div className={cn('rounded-xl border p-3.5', colors[tone])}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-slate-400">None listed</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((item, index) => (
            <li key={index} className="flex gap-1.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
              <span>{asText(item)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------ parts ------------------------------ */

function PartsTab({
  repair,
  isOwner,
  onAdd,
  onRemove,
  removing,
}: {
  repair: Repair
  isOwner: boolean
  onAdd: () => void
  onRemove: (partId: string) => void
  removing: boolean
}) {
  const partsTotal = repair.parts.reduce((sum, part) => sum + part.unitPrice * part.quantity, 0)
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Parts used</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Inventory parts reduce stock automatically. Manual entries are clearly marked with their price
            source.
          </p>
        </div>
        <Button size="sm" icon={Plus} onClick={onAdd}>
          Add part
        </Button>
      </div>

      {repair.parts.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No parts added"
          description="Add a part from inventory or record a verified external purchase. Never guess a price without labelling it."
          action={
            <Button size="sm" icon={Plus} onClick={onAdd}>
              Add part
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-y border-slate-200/80 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Part</th>
                <th className="px-4 py-2.5 font-semibold">Source</th>
                <th className="px-4 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-4 py-2.5 text-right font-semibold">Unit price</th>
                {isOwner ? <th className="px-4 py-2.5 text-right font-semibold">Unit cost</th> : null}
                <th className="px-4 py-2.5 text-right font-semibold">Line</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {repair.parts.map((part) => (
                <tr key={part.id}>
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{part.name}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span>{part.quality}</span>
                      {part.supplierName ? (
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                          {part.priceSource === 'OFFLINE_STORE' ? (
                            <>
                              <Building2 className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                              Store: {part.supplierName}
                            </>
                          ) : (
                            <>
                              <Globe className="h-3 w-3 text-indigo-500" />
                              Supplier: {part.supplierName}
                            </>
                          )}
                        </span>
                      ) : null}
                    </div>
                    {part.sourceUrl ? (
                      <a
                        href={part.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        View online product page <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : part.priceSource === 'OFFLINE_STORE' && part.note ? (
                      <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300/90 font-normal">
                        {part.note}
                      </p>
                    ) : part.note ? (
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{part.note}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        tone={
                          part.priceSource === 'INVENTORY'
                            ? 'emerald'
                            : part.priceSource === 'OFFLINE_STORE'
                              ? 'amber'
                              : part.priceSource === 'VERIFIED_LISTING'
                                ? 'indigo'
                                : part.isEstimated
                                  ? 'amber'
                                  : 'slate'
                        }
                      >
                        {part.priceSource === 'OFFLINE_STORE'
                          ? 'Offline Store'
                          : part.priceSource === 'VERIFIED_LISTING'
                            ? 'Online Supplier'
                            : part.priceSource.replace('_', ' ')}
                      </Badge>
                      {part.isEstimated ? <Badge tone="amber">estimated</Badge> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right text-slate-700 dark:text-slate-300">{part.quantity}</td>
                  <td className="px-4 py-3.5 text-right text-slate-700 dark:text-slate-300">{money(part.unitPrice, true)}</td>
                  {isOwner ? (
                    <td className="px-4 py-3.5 text-right text-slate-500 dark:text-slate-400">{money(part.unitCost, true)}</td>
                  ) : null}
                  <td className="px-4 py-3.5 text-right font-semibold text-slate-900 dark:text-slate-100">
                    {money(part.unitPrice * part.quantity, true)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Remove ${part.name} from this repair?`)) onRemove(part.id)
                      }}
                      disabled={removing}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                      aria-label={`Remove ${part.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 dark:border-white/10">
              <tr>
                <td className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500" colSpan={isOwner ? 5 : 4}>
                  Parts charged to customer
                </td>
                <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">{money(partsTotal, true)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ------------------------------ quote ------------------------------ */

function QuoteTab({
  repair,
  summary,
  isOwner,
  onCreate,
  onApprove,
  onReject,
  onDecision,
  busy,
}: {
  repair: Repair
  summary: MoneySummary
  isOwner: boolean
  onCreate: () => void
  onApprove: (quoteId: string) => void
  onReject: (quoteId: string) => void
  onDecision: (accepted: boolean) => void
  busy: boolean
}) {
  const approved = repair.quotations.find((quote) => quote.status === 'APPROVED')
  const latest = repair.quotations[0]
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle
          title="Quotation"
          description="The server calculates totals, tax and profit. Each revision is versioned and audit-logged."
          icon={FileText}
          action={
            <Button size="sm" icon={Plus} onClick={onCreate}>
              Prepare quote
            </Button>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <MiniStat label="Parts at customer price" value={money(summary.partsCharged)} />
          <MiniStat label="Approved total" value={money(approved?.customerTotal ?? 0)} />
          <MiniStat label="Paid" value={money(summary.paidTotal)} />
          <MiniStat label="Balance" value={money(summary.balance)} />
        </div>
        {!isOwner ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
            Technician view: cost and profit figures stay hidden. Submit a quotation for owner approval;
            the owner records approval and the customer's decision.
          </p>
        ) : null}
      </Card>

      {repair.quotations.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={FileText}
            title="No quotation yet"
            description="Add parts first, then prepare a quotation with labour and any other expenses. The owner approves it before the customer decides."
            action={
              <Button size="sm" icon={Plus} onClick={onCreate}>
                Prepare quote
              </Button>
            }
          />
        </Card>
      ) : (
        repair.quotations.map((quote) => (
          <QuoteCard
            key={quote.id}
            quote={quote}
            isOwner={isOwner}
            isLatest={quote.id === latest?.id}
            busy={busy}
            onApprove={() => onApprove(quote.id)}
            onReject={() => onReject(quote.id)}
            onDecision={onDecision}
          />
        ))
      )}
    </div>
  )
}

function QuoteCard({
  quote,
  isOwner,
  isLatest,
  busy,
  onApprove,
  onReject,
  onDecision,
}: {
  quote: Quotation
  isOwner: boolean
  isLatest: boolean
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onDecision: (accepted: boolean) => void
}) {
  const canDecide = quote.status === 'APPROVED' && quote.customerDecision === 'PENDING'
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Version {quote.version}</h3>
            <QuoteStatusBadge status={quote.status} />
            {isLatest ? <Badge tone="slate">Latest</Badge> : null}
            {quote.customerDecision !== 'PENDING' ? (
              <Badge tone={quote.customerDecision === 'ACCEPTED' ? 'emerald' : 'red'}>
                Customer {quote.customerDecision.toLowerCase()}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Prepared {dateTime(quote.createdAt)}
            {quote.createdBy?.name ? ` by ${quote.createdBy.name}` : ''}
            {quote.approvedBy?.name ? ` · approved by ${quote.approvedBy.name}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Customer total</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{money(quote.customerTotal, true)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <QuoteRow label="Parts" value={money(quote.partsTotal, true)} />
        <QuoteRow label="Labour" value={money(quote.labourCharge, true)} />
        <QuoteRow label="Other expenses" value={money(quote.otherExpenses, true)} />
        <QuoteRow label="Discount" value={`− ${money(quote.discount, true)}`} />
        <QuoteRow label={`Tax (${quote.taxRate}%)`} value={money(quote.taxAmount, true)} />
        <QuoteRow label="Customer total" value={money(quote.customerTotal, true)} strong />
        {isOwner ? (
          <>
            <QuoteRow label="Parts cost" value={money(quote.actualPartsCost, true)} />
            <QuoteRow label="Net profit" value={money(quote.netProfit, true)} strong />
          </>
        ) : null}
      </div>

      {quote.notes ? (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-white/[0.03] dark:text-slate-400">
          {quote.notes}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-4 dark:border-white/10">
        {isOwner && quote.status !== 'APPROVED' && quote.status !== 'REJECTED' ? (
          <>
            <Button size="sm" variant="success" icon={CheckCircle2} loading={busy} onClick={onApprove}>
              Approve quotation
            </Button>
            <Button size="sm" variant="outline" icon={AlertTriangle} loading={busy} onClick={onReject}>
              Reject
            </Button>
          </>
        ) : null}
        {canDecide ? (
          <>
            <Button size="sm" variant="success" loading={busy} onClick={() => onDecision(true)}>
              Customer accepted
            </Button>
            <Button size="sm" variant="outline" loading={busy} onClick={() => onDecision(false)}>
              Customer declined
            </Button>
          </>
        ) : null}
        {quote.status === 'PENDING_OWNER' && !isOwner ? (
          <Badge tone="amber">Waiting for owner approval</Badge>
        ) : null}
        {quote.status === 'APPROVED' && quote.customerDecision === 'PENDING' ? (
          <Badge tone="indigo">Awaiting customer decision</Badge>
        ) : null}
        {quote.status === 'APPROVED' && quote.customerDecision !== 'PENDING' ? (
          <Badge tone="emerald">Decision recorded</Badge>
        ) : null}
      </div>
    </Card>
  )
}

function QuoteRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-lg px-3 py-2', strong ? 'bg-slate-100 dark:bg-white/[0.06]' : 'bg-slate-50/70 dark:bg-white/[0.02]')}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-sm', strong ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300')}>
        {value}
      </p>
    </div>
  )
}

/* ------------------------------ payments ------------------------------ */

const PHOTO_GROUPS = [
  {
    id: 'EVIDENCE' as const,
    label: 'Repair evidence',
    hint: 'Bench evidence, damage close-ups and diagnostic proof.',
    drop: 'repair evidence',
  },
  {
    id: 'BEFORE' as const,
    label: 'Before repair',
    hint: 'Device condition when it was handed over.',
    drop: 'before-repair photo',
  },
  {
    id: 'AFTER' as const,
    label: 'After repair',
    hint: 'Finished device ready for handover.',
    drop: 'after-repair photo',
  },
]

function PhotosTab({ repair, onChanged }: { repair: Repair; onChanged: () => void }) {
  const { success, error } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})

  const addPhoto = async (kind: RepairImage['kind'], file: File) => {
    const group = PHOTO_GROUPS.find((item) => item.id === kind)
    const localUrl = URL.createObjectURL(file)
    setPreviews((prev) => ({ ...prev, [kind]: localUrl }))
    setBusy(kind)
    try {
      const upload = await api.upload<{ filename: string; url: string }>('/uploads', file)
      await api.post(`/repairs/${repair.id}/images`, { imagePath: upload.filename, kind })
      success(
        `${group?.label ?? 'Repair'} photo added`,
        'The image is saved on this repair record.',
      )
      onChanged()
    } catch (err) {
      error('Photo upload failed', errorMessage(err))
    } finally {
      URL.revokeObjectURL(localUrl)
      setPreviews((prev) => {
        const next = { ...prev }
        delete next[kind]
        return next
      })
      setBusy(null)
    }
  }

  const removePhoto = async (image: RepairImage) => {
    try {
      await api.delete(`/repairs/${repair.id}/images/${image.id}`)
      success('Photo removed', 'The image was removed from this repair record.')
      onChanged()
    } catch (err) {
      error('Could not remove photo', errorMessage(err))
    }
  }

  const images = repair.images ?? []

  return (
    <Card>
      <div className="mb-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Repair photos</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Drag a photo straight into any box below, or click it to browse. Evidence, before and after
          photos are stored on this repair record and appear in the audit trail.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {PHOTO_GROUPS.map((group) => {
          const groupImages = images.filter((image) => image.kind === group.id)
          const preview = previews[group.id]
          const uploading = busy === group.id
          return (
            <div key={group.id} className="min-w-0 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{group.label}</h3>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    {group.hint}
                  </p>
                </div>
                <Badge tone={groupImages.length ? 'indigo' : 'slate'}>{groupImages.length}</Badge>
              </div>

              <ImageDropzone
                onFile={(file) => addPhoto(group.id, file)}
                onError={(message) => error('Image not accepted', message)}
                disabled={uploading}
                showError={false}
                overlayLabel={`Drop ${group.drop} here`}
                ariaLabel={`${group.label} upload. Drag and drop an image here, or click to browse.`}
                className="overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 transition dark:border-white/15 dark:bg-white/[0.03]"
              >
                {preview ? (
                  <div className="relative h-40 w-full">
                    <img src={preview} alt={`${group.label} preview`} className="h-full w-full object-cover" />
                    {uploading ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/55 text-white">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-[10px] font-semibold">Uploading…</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 px-3 py-7 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400">
                      {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                    </span>
                    <p className="text-xs font-semibold leading-snug text-slate-800 dark:text-slate-200">
                      {uploading ? 'Uploading photo…' : `Drag & Drop ${group.label} Here`}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Or{' '}
                      <span className="font-semibold text-indigo-600 underline dark:text-indigo-400">
                        Browse Files
                      </span>
                    </p>
                    <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                      {IMAGE_FORMATS_LABEL} · Maximum {MAX_IMAGE_MB} MB
                    </p>
                  </div>
                )}
              </ImageDropzone>

              {groupImages.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {groupImages.map((image) => (
                    <div
                      key={image.id}
                      className="group/img relative aspect-square overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-white/10"
                    >
                      <img
                        src={`/api/uploads/${image.imagePath}`}
                        alt={image.caption || group.label}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => void removePhoto(image)}
                        title="Remove photo"
                        aria-label={`Remove ${group.label} photo`}
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white opacity-0 shadow transition group-hover/img:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      {image.caption ? (
                        <p className="absolute inset-x-0 bottom-0 truncate bg-slate-950/60 px-1.5 py-0.5 text-[10px] text-white">
                          {image.caption}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function PaymentsTab({
  repair,
  summary,
  onAdd,
}: {
  repair: Repair
  summary: MoneySummary
  onAdd: () => void
}) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Payments</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Payments are checked against the approved quote on the server and written to the audit log.
          </p>
        </div>
        <Button size="sm" icon={Plus} onClick={onAdd} disabled={summary.balance <= 0}>
          Record payment
        </Button>
      </div>

      <div className="grid gap-3 px-5 pb-4 sm:grid-cols-3">
        <MiniStat label="Quoted total" value={money(summary.quotedTotal)} />
        <MiniStat label="Paid" value={money(summary.paidTotal)} />
        <MiniStat label="Balance" value={money(summary.balance)} />
      </div>

      {repair.payments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No payments recorded"
          description="Record a cash, UPI, card or bank payment against this repair."
          action={
            <Button size="sm" icon={Plus} onClick={onAdd} disabled={summary.balance <= 0}>
              Record payment
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-white/5">
          {repair.payments.map((payment) => (
            <div key={payment.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                <Banknote className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{money(payment.amount, true)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {payment.method}
                  {payment.reference ? ` · ${payment.reference}` : ''} · {dateTime(payment.paidAt)}
                  {payment.recordedBy?.name ? ` · ${payment.recordedBy.name}` : ''}
                </p>
                {payment.notes ? <p className="mt-0.5 text-xs text-slate-400">{payment.notes}</p> : null}
              </div>
              <Badge tone="emerald">Received</Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/* ------------------------------ report ------------------------------ */

function ReportTab({
  repair,
  reportable,
  onPublish,
  onRotate,
  publishing,
  onCopy,
}: {
  repair: Repair
  reportable: boolean
  onPublish: () => void
  onRotate: () => void
  publishing: boolean
  onCopy: (token: string) => void
}) {
  const token = repair.report?.token ?? repair.reportToken
  const url = token ? `/r/${token}` : null

  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
      <Card>
        <SectionTitle
          title="Customer QR service report"
          description="A hard-to-guess link showing only the customer-facing outcome and charges. Internal costs, margins and notes are never included."
          icon={QrCode}
        />
        {!reportable ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" /> Complete the repair first
            </p>
            <p className="mt-1 text-xs leading-relaxed">
              A report can be published once the repair is Completed, Ready for Pickup or Delivered. Move
              the status in the workflow, then return here.
            </p>
          </div>
        ) : token ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4 sm:flex-row dark:border-white/10">
              <div className="flex items-center justify-center rounded-xl bg-white p-2">
                <img
                  src={`/api/reports/${repair.id}/qr?size=320&v=${token}`}
                  alt="QR code for the customer service report"
                  className="h-36 w-36"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Public link</p>
                <p className="mt-1 break-all rounded-lg bg-slate-50 px-2.5 py-2 font-mono text-[11px] text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                  {url}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" icon={Copy} onClick={() => onCopy(token)}>
                    Copy link
                  </Button>
                  <a href={url ?? '#'} target="_blank" rel="noreferrer noopener">
                    <Button size="sm" variant="ghost" icon={ExternalLink}>
                      Open report
                    </Button>
                  </a>
                  <a href={`${url}?print=1`} target="_blank" rel="noreferrer noopener">
                    <Button size="sm" variant="outline" icon={Printer}>
                      Print / PDF
                    </Button>
                  </a>
                </div>

                {/* Direct Customer Notification & Dispatch Channels */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/5 space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Customer Dispatch Integrations:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {repair.customer.phone && (
                      <>
                        <a
                          href={`https://wa.me/${repair.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                            `Hello ${repair.customer.name}, your ${repair.device.brand} ${repair.device.model} (${repair.code}) repair at FIXIT AI Repair Lab is complete. View your service report, warranty and invoice here: ${window.location.origin}/r/${token}`,
                          )}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                        >
                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          WhatsApp Report
                        </a>
                        <a
                          href={`sms:${repair.customer.phone.replace(/\D/g, '')}?body=${encodeURIComponent(
                            `FIXIT AI: Your ${repair.device.brand} ${repair.device.model} is ready for pickup. Service Report: ${window.location.origin}/r/${token}`,
                          )}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
                        >
                          SMS Notice
                        </a>
                      </>
                    )}
                    {repair.customer.email && (
                      <a
                        href={`mailto:${repair.customer.email}?subject=${encodeURIComponent(
                          `FIXIT AI Service Report: ${repair.device.brand} ${repair.device.model} (${repair.code})`,
                        )}&body=${encodeURIComponent(
                          `Dear ${repair.customer.name},\n\nYour device service at FIXIT AI Repair Lab has been completed.\n\nRepair Code: ${repair.code}\nDevice: ${repair.device.brand} ${repair.device.model}\n\nPlease review your complete QR service report and warranty documentation:\n${window.location.origin}/r/${token}\n\nThank you for choosing FIXIT AI!`,
                        )}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
                      >
                        Email Invoice
                      </a>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-[11px] text-slate-400">
                  Published {dateTime(repair.report?.publishedAt ?? repair.reportPublishedAt)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={RefreshCw} loading={publishing} onClick={onPublish}>
                Refresh report snapshot
              </Button>
              <Button size="sm" variant="outline" icon={RefreshCw} loading={publishing} onClick={onRotate}>
                Replace link (rotate token)
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Refreshing updates the snapshot with the latest charges and status. Rotating invalidates the
              old link immediately — use it only if a link was shared incorrectly.
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No report has been published yet. Generate a secure link and QR code for the customer.
            </p>
            <Button className="mt-3" icon={QrCode} loading={publishing} onClick={onPublish}>
              Publish service report
            </Button>
          </div>
        )}
      </Card>

      <div className="space-y-5">
        <Card>
          <SectionTitle title="What the customer sees" icon={ShieldCheck} />
          <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
            {[
              'Shop name, phone, email and address',
              'Repair code, status, reported problem and confirmed fault',
              'Repair procedure, testing results and technician name',
              'Parts replaced with customer-facing prices',
              'Charges, payments made and outstanding balance',
              'Warranty period and terms',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-500/25 dark:bg-rose-500/[0.06]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">
              Never included
            </p>
            <p className="mt-1 text-xs leading-relaxed text-rose-800/80 dark:text-rose-200/80">
              Parts cost, net profit, technician incentives, internal notes, customer phone/address and
              device IMEI.
            </p>
          </div>
        </Card>

        <Card>
          <SectionTitle title="Feedback" icon={BadgeCheck} />
          {repair.feedback ? (
            <div className="mt-3">
              <Rating value={repair.feedback.rating} />
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {repair.feedback.comment ? `“${repair.feedback.comment}”` : 'No comment left.'}
              </p>
              <p className="mt-1 text-xs text-slate-400">{dateTime(repair.feedback.createdAt)}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              The customer can rate the service from the public report. Feedback appears here and in the
              owner's notifications.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------ activity ------------------------------ */

function ActivityTab({ repair }: { repair: Repair }) {
  return (
    <Card>
      <SectionTitle title="Activity timeline" description="Every status change, quote, part, payment and report event." icon={History} />
      {repair.activities.length === 0 ? (
        <EmptyState icon={History} title="No activity yet" />
      ) : (
        <ol className="mt-5 space-y-0">
          {repair.activities.map((activity, index) => {
            const Icon =
              activity.type === 'STATUS'
                ? ClipboardCheck
                : activity.type === 'DIAGNOSIS'
                  ? Stethoscope
                  : activity.type === 'PART'
                    ? Package
                    : activity.type === 'QUOTE'
                      ? FileText
                      : activity.type === 'PAYMENT'
                        ? Banknote
                        : activity.type === 'REPORT'
                          ? QrCode
                          : History
            return (
              <li key={activity.id} className="relative flex gap-3 pb-5 last:pb-0">
                {index < repair.activities.length - 1 ? (
                  <span className="absolute left-[15px] top-8 h-full w-px bg-slate-200 dark:bg-white/10" />
                ) : null}
                <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm text-slate-700 dark:text-slate-300">{activity.note}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {activity.user?.name ?? 'System'} · {dateTime(activity.createdAt)}
                  </p>
                </div>
                <Badge tone="slate">{activity.type}</Badge>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

/* ------------------------------ modals ------------------------------ */

function StatusModal({
  open,
  onClose,
  repair,
  allowedStatuses,
  submitting,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  repair: Repair
  allowedStatuses: string[]
  submitting: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [repairProcedure, setRepairProcedure] = useState(repair.repairProcedure ?? '')
  const [testingResults, setTestingResults] = useState(repair.testingResults ?? '')
  const [warrantyDays, setWarrantyDays] = useState(String(repair.warrantyDays || 0))
  const [warrantyTerms, setWarrantyTerms] = useState(repair.warrantyTerms ?? '')

  const needsCompletion = ['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'].includes(status)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update repair status"
      description="Allowed next steps depend on your role and the current stage."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            disabled={!status}
            onClick={() => {
              if (!status) return
              onSubmit({
                status,
                note: note.trim() || undefined,
                ...(needsCompletion && repairProcedure ? { repairProcedure } : {}),
                ...(needsCompletion && testingResults ? { testingResults } : {}),
                ...(needsCompletion ? { warrantyDays: Number(warrantyDays) || 0 } : {}),
                ...(needsCompletion && warrantyTerms ? { warrantyTerms } : {}),
              })
            }}
          >
            Update status
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="New status" required>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Choose the next status</option>
            {allowedStatuses.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value] ?? value}
              </option>
            ))}
          </Select>
        </Field>

        {needsCompletion ? (
          <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 dark:border-emerald-500/25 dark:bg-emerald-500/[0.06]">
            <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              Completion details for the customer report
            </p>
            <Field label="Repair procedure">
              <Textarea
                value={repairProcedure}
                onChange={(event) => setRepairProcedure(event.target.value)}
                placeholder="What did you replace or repair?"
                className="min-h-20"
              />
            </Field>
            <Field label="Testing results">
              <Textarea
                value={testingResults}
                onChange={(event) => setTestingResults(event.target.value)}
                placeholder="What did you test, and what passed?"
                className="min-h-20"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Warranty days">
                <Input
                  type="number"
                  min={0}
                  max={3650}
                  value={warrantyDays}
                  onChange={(event) => setWarrantyDays(event.target.value)}
                />
              </Field>
              <Field label="Warranty terms">
                <Input
                  value={warrantyTerms}
                  onChange={(event) => setWarrantyTerms(event.target.value)}
                  placeholder="Optional summary"
                />
              </Field>
            </div>
          </div>
        ) : null}

        <Field label="Note" hint="Visible in the internal activity timeline.">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note for the team"
            className="min-h-20"
          />
        </Field>
      </div>
    </Modal>
  )
}

function EditModal({
  open,
  onClose,
  repair,
  isOwner,
  technicians,
  submitting,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  repair: Repair
  isOwner: boolean
  technicians: Technician[]
  submitting: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [form, setForm] = useState({
    problem: repair.problem,
    priority: repair.priority,
    internalNotes: repair.internalNotes ?? '',
    confirmedFault: repair.confirmedFault ?? '',
    repairProcedure: repair.repairProcedure ?? '',
    testingResults: repair.testingResults ?? '',
    finalCondition: repair.finalCondition ?? '',
    warrantyDays: String(repair.warrantyDays || 0),
    warrantyTerms: repair.warrantyTerms ?? '',
    estimatedCompletion: toDateInput(repair.estimatedCompletion),
    technicianId: repair.technicianId ?? '',
  })

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit repair details"
      description="These details are used in quotes and the customer report. Internal notes stay private."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            onClick={() =>
              onSubmit({
                problem: form.problem,
                priority: form.priority,
                internalNotes: form.internalNotes,
                confirmedFault: form.confirmedFault,
                repairProcedure: form.repairProcedure,
                testingResults: form.testingResults,
                finalCondition: form.finalCondition,
                warrantyDays: Number(form.warrantyDays) || 0,
                warrantyTerms: form.warrantyTerms,
                estimatedCompletion: form.estimatedCompletion
                  ? new Date(form.estimatedCompletion).toISOString()
                  : '',
                ...(isOwner ? { technicianId: form.technicianId || null } : {}),
              })
            }
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Reported problem" required>
          <Textarea value={form.problem} onChange={(event) => set('problem', event.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Priority">
            <Select value={form.priority} onChange={(event) => set('priority', event.target.value)}>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estimated completion">
            <Input
              type="datetime-local"
              value={form.estimatedCompletion}
              onChange={(event) => set('estimatedCompletion', event.target.value)}
            />
          </Field>
        </div>
        {isOwner ? (
          <Field label="Assigned technician">
            <Select value={form.technicianId} onChange={(event) => set('technicianId', event.target.value)}>
              <option value="">Unassigned</option>
              {technicians
                .filter((tech) => tech.active)
                .map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.name}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Confirmed fault">
            <Textarea
              value={form.confirmedFault}
              onChange={(event) => set('confirmedFault', event.target.value)}
              className="min-h-20"
            />
          </Field>
          <Field label="Repair procedure">
            <Textarea
              value={form.repairProcedure}
              onChange={(event) => set('repairProcedure', event.target.value)}
              className="min-h-20"
            />
          </Field>
          <Field label="Testing results">
            <Textarea
              value={form.testingResults}
              onChange={(event) => set('testingResults', event.target.value)}
              className="min-h-20"
            />
          </Field>
          <Field label="Final condition">
            <Textarea
              value={form.finalCondition}
              onChange={(event) => set('finalCondition', event.target.value)}
              className="min-h-20"
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Warranty days">
            <Input
              type="number"
              min={0}
              max={3650}
              value={form.warrantyDays}
              onChange={(event) => set('warrantyDays', event.target.value)}
            />
          </Field>
          <Field label="Warranty terms">
            <Input
              value={form.warrantyTerms}
              onChange={(event) => set('warrantyTerms', event.target.value)}
              placeholder="What the warranty covers"
            />
          </Field>
        </div>
        <Field label="Internal notes" hint="Never shown to the customer.">
          <Textarea
            value={form.internalNotes}
            onChange={(event) => set('internalNotes', event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}

function AddPartModal({
  open,
  onClose,
  repair,
  submitting,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  repair: Repair
  submitting: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const { error } = useToast()
  const [mode, setMode] = useState<'online' | 'offline' | 'inventory'>('online')
  const [onlineType, setOnlineType] = useState<'catalog' | 'custom'>('catalog')
  const [sparePartId, setSparePartId] = useState('')
  const [onlineQuery, setOnlineQuery] = useState(`${repair.device.brand} ${repair.device.model}`.trim())
  const [selectedOnlineListing, setSelectedOnlineListing] = useState<OnlinePartListing | null>(null)

  // Custom Online Purchasing Form (Requires URL link)
  const [onlineForm, setOnlineForm] = useState({
    name: '',
    quality: 'Compatible',
    supplierName: '',
    sourceUrl: '',
    unitPrice: '',
    unitCost: '',
    quantity: '1',
    note: '',
  })

  // Offline Store Purchasing Form (Requires Shop Name & Store Details, NO URL link)
  const [offlineForm, setOfflineForm] = useState({
    name: '',
    shopName: '',
    shopAddress: '',
    shopPhone: '',
    billNumber: '',
    warranty: '7 Days Testing Warranty',
    quality: 'Compatible',
    unitCost: '',
    unitPrice: '',
    quantity: '1',
    note: '',
  })

  // From Stock Form
  const [stockForm, setStockForm] = useState({
    quantity: '1',
    unitPrice: '',
    note: '',
  })

  const catalog = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: () => api.get<{ items: SparePart[] }>('/parts/catalog'),
    enabled: open && mode === 'inventory',
  })

  const onlineListings = useQuery({
    queryKey: ['online-parts-modal', onlineQuery],
    queryFn: () =>
      api.get<{ items: OnlinePartListing[] }>(`/parts/search-online?q=${encodeURIComponent(onlineQuery)}`),
    enabled: open && mode === 'online' && onlineType === 'catalog',
  })

  const selected = catalog.data?.items.find((part) => part.id === sparePartId)

  const handleSelectOnlinePart = (listing: OnlinePartListing) => {
    setSelectedOnlineListing(listing)
    setOnlineForm((prev) => ({
      ...prev,
      name: listing.name,
      quality: listing.quality,
      supplierName: listing.supplierName,
      sourceUrl: listing.sourceUrl,
      unitCost: String(listing.totalLandedPrice),
      unitPrice: String(Math.round(listing.totalLandedPrice * 1.35)),
    }))
  }

  const handleFormSubmit = () => {
    if (mode === 'inventory') {
      if (!sparePartId) {
        error('Choose a part', 'Select an inventory item first.')
        return
      }
      onSubmit({
        sparePartId,
        quantity: Number(stockForm.quantity) || 1,
        unitPrice: Number(stockForm.unitPrice) || selected?.sellingPrice || 0,
        note: stockForm.note || undefined,
      })
    } else if (mode === 'online') {
      if (onlineType === 'catalog') {
        if (!selectedOnlineListing) {
          error('Select a part', 'Search and select an online part from the distributor feed.')
          return
        }
        onSubmit({
          name: selectedOnlineListing.name,
          quality: selectedOnlineListing.quality,
          supplierName: selectedOnlineListing.supplierName,
          sourceUrl: selectedOnlineListing.sourceUrl, // Required URL
          priceSource: 'VERIFIED_LISTING',
          unitPrice: Number(onlineForm.unitPrice) || Math.round(selectedOnlineListing.totalLandedPrice * 1.35),
          unitCost: Number(onlineForm.unitCost) || selectedOnlineListing.totalLandedPrice,
          quantity: Number(onlineForm.quantity) || 1,
          note: onlineForm.note || `Online order via ${selectedOnlineListing.supplierName} (${selectedOnlineListing.warranty})`,
        })
      } else {
        // Custom Online Entry
        if (!onlineForm.name.trim()) {
          error('Enter part name', 'Please enter the spare part name.')
          return
        }
        if (!onlineForm.sourceUrl.trim()) {
          error('URL link required', 'Online purchasing requires a product URL link (e.g. https://...).')
          return
        }
        try {
          new URL(onlineForm.sourceUrl.trim())
        } catch {
          error('Invalid URL', 'Please enter a valid URL starting with http:// or https://')
          return
        }
        onSubmit({
          name: onlineForm.name.trim(),
          quality: onlineForm.quality,
          supplierName: onlineForm.supplierName.trim() || 'Online Supplier',
          sourceUrl: onlineForm.sourceUrl.trim(), // Required URL
          priceSource: 'VERIFIED_LISTING',
          unitPrice: Number(onlineForm.unitPrice) || 0,
          unitCost: Number(onlineForm.unitCost) || 0,
          quantity: Number(onlineForm.quantity) || 1,
          note: onlineForm.note.trim() || undefined,
        })
      }
    } else if (mode === 'offline') {
      // Offline Local Store Entry - Shop Name required, NO URL LINK required
      if (!offlineForm.name.trim()) {
        error('Enter part name', 'Please enter the spare part name.')
        return
      }
      if (!offlineForm.shopName.trim()) {
        error('Shop name required', 'Offline purchasing requires the local shop or store name.')
        return
      }
      const noteDetails = [
        `Local Store: ${offlineForm.shopName.trim()}`,
        offlineForm.shopAddress.trim() ? `Loc: ${offlineForm.shopAddress.trim()}` : '',
        offlineForm.billNumber.trim() ? `Bill/Receipt #: ${offlineForm.billNumber.trim()}` : '',
        offlineForm.shopPhone.trim() ? `Ph: ${offlineForm.shopPhone.trim()}` : '',
        offlineForm.warranty.trim() ? `Warranty: ${offlineForm.warranty.trim()}` : '',
        offlineForm.note.trim(),
      ]
        .filter(Boolean)
        .join(' · ')

      onSubmit({
        name: offlineForm.name.trim(),
        quality: offlineForm.quality,
        supplierName: offlineForm.shopName.trim(), // Physical store name
        sourceUrl: undefined, // NO URL LINK FOR OFFLINE PURCHASES
        priceSource: 'OFFLINE_STORE',
        unitPrice: Number(offlineForm.unitPrice) || 0,
        unitCost: Number(offlineForm.unitCost) || 0,
        quantity: Number(offlineForm.quantity) || 1,
        note: noteDetails,
      })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Spare Part"
      description={`Add a part for ${repair.device.brand} ${repair.device.model} through online suppliers, offline stores, or shop inventory.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={submitting} onClick={handleFormSubmit}>
            Add part
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Main 3 Procurement Mode Tabs */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setMode('online')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition cursor-pointer',
              mode === 'online'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-300 shadow-xs'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400',
            )}
          >
            <Globe className="h-3.5 w-3.5 text-indigo-500" />
            Online Purchasing
          </button>
          <button
            type="button"
            onClick={() => setMode('offline')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition cursor-pointer',
              mode === 'offline'
                ? 'border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-300 shadow-xs'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400',
            )}
          >
            <Store className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            Offline Store Purchasing
          </button>
          <button
            type="button"
            onClick={() => setMode('inventory')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition cursor-pointer',
              mode === 'inventory'
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:text-emerald-300 shadow-xs'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400',
            )}
          >
            <Package className="h-3.5 w-3.5 text-emerald-500" />
            From Stock
          </button>
        </div>

        {/* 1. ONLINE PURCHASING (Needs URL Link) */}
        {mode === 'online' ? (
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-xs text-indigo-900 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Globe className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <span>
                <strong>Online Purchasing:</strong> Requires a product URL link from verified distributors (MobilesSentrix, Injured Gadgets, iFixit, Sunsky, OEM Direct, Amazon) for price audit and order tracking.
              </span>
            </div>

            <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-white/10">
              <button
                type="button"
                onClick={() => setOnlineType('catalog')}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer',
                  onlineType === 'catalog'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5',
                )}
              >
                Search Verified Suppliers
              </button>
              <button
                type="button"
                onClick={() => setOnlineType('custom')}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer',
                  onlineType === 'custom'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5',
                )}
              >
                Custom Online Order (with URL)
              </button>
            </div>

            {onlineType === 'catalog' ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute top-1/2 left-3 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={onlineQuery}
                    onChange={(e) => setOnlineQuery(e.target.value)}
                    placeholder="Search part or model name..."
                    className="pl-12 text-xs"
                  />
                </div>

                <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                  {onlineListings.isLoading ? (
                    <div className="py-6 text-center text-xs text-slate-400">Searching online distributor databases…</div>
                  ) : onlineListings.data?.items.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      No distributor feeds found for "{onlineQuery}". Switch to "Custom Online Order" or "Offline Store Purchasing".
                    </div>
                  ) : (
                    onlineListings.data?.items.map((listing) => {
                      const isSelected = selectedOnlineListing?.id === listing.id
                      return (
                        <div
                          key={listing.id}
                          onClick={() => handleSelectOnlinePart(listing)}
                          className={cn(
                            'flex items-center justify-between rounded-xl border p-2.5 text-xs transition cursor-pointer',
                            isSelected
                              ? 'border-indigo-500 bg-indigo-50/70 dark:border-indigo-500/40 dark:bg-indigo-500/15'
                              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/[0.03]',
                          )}
                        >
                          <div className="min-w-0 flex-1 pr-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900 dark:text-white line-clamp-1">
                                {listing.name}
                              </span>
                              <Badge tone="indigo">{listing.quality}</Badge>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {listing.supplierName} • {listing.warranty}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <p className="font-bold text-slate-900 dark:text-white">
                              {money(listing.totalLandedPrice, true)}
                            </p>
                            <span className="text-[10px] text-slate-400">landed price</span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {selectedOnlineListing && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-xs dark:border-indigo-500/20 dark:bg-indigo-500/10 space-y-2.5">
                    <div className="flex justify-between items-center font-semibold text-indigo-900 dark:text-indigo-200">
                      <span className="line-clamp-1">Selected: {selectedOnlineListing.name}</span>
                      <span className="shrink-0">Landed Cost: {money(selectedOnlineListing.totalLandedPrice, true)}</span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1">
                      <ExternalLink className="h-3 w-3 text-indigo-500 shrink-0" />
                      <a href={selectedOnlineListing.sourceUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 underline truncate">
                        {selectedOnlineListing.sourceUrl}
                      </a>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Quantity" required>
                        <Input
                          type="number"
                          min={1}
                          value={onlineForm.quantity}
                          onChange={(e) => setOnlineForm((f) => ({ ...f, quantity: e.target.value }))}
                        />
                      </Field>
                      <Field label="Quote to customer (₹)" required hint="Suggested: 35% margin">
                        <Input
                          type="number"
                          value={onlineForm.unitPrice}
                          onChange={(e) => setOnlineForm((f) => ({ ...f, unitPrice: e.target.value }))}
                        />
                      </Field>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Custom Online Order Form with Mandatory URL */
              <div className="space-y-3">
                <Field label="Part title / component name" required>
                  <Input
                    value={onlineForm.name}
                    onChange={(e) => setOnlineForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. iPhone 14 Pro Max OLED Display Assembly"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Online supplier / platform" required>
                    <Input
                      value={onlineForm.supplierName}
                      onChange={(e) => setOnlineForm((f) => ({ ...f, supplierName: e.target.value }))}
                      placeholder="e.g. MobilesSentrix, iFixit, Amazon"
                    />
                  </Field>
                  <Field label="Quality grade">
                    <Select
                      value={onlineForm.quality}
                      onChange={(e) => setOnlineForm((f) => ({ ...f, quality: e.target.value }))}
                    >
                      {QUALITIES.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Field
                  label="Product URL link (Required)"
                  required
                  hint="Must start with https:// or http:// for price verification."
                >
                  <div className="relative">
                    <Globe className="absolute top-1/2 left-3 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      value={onlineForm.sourceUrl}
                      onChange={(e) => setOnlineForm((f) => ({ ...f, sourceUrl: e.target.value }))}
                      placeholder="https://www.mobilessentrix.com/item/..."
                      className="pl-12"
                    />
                  </div>
                </Field>

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Actual cost (₹)" required hint="Landed price paid">
                    <Input
                      type="number"
                      value={onlineForm.unitCost}
                      onChange={(e) => setOnlineForm((f) => ({ ...f, unitCost: e.target.value }))}
                      placeholder="Cost"
                    />
                  </Field>
                  <Field label="Quote to customer (₹)" required hint="Price billed">
                    <Input
                      type="number"
                      value={onlineForm.unitPrice}
                      onChange={(e) => setOnlineForm((f) => ({ ...f, unitPrice: e.target.value }))}
                      placeholder="Selling"
                    />
                  </Field>
                  <Field label="Quantity" required>
                    <Input
                      type="number"
                      min={1}
                      value={onlineForm.quantity}
                      onChange={(e) => setOnlineForm((f) => ({ ...f, quantity: e.target.value }))}
                    />
                  </Field>
                </div>

                <Field label="Order note or tracking #">
                  <Input
                    value={onlineForm.note}
                    onChange={(e) => setOnlineForm((f) => ({ ...f, note: e.target.value }))}
                    placeholder="e.g. Order #MS-9281, 2-day priority delivery"
                  />
                </Field>
              </div>
            )}
          </div>
        ) : mode === 'offline' ? (
          /* 2. OFFLINE PURCHASING (Local Store / Wholesale - NO URL NEEDED) */
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <Store className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Offline Store Purchasing:</strong> For physical electronic market counters and local wholesale vendors. <em>No online URL is required.</em> Record the store name, address, and bill number for shop accounting.
              </span>
            </div>

            <Field label="Part title / component name" required>
              <Input
                value={offlineForm.name}
                onChange={(e) => setOfflineForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Samsung Galaxy A54 Charging Board Flex"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Local shop / store name (Required)" required>
                <div className="relative">
                  <Building2 className="absolute top-1/2 left-3 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={offlineForm.shopName}
                    onChange={(e) => setOfflineForm((f) => ({ ...f, shopName: e.target.value }))}
                    placeholder="e.g. City Mobile Spare Hub"
                    className="pl-12"
                  />
                </div>
              </Field>

              <Field label="Quality grade">
                <Select
                  value={offlineForm.quality}
                  onChange={(e) => setOfflineForm((f) => ({ ...f, quality: e.target.value }))}
                >
                  {QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Shop address / market location" hint="e.g. Shop 12, Electronics Plaza / Nehru Place">
                <Input
                  value={offlineForm.shopAddress}
                  onChange={(e) => setOfflineForm((f) => ({ ...f, shopAddress: e.target.value }))}
                  placeholder="Market name or stall number"
                />
              </Field>
              <Field label="Shop phone / WhatsApp" hint="For returns or warranty inquiries">
                <Input
                  value={offlineForm.shopPhone}
                  onChange={(e) => setOfflineForm((f) => ({ ...f, shopPhone: e.target.value }))}
                  placeholder="e.g. +91 98765 43210"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Bill / Receipt / Cash memo #" hint="Physical invoice number">
                <Input
                  value={offlineForm.billNumber}
                  onChange={(e) => setOfflineForm((f) => ({ ...f, billNumber: e.target.value }))}
                  placeholder="e.g. INV-8921 / Cash Slip #45"
                />
              </Field>
              <Field label="Warranty / Return terms" hint="Physical store testing policy">
                <Input
                  value={offlineForm.warranty}
                  onChange={(e) => setOfflineForm((f) => ({ ...f, warranty: e.target.value }))}
                  placeholder="e.g. 7 Days Testing Warranty"
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Actual cost paid (₹)" required hint="Purchase price at shop">
                <Input
                  type="number"
                  value={offlineForm.unitCost}
                  onChange={(e) => setOfflineForm((f) => ({ ...f, unitCost: e.target.value }))}
                  placeholder="Cost"
                />
              </Field>
              <Field label="Quote to customer (₹)" required hint="Price billed to client">
                <Input
                  type="number"
                  value={offlineForm.unitPrice}
                  onChange={(e) => setOfflineForm((f) => ({ ...f, unitPrice: e.target.value }))}
                  placeholder="Selling"
                />
              </Field>
              <Field label="Quantity" required>
                <Input
                  type="number"
                  min={1}
                  value={offlineForm.quantity}
                  onChange={(e) => setOfflineForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </Field>
            </div>

            <Field label="Bench note">
              <Input
                value={offlineForm.note}
                onChange={(e) => setOfflineForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="e.g. Hand-picked by technician, tested on bench"
              />
            </Field>
          </div>
        ) : (
          /* 3. FROM INVENTORY */
          <div className="space-y-3.5">
            <Field label="Select part from in-shop inventory" required>
              <Select value={sparePartId} onChange={(event) => setSparePartId(event.target.value)}>
                <option value="">-- Choose a part in stock --</option>
                {catalog.data?.items.map((part) => (
                  <option key={part.id} value={part.id} disabled={part.quantity <= 0}>
                    {part.name} · {part.sku} · {part.quantity} in stock ({money(part.sellingPrice)})
                  </option>
                ))}
              </Select>
            </Field>

            {selected ? (
              <div className="rounded-xl border border-slate-200 p-3 text-xs dark:border-white/10 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selected.name}</span>
                  <Badge tone={selected.quantity <= selected.minStock ? 'amber' : 'emerald'}>
                    {selected.quantity} in stock
                  </Badge>
                </div>
                <p className="text-slate-500 dark:text-slate-400">
                  {selected.compatibleModels || 'Compatibility not recorded'} · {selected.quality}
                </p>
                <p className="text-slate-500 dark:text-slate-400">
                  Retail price {money(selected.sellingPrice)} · Minimum reorder level {selected.minStock}
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quantity" required>
                <Input
                  type="number"
                  min={1}
                  max={selected ? Math.max(1, selected.quantity) : 100}
                  value={stockForm.quantity}
                  onChange={(event) => setStockForm((s) => ({ ...s, quantity: event.target.value }))}
                />
              </Field>
              <Field
                label="Customer unit price (₹)"
                hint={selected ? `Defaults to ${money(selected.sellingPrice)} if left blank.` : undefined}
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={stockForm.unitPrice}
                  onChange={(event) => setStockForm((s) => ({ ...s, unitPrice: event.target.value }))}
                  placeholder={selected ? String(selected.sellingPrice) : '0'}
                />
              </Field>
            </div>

            <Field label="Inventory note">
              <Input
                value={stockForm.note}
                onChange={(e) => setStockForm((s) => ({ ...s, note: e.target.value }))}
                placeholder="Optional stock note"
              />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  )
}

function PaymentModal({
  open,
  onClose,
  summary,
  submitting,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  summary: MoneySummary
  submitting: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [amount, setAmount] = useState(summary.balance > 0 ? summary.balance.toFixed(2) : '')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a payment"
      description={`Outstanding balance: ${money(summary.balance, true)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            onClick={() =>
              onSubmit({
                amount: Number(amount),
                method,
                reference: reference || undefined,
                notes: notes || undefined,
              })
            }
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Amount" required hint={`Maximum outstanding: ${money(summary.balance, true)}`}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label="Method" required>
          <Select value={method} onChange={(event) => setMethod(event.target.value)}>
            {PAYMENT_METHODS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" hint="UPI reference, card receipt or bank transaction ID.">
          <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  )
}

function QuoteModal({
  open,
  onClose,
  repair,
  summary,
  isOwner,
  submitting,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  repair: Repair
  summary: MoneySummary
  isOwner: boolean
  submitting: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [labourCharge, setLabourCharge] = useState('')
  const [otherExpenses, setOtherExpenses] = useState('0')
  const [otherCost, setOtherCost] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [taxRate, setTaxRate] = useState('')
  const [notes, setNotes] = useState('')

  const latest = repair.quotations[0]
  const partsTotal = summary.partsCharged
  const previewTaxable = Math.max(
    0,
    partsTotal + (Number(labourCharge) || 0) + (Number(otherExpenses) || 0) - (Number(discount) || 0),
  )
  const previewTax = (previewTaxable * (Number(taxRate) || 0)) / 100

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Prepare quotation${latest ? ` · version ${latest.version + 1}` : ''}`}
      description="The server recalculates every amount, tax and profit figure when you save."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            onClick={() =>
              onSubmit({
                labourCharge: Number(labourCharge) || 0,
                otherExpenses: Number(otherExpenses) || 0,
                ...(isOwner ? { otherCost: Number(otherCost) || 0 } : {}),
                discount: Number(discount) || 0,
                ...(taxRate !== '' ? { taxRate: Number(taxRate) } : {}),
                notes: notes || undefined,
              })
            }
          >
            Submit for approval
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-500/25 dark:bg-indigo-500/[0.07]">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-400">Parts at customer price</span>
            <span className="font-semibold text-slate-900 dark:text-white">{money(partsTotal, true)}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {repair.parts.length} part line{repair.parts.length === 1 ? '' : 's'} · calculated by the server
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Labour charge" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={labourCharge}
              onChange={(event) => setLabourCharge(event.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Other expenses" hint="Consumables, pickup, etc.">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={otherExpenses}
              onChange={(event) => setOtherExpenses(event.target.value)}
            />
          </Field>
          <Field label="Discount">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
            />
          </Field>
          <Field label="Tax rate %" hint="Defaults to the shop setting if left blank.">
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={taxRate}
              onChange={(event) => setTaxRate(event.target.value)}
              placeholder="Shop default"
            />
          </Field>
          {isOwner ? (
            <Field label="Actual other cost" hint="Internal cost only, for accurate profit.">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={otherCost}
                onChange={(event) => setOtherCost(event.target.value)}
              />
            </Field>
          ) : null}
        </div>

        <Field label="Quote notes" hint="Visible to the owner and recorded on the quote.">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. Customer approved a compatible display; 60-day warranty."
            className="min-h-20"
          />
        </Field>

        <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.03]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Preview (not saved)</p>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Taxable subtotal</span>
              <span>{money(previewTaxable, true)}</span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Tax</span>
              <span>{money(previewTax, true)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-bold text-slate-900 dark:border-white/10 dark:text-white">
              <span>Estimated customer total</span>
              <span>{money(previewTaxable + previewTax, true)}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            The server recalculates with the shop tax rate, technician incentive and profit before saving.
          </p>
        </div>
      </div>
    </Modal>
  )
}
