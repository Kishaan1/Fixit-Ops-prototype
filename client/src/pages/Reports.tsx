import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { date, dateTime, money, number } from '../lib/format'
import type { ReportListItem } from '../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  SkeletonRows,
  StatCard,
} from '../components/ui'
import { StatusBadge } from '../components/badges'

export default function Reports() {
  const { user } = useAuth()
  const { success, error } = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const reports = useQuery({
    queryKey: ['reports'],
    queryFn: () => api.get<{ items: ReportListItem[] }>('/reports'),
  })

  const rotate = useMutation({
    mutationFn: (repairId: string) =>
      api.post<{ token: string; url: string }>(`/reports/${repairId}/rotate`),
    onSuccess: () => {
      success('QR link replaced', 'The previous link no longer works. Share the new one with the customer.')
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (err) => error('Could not rotate link', errorMessage(err)),
  })

  const items = useMemo(() => {
    const all = reports.data?.items ?? []
    const term = search.trim().toLowerCase()
    if (!term) return all
    return all.filter((report) =>
      [report.code, report.customer, report.device, report.statusLabel, report.technician ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [reports.data?.items, search])

  const copy = async (token: string) => {
    const url = `${window.location.origin}/r/${token}`
    try {
      await navigator.clipboard.writeText(url)
      success('Link copied', 'Share it with the customer by message or email.')
    } catch {
      error('Could not copy', 'Copy the link manually from the report.')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer handover"
        title="QR service reports"
        description="Hard-to-guess customer links showing only repair outcomes, parts and charges. Internal margins, costs and customer contact details are never published."
        actions={
          <Link to="/repairs?status=READY_FOR_PICKUP">
            <Button variant="outline" icon={FileText}>
              Repairs awaiting handover
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Published reports"
          value={number(reports.data?.items.length ?? 0)}
          hint="Customer-visible links"
          icon={QrCode}
          tone="indigo"
        />
        <StatCard
          label="Billed through reports"
          value={money(items.reduce((sum, report) => sum + report.amount, 0))}
          hint="Approved quote totals"
          icon={FileText}
          tone="violet"
        />
        <StatCard
          label="Collected"
          value={money(items.reduce((sum, report) => sum + report.paid, 0))}
          hint="Payments recorded"
          icon={CheckCircle2}
          tone="emerald"
        />
        <StatCard
          label="Outstanding"
          value={money(items.reduce((sum, report) => sum + Math.max(0, report.amount - report.paid), 0))}
          hint="Balance on published reports"
          icon={ShieldCheck}
          tone="amber"
        />
      </div>

      <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-xs leading-relaxed text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300">
        Reports are snapshots. Publish or refresh from the repair page after final charges are recorded.
        Devices with a rotated token invalidate the old QR immediately.
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by repair code, customer or device…"
              className="pl-12"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {reports.isLoading ? (
          <SkeletonRows rows={5} />
        ) : reports.isError ? (
          <ErrorState message="Published reports could not be loaded." onRetry={() => reports.refetch()} />
        ) : !items.length ? (
          <EmptyState
            icon={QrCode}
            title={search ? 'No reports match this search' : 'No reports published yet'}
            description={
              search
                ? 'Try a different repair code, customer name or device.'
                : 'Complete a repair, then publish its QR service report from the repair page.'
            }
            action={
              search ? (
                <Button variant="outline" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : (
                <Link to="/repairs">
                  <Button variant="outline">Go to repairs</Button>
                </Link>
              )
            }
          />
        ) : (
          <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((report) => {
              const url = `/r/${report.token}`
              return (
                <div
                  key={report.id}
                  className="rounded-2xl border border-slate-200 p-4 dark:border-white/10"
                >
                  <div className="flex items-start gap-4">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="shrink-0 rounded-xl border border-slate-200 bg-white p-1.5"
                      title="Open the public report"
                    >
                      <img
                        src={`/api/reports/${report.repairId}/qr?size=220&v=${report.token}`}
                        alt={`QR code for ${report.code}`}
                        className="h-[88px] w-[88px]"
                      />
                    </a>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          to={`/repairs/${report.repairId}`}
                          className="font-semibold text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                        >
                          {report.code}
                        </Link>
                        <StatusBadge status={report.status} />
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-700 dark:text-slate-300">
                        {report.customer}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {report.device}
                        {report.technician ? ` · ${report.technician}` : ''}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Published {dateTime(report.publishedAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-white/[0.04]">
                    <span className="text-slate-500 dark:text-slate-400">Billed {money(report.amount)}</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Paid {money(report.paid)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" icon={Copy} onClick={() => copy(report.token)}>
                      Copy link
                    </Button>
                    <a href={url} target="_blank" rel="noreferrer noopener">
                      <Button size="sm" variant="ghost" icon={ExternalLink}>
                        Open
                      </Button>
                    </a>
                    <a href={`${url}?print=1`} target="_blank" rel="noreferrer noopener">
                      <Button size="sm" variant="ghost" icon={Printer}>
                        Print
                      </Button>
                    </a>
                    {user?.role === 'OWNER' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={RefreshCw}
                        loading={rotate.isPending && rotate.variables === report.repairId}
                        onClick={() => rotate.mutate(report.repairId)}
                      >
                        Rotate
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-[10px] uppercase tracking-wide text-slate-400 dark:border-white/5">
                    <ShieldCheck className="h-3 w-3" /> No costs or margins exposed
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 dark:border-white/10 dark:bg-[#0d141d] dark:text-slate-400">
        <span>
          {items.length} report{items.length === 1 ? '' : 's'} shown
          {search ? ` · filtered from ${reports.data?.items.length ?? 0}` : ''}
        </span>
        <span className="flex items-center gap-1.5">
          <Badge tone="emerald" dot>
            Server-side snapshot
          </Badge>
          <span>Charges and payments are calculated by the API, not the browser.</span>
        </span>
      </div>

      <p className="text-center text-[11px] text-slate-400">
        Tip: open a report and use your browser's Print → Save as PDF for a clean A4 copy.
      </p>
      <p className="text-center text-[11px] text-slate-400">
        Report date {date(new Date())}
      </p>
    </div>
  )
}
