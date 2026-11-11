import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  Filter,
  Plus,
  Search,
  SlidersHorizontal,
  Wrench,
  X,
} from 'lucide-react'
import { api, qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date, money, number, relative } from '../lib/format'
import type { DateRange, RepairListItem, Technician } from '../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
  SkeletonRows,
} from '../components/ui'
import { PriorityBadge, QuoteStatusBadge, StatusBadge } from '../components/badges'

const STATUS_OPTIONS = [
  ['', 'All statuses'],
  ['NEW_REQUEST', 'New request'],
  ['DEVICE_RECEIVED', 'Device received'],
  ['AI_DIAGNOSIS_COMPLETED', 'AI diagnosis completed'],
  ['AWAITING_INSPECTION', 'Awaiting inspection'],
  ['ESTIMATE_PREPARED', 'Estimate prepared'],
  ['AWAITING_OWNER_APPROVAL', 'Awaiting owner approval'],
  ['AWAITING_CUSTOMER_APPROVAL', 'Awaiting customer approval'],
  ['PARTS_ORDERED', 'Parts ordered'],
  ['REPAIR_IN_PROGRESS', 'Repair in progress'],
  ['QUALITY_CHECK', 'Quality check'],
  ['COMPLETED', 'Completed'],
  ['READY_FOR_PICKUP', 'Ready for pickup'],
  ['DELIVERED', 'Delivered'],
  ['CANCELLED', 'Cancelled'],
]

const PERIOD_OPTIONS = [
  ['month', 'This month'],
  ['week', 'Last 7 days'],
  ['today', 'Today'],
  ['year', 'This year'],
  ['all', 'All time'],
]

export default function Repairs() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [showFilters, setShowFilters] = useState(false)

  const page = Math.max(1, Number(params.get('page')) || 1)
  const status = params.get('status') ?? ''
  const priority = params.get('priority') ?? ''
  const technicianId = params.get('technicianId') ?? ''
  const period = params.get('period') ?? 'month'

  const query = useQuery({
    queryKey: ['repairs', page, status, priority, technicianId, period, params.get('q') ?? ''],
    queryFn: () =>
      api.get<{
        items: RepairListItem[]
        total: number
        page: number
        pageSize: number
        range: DateRange
      }>(
        `/repairs${qs({
          page,
          pageSize: 20,
          status,
          priority,
          technicianId,
          period,
          q: params.get('q') ?? '',
        })}`,
      ),
  })

  const technicians = useQuery({
    queryKey: ['technicians'],
    queryFn: () => api.get<{ items: Technician[] }>('/technicians'),
    enabled: user?.role === 'OWNER',
  })

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  const clearFilters = () => {
    setSearch('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const hasFilters = Boolean(status || priority || technicianId || params.get('q') || period !== 'month')
  const range = query.data?.range

  const summary = useMemo(() => {
    const items = query.data?.items ?? []
    return {
      urgent: items.filter((item) => item.priority === 'URGENT').length,
      awaitingQuote: items.filter((item) => item.quoteStatus === 'PENDING_OWNER').length,
    }
  }, [query.data?.items])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workflow"
        title="Repairs"
        description={
          range
            ? `${number(query.data?.total)} repair${query.data?.total === 1 ? '' : 's'} · ${date(range.from)} – ${date(range.to)}`
            : 'Every device, from intake to handover.'
        }
        actions={
          <>
            <Button variant="outline" icon={SlidersHorizontal} onClick={() => setShowFilters((value) => !value)}>
              Filters
            </Button>
            <Button icon={Plus} onClick={() => navigate('/repairs/new')}>
              New repair
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <form
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault()
            update('q', search.trim())
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by code, customer, phone, device…"
              className="pl-12"
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  update('q', '')
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Select value={status} onChange={(event) => update('status', event.target.value)} className="w-52">
              {STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </div>
        </form>

        {showFilters ? (
          <div className="grid gap-3 border-t border-slate-200/80 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/10">
            <div>
              <label className="field-label">Priority</label>
              <Select value={priority} onChange={(event) => update('priority', event.target.value)}>
                <option value="">All priorities</option>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </Select>
            </div>
            {user?.role === 'OWNER' ? (
              <div>
                <label className="field-label">Technician</label>
                <Select value={technicianId} onChange={(event) => update('technicianId', event.target.value)}>
                  <option value="">All technicians</option>
                  <option value="unassigned">Unassigned</option>
                  {technicians.data?.items.map((tech) => (
                    <option key={tech.id} value={tech.id}>
                      {tech.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div>
              <label className="field-label">Period</label>
              <Select value={period} onChange={(event) => update('period', event.target.value)}>
                {PERIOD_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end">
              {hasFilters ? (
                <Button variant="ghost" size="sm" icon={X} onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <p className="pb-2 text-xs text-slate-400">No filters applied</p>
              )}
            </div>
          </div>
        ) : null}

        {hasFilters ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 px-4 py-2.5 text-xs dark:border-white/10">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            {params.get('q') ? <Badge tone="slate">“{params.get('q')}”</Badge> : null}
            {status ? <Badge tone="indigo">{STATUS_OPTIONS.find(([value]) => value === status)?.[1] ?? status}</Badge> : null}
            {priority ? <Badge tone="amber">{priority}</Badge> : null}
            {technicianId ? (
              <Badge tone="violet">
                {technicianId === 'unassigned'
                  ? 'Unassigned'
                  : technicians.data?.items.find((tech) => tech.id === technicianId)?.name ?? 'Technician'}
              </Badge>
            ) : null}
            {period !== 'month' ? (
              <Badge tone="cyan">{PERIOD_OPTIONS.find(([value]) => value === period)?.[1] ?? period}</Badge>
            ) : null}
          </div>
        ) : null}

        {query.isLoading ? (
          <SkeletonRows rows={6} />
        ) : query.isError ? (
          <ErrorState message="The repair list could not be loaded." onRetry={() => query.refetch()} />
        ) : !query.data?.items.length ? (
          <EmptyState
            icon={Wrench}
            title={hasFilters ? 'No repairs match these filters' : 'No repairs yet'}
            description={
              hasFilters
                ? 'Try a wider date range or clear one of the filters.'
                : 'Create your first repair request to start the workflow.'
            }
            action={
              hasFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/repairs/new">
                  <Button icon={Plus}>New repair</Button>
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 px-4 py-2 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
              <span>
                <span className="font-semibold text-slate-700 dark:text-slate-200">{query.data.total}</span>{' '}
                result{query.data.total === 1 ? '' : 's'}
              </span>
              {summary.urgent > 0 ? <Badge tone="red">{summary.urgent} urgent</Badge> : null}
              {summary.awaitingQuote > 0 ? (
                <Badge tone="amber">{summary.awaitingQuote} quote approval</Badge>
              ) : null}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-y border-slate-200/80 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Repair</th>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold">Technician</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Quote</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Paid</th>
                    <th className="px-4 py-2.5 font-semibold">Age</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {query.data.items.map((repair) => (
                    <tr
                      key={repair.id}
                      onClick={() => navigate(`/repairs/${repair.id}`)}
                      className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{repair.code}</span>
                          <PriorityBadge priority={repair.priority} />
                        </div>
                        <p className="mt-0.5 max-w-64 truncate text-xs text-slate-500 dark:text-slate-400">
                          {repair.device.brand} {repair.device.model} · {repair.device.category}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-medium text-slate-800 dark:text-slate-200">{repair.customer.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{repair.customer.phone}</p>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-slate-300">
                        {repair.technician?.name ?? <span className="text-slate-400">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={repair.status} />
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-medium text-slate-800 dark:text-slate-200">{money(repair.quoteTotal)}</p>
                        <div className="mt-1">
                          <QuoteStatusBadge status={repair.quoteStatus} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-slate-800 dark:text-slate-200">
                        {money(repair.paidTotal)}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                        {relative(repair.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <ChevronRight className="ml-auto h-4 w-4 text-slate-300 dark:text-slate-600" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 lg:hidden dark:divide-white/5">
              {query.data.items.map((repair) => (
                <Link
                  key={repair.id}
                  to={`/repairs/${repair.id}`}
                  className="block px-4 py-4 transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{repair.code}</p>
                        <PriorityBadge priority={repair.priority} />
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-700 dark:text-slate-300">
                        {repair.device.brand} {repair.device.model}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {repair.customer.name} · {repair.customer.phone}
                      </p>
                    </div>
                    <StatusBadge status={repair.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    <span>{repair.technician?.name ?? 'Unassigned'}</span>
                    <span>Quote {money(repair.quoteTotal)}</span>
                    <span>Paid {money(repair.paidTotal)}</span>
                    <span>{relative(repair.createdAt)}</span>
                  </div>
                </Link>
              ))}
            </div>

            <Pagination
              page={query.data.page}
              pageSize={query.data.pageSize}
              total={query.data.total}
              onPage={(next) => update('page', String(next))}
            />
          </>
        )}
      </Card>
    </div>
  )
}
