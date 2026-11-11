import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  IndianRupee,
  PackageOpen,
  Plus,
  QrCode,
  Sparkles,
  Star,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  compactMoney,
  date,
  money,
  number,
  percent,
  recentMonthOptions,
  relative,
} from '../lib/format'
import type { MyAnalytics, Overview } from '../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  SkeletonRows,
  StatCard,
} from '../components/ui'
import { Rating, StatusBadge, STATUS_LABELS } from '../components/badges'
import { useTheme } from '../lib/theme'

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
]

const PIE_COLORS = ['var(--color-primary)', 'var(--color-primary-hover)', 'var(--color-text-muted)', '#10b981', '#f59e0b', '#f43f5e', 'var(--color-border-soft)']

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return key
  return new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}

function ChartTooltipStyle(dark: boolean) {
  return {
    backgroundColor: dark ? 'var(--color-bg-subtle)' : 'var(--color-surface)',
    border: `1px solid color-mix(in oklab, var(--color-border) 30%, transparent)`,
    borderRadius: 12,
    fontSize: 12,
    color: dark ? 'var(--color-text-secondary)' : 'var(--color-text)',
    boxShadow: 'none',
  }
}

export default function Dashboard() {
  const { user } = useAuth()
  return user?.role === 'OWNER' ? <OwnerDashboard /> : <TechnicianDashboard />
}

/* ------------------------------ owner ------------------------------ */

function OwnerDashboard() {
  const [period, setPeriod] = useState('month')
  const [month, setMonth] = useState('')
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const navigate = useNavigate()
  const months = recentMonthOptions(24)

  const rangeQuery = month ? `month=${month}` : `period=${period}`
  const query = useQuery({
    queryKey: ['overview', period, month],
    queryFn: () => api.get<Overview>(`/analytics/overview?${rangeQuery}`),
  })

  const data = query.data
  const rangeLabel = data ? `${date(data.range.from)} – ${date(data.range.to)}` : ''

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Owner cockpit"
        title={`Good to see you, ${useFirstName()}`}
        description="A live read on repairs, cash flow and stock. Numbers come straight from server-side records."
        actions={
          <>
            <Select
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="h-10 w-48"
              aria-label="Select month"
            >
              <option value="">Latest ({PERIODS.find((p) => p.value === period)?.label})</option>
              {months.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select value={period} onChange={(event) => setPeriod(event.target.value)} className="h-10 w-40">
              {PERIODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Button icon={Plus} onClick={() => navigate('/repairs/new')}>
              New repair
            </Button>
          </>
        }
      />

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="surface h-32 animate-pulse" />
          ))}
        </div>
      ) : query.isError ? (
        <Card padded={false}>
          <ErrorState message="The dashboard could not be loaded." onRetry={() => query.refetch()} />
        </Card>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Collected revenue"
              value={money(data.kpis.revenue)}
              hint={`${rangeLabel} · avg ticket ${money(data.kpis.averageTicket)}`}
              icon={IndianRupee}
              tone="emerald"
            />
            <StatCard
              label="Net profit"
              value={money(data.kpis.netProfit)}
              hint={`After parts ${money(data.kpis.partsCost)}, overhead ${money(data.kpis.overhead)} & incentives`}
              icon={TrendingUp}
              tone={data.kpis.netProfit >= 0 ? 'indigo' : 'red'}
            />
            <StatCard
              label="Active repairs"
              value={number(data.kpis.pending)}
              hint={`${data.kpis.repairs} received · ${data.kpis.completed} completed this period`}
              icon={Wrench}
              tone="blue"
            />
            <StatCard
              label="Waiting on you"
              value={number(data.kpis.pendingApprovals)}
              hint={`${data.kpis.awaitingPickup} ready for pickup · ${data.kpis.lowStockCount} low-stock items`}
              icon={ClipboardList}
              tone={data.kpis.pendingApprovals > 0 ? 'amber' : 'slate'}
            />
          </div>

          <Card padded={false}>
            <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  {monthLabel(data.monthlyComparison.current.month)} vs{' '}
                  {monthLabel(data.monthlyComparison.previous.month)}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Calendar months in Asia/Kolkata. Repairs and completions are counted once; revenue is
                  payments received, not quoted totals.
                </p>
              </div>
              <Badge tone={data.kpis.outstanding > 0 ? 'amber' : 'emerald'} dot>
                {money(data.kpis.outstanding)} outstanding
                {data.kpis.outstandingRepairs > 0 ? ` · ${data.kpis.outstandingRepairs} open` : ''}
              </Badge>
            </div>
            <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-7">
              {[
                {
                  label: 'Repairs received',
                  current: number(data.monthlyComparison.current.repairs),
                  previous: number(data.monthlyComparison.previous.repairs),
                },
                {
                  label: 'Completed',
                  current: number(data.monthlyComparison.current.completed),
                  previous: number(data.monthlyComparison.previous.completed),
                },
                {
                  label: 'Pending',
                  current: number(data.monthlyComparison.current.pending),
                  previous: number(data.monthlyComparison.previous.pending),
                },
                {
                  label: 'Cancelled',
                  current: number(data.monthlyComparison.current.cancelled),
                  previous: number(data.monthlyComparison.previous.cancelled),
                },
                {
                  label: 'Revenue',
                  current: money(data.monthlyComparison.current.revenue),
                  previous: money(data.monthlyComparison.previous.revenue),
                },
                {
                  label: 'Expenses',
                  current: money(data.monthlyComparison.current.expenses),
                  previous: money(data.monthlyComparison.previous.expenses),
                },
                {
                  label: 'Profit',
                  current: money(data.monthlyComparison.current.profit),
                  previous: money(data.monthlyComparison.previous.profit),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-white/5"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {item.label}
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{item.current}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Previous month {item.previous}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2" padded={false}>
              <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Revenue rhythm</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Payments collected per day, with repair intake and completions.
                  </p>
                </div>
                <Badge tone="indigo" dot>
                  {data.charts.daily.length} days
                </Badge>
              </div>
              <div className="h-72 w-full px-2 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.charts.daily} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.32} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={dark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value: string) => value.slice(5)}
                      tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tickFormatter={(value: number) => compactMoney(value)}
                      tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      width={64}
                    />
                    <Tooltip
                      contentStyle={ChartTooltipStyle(dark)}
                      formatter={(value, name) => [
                        name === 'Revenue' ? money(Number(value)) : number(Number(value)),
                        String(name),
                      ]}
                      labelFormatter={(value) => date(String(value))}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="#6366f1"
                      strokeWidth={2.5}
                      fill="url(#revenue-fill)"
                    />
                    <Area
                      type="monotone"
                      dataKey="repairs"
                      name="Intake"
                      stroke="#06b6d4"
                      strokeWidth={1.5}
                      fillOpacity={0}
                      strokeDasharray="4 4"
                    />
                    <Area
                      type="monotone"
                      dataKey="completed"
                      name="Completed"
                      stroke="#10b981"
                      strokeWidth={1.5}
                      fillOpacity={0}
                      strokeDasharray="2 4"
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card padded={false}>
              <div className="p-5 pb-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Repair pipeline</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Where devices sit right now.</p>
              </div>
              {data.charts.statusDistribution.length === 0 ? (
                <EmptyState title="No repairs in this period" description="Create a repair to see the pipeline." />
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.charts.statusDistribution}
                          dataKey="count"
                          nameKey="label"
                          innerRadius={52}
                          outerRadius={82}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {data.charts.statusDistribution.map((entry, index) => (
                            <Cell key={entry.label} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={ChartTooltipStyle(dark)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5 px-5 pb-5">
                    {data.charts.statusDistribution.slice(0, 5).map((entry, index) => (
                      <div key={entry.label} className="flex items-center gap-2 text-xs">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                        />
                        <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{entry.label}</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{entry.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2" padded={false}>
              <div className="flex items-center justify-between p-5 pb-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Recent repairs</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Latest intake across the shop.</p>
                </div>
                <Link
                  to="/repairs"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {data.recentRepairs.length === 0 ? (
                <EmptyState
                  icon={Wrench}
                  title="No repairs yet"
                  description="Start by creating the first repair request."
                  action={
                    <Link to="/repairs/new">
                      <Button size="sm" icon={Plus}>
                        New repair
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {data.recentRepairs.map((repair) => (
                    <Link
                      key={repair.id}
                      to={`/repairs/${repair.id}`}
                      className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                        <Wrench className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {repair.device}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {repair.code} · {repair.customer} · {relative(repair.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={repair.status} />
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <div className="space-y-5">
              <Card padded={false}>
                <div className="flex items-center justify-between p-5 pb-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">Needs attention</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Stock and approvals.</p>
                  </div>
                  <PackageOpen className="h-4.5 w-4.5 text-amber-500" />
                </div>
                <div className="space-y-2 px-5 pb-5 pt-2">
                  <Link
                    to="/analytics"
                    className="flex items-center justify-between rounded-xl bg-amber-50 px-3.5 py-3 text-sm transition hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
                  >
                    <span className="font-medium text-amber-800 dark:text-amber-300">Quotes awaiting approval</span>
                    <span className="font-bold text-amber-800 dark:text-amber-200">{data.kpis.pendingApprovals}</span>
                  </Link>
                  <Link
                    to="/inventory"
                    className="flex items-center justify-between rounded-xl bg-rose-50 px-3.5 py-3 text-sm transition hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/15"
                  >
                    <span className="font-medium text-rose-800 dark:text-rose-300">Low-stock parts</span>
                    <span className="font-bold text-rose-800 dark:text-rose-200">{data.kpis.lowStockCount}</span>
                  </Link>
                  <Link
                    to="/repairs?status=READY_FOR_PICKUP"
                    className="flex items-center justify-between rounded-xl bg-emerald-50 px-3.5 py-3 text-sm transition hover:bg-emerald-100 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
                  >
                    <span className="font-medium text-emerald-800 dark:text-emerald-300">Ready for pickup</span>
                    <span className="font-bold text-emerald-800 dark:text-emerald-200">
                      {data.kpis.awaitingPickup}
                    </span>
                  </Link>
                </div>
              </Card>

              <Card padded={false}>
                <div className="p-5 pb-2">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Fast actions</h2>
                </div>
                <div className="grid grid-cols-2 gap-2 p-4 pt-2">
                  <QuickAction icon={Plus} label="New repair" onClick={() => navigate('/repairs/new')} />
                  <QuickAction icon={QrCode} label="QR reports" onClick={() => navigate('/reports')} />
                  <QuickAction icon={Boxes} label="Inventory" onClick={() => navigate('/inventory')} />
                  <QuickAction icon={Sparkles} label="AI status" onClick={() => navigate('/settings')} />
                </div>
              </Card>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="padded" padded={false}>
              <div className="p-5 pb-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Monthly profit</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Last 12 months: collected revenue against parts, overhead and incentives.
                </p>
              </div>
              <div className="h-64 px-2 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.charts.monthly} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={dark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'} vertical={false} />
                    <XAxis
                      dataKey="month"
                      tickFormatter={(value: string) => value.slice(5)}
                      tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(value: number) => compactMoney(value)}
                      tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                    />
                    <Tooltip
                      contentStyle={ChartTooltipStyle(dark)}
                      formatter={(value, name) => [money(Number(value)), String(name)]}
                      labelFormatter={(value) => `Month ${String(value)}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[5, 5, 0, 0]} maxBarSize={26} />
                    <Bar dataKey="profit" name="Profit" fill="#10b981" radius={[5, 5, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card padded={false}>
              <div className="flex items-center justify-between p-5 pb-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Technician contribution</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Revenue minus parts cost and incentives, this period.
                  </p>
                </div>
                <Badge tone="slate">{data.charts.technicianComparison.length} techs</Badge>
              </div>
              {data.charts.technicianComparison.length === 0 ? (
                <EmptyState title="No technicians yet" description="Add a technician to compare performance." />
              ) : (
                <div className="space-y-4 px-5 pb-5 pt-2">
                  {data.charts.technicianComparison.map((tech) => {
                    const max = Math.max(
                      1,
                      ...data.charts.technicianComparison.map((row) => Math.abs(row.contribution)),
                    )
                    const width = Math.max(4, Math.round((Math.abs(tech.contribution) / max) * 100))
                    return (
                      <Link key={tech.id} to={`/technicians/${tech.id}`} className="block group">
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                          <span className="font-medium text-slate-700 group-hover:text-indigo-600 dark:text-slate-200 dark:group-hover:text-indigo-400">
                            {tech.name}
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {money(tech.contribution)}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                          <span>
                            {tech.completed}/{tech.assigned} completed
                          </span>
                          <span className="inline-flex items-center gap-1">
                            {tech.avgRating ? (
                              <>
                                <Star className="h-3 w-3 fill-current text-amber-500" />
                                {tech.avgRating.toFixed(1)}
                              </>
                            ) : (
                              'No ratings'
                            )}
                          </span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}

function useFirstName() {
  const { user } = useAuth()
  return user?.name?.split(/\s+/)[0] ?? 'there'
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Plus
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/10"
    >
      <Icon className="h-4 w-4 text-indigo-500" />
      {label}
    </button>
  )
}

/* ------------------------------ technician ------------------------------ */

function TechnicianDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['analytics-me'],
    queryFn: () => api.get<MyAnalytics>('/analytics/me?period=month'),
  })

  const data = query.data

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Technician workspace"
        title={`Hi ${user?.name?.split(/\s+/)[0] ?? 'there'}`}
        description="Your assigned repairs, completed work and customer feedback for this month."
        actions={
          <Button icon={Plus} onClick={() => navigate('/repairs/new')}>
            New repair
          </Button>
        }
      />

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="surface h-32 animate-pulse" />
          ))}
        </div>
      ) : query.isError ? (
        <Card padded={false}>
          <ErrorState message="Your workspace could not be loaded." onRetry={() => query.refetch()} />
        </Card>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Assigned this month" value={number(data.kpis.assigned)} icon={Wrench} tone="blue" />
            <StatCard
              label="In progress"
              value={number(data.kpis.pending)}
              hint={`${data.kpis.awaitingPickup} waiting for pickup`}
              icon={CalendarClock}
              tone="amber"
            />
            <StatCard label="Completed" value={number(data.kpis.completed)} icon={CheckCircle2} tone="emerald" />
            <StatCard
              label="Customer rating"
              value={data.kpis.avgRating ? `${data.kpis.avgRating.toFixed(1)} / 5` : 'No ratings'}
              hint={`${data.kpis.feedbackCount} feedback responses`}
              icon={BadgeCheck}
              tone="violet"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2" padded={false}>
              <div className="flex items-center justify-between p-5 pb-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Your recent work</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Open a repair to update status, add parts or prepare a quote.
                  </p>
                </div>
                <Link
                  to="/repairs"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {data.recentRepairs.length === 0 ? (
                <EmptyState
                  icon={Wrench}
                  title="No repairs assigned yet"
                  description="New assignments will appear here as soon as the owner assigns them."
                />
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {data.recentRepairs.map((repair) => (
                    <Link
                      key={repair.id}
                      to={`/repairs/${repair.id}`}
                      className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {repair.device}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {repair.code} · {repair.customer} · {relative(repair.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={repair.status} />
                      <span className="hidden text-xs font-medium text-slate-500 sm:block dark:text-slate-400">
                        {money(repair.quoteTotal)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card padded={false}>
              <div className="p-5 pb-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Work mix</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Status of your repairs.</p>
              </div>
              {data.statusDistribution.length === 0 ? (
                <EmptyState title="Nothing here yet" />
              ) : (
                <div className="space-y-2 p-5 pt-3">
                  {data.statusDistribution.map((entry) => {
                    const total = data.kpis.assigned || 1
                    const width = Math.max(4, Math.round((entry.count / total) * 100))
                    return (
                      <div key={entry.label}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="truncate text-slate-600 dark:text-slate-300">{entry.label}</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-100">{entry.count}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Keep the handover clean</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                  Before marking a repair complete, record what was tested and what warranty you are
                  offering. These details flow into the customer's QR service report.
                </p>
              </div>
              <div className="flex gap-2">
                <Link to="/repairs?status=REPAIR_IN_PROGRESS">
                  <Button variant="outline">In progress</Button>
                </Link>
                <Link to="/repairs?status=QUALITY_CHECK">
                  <Button variant="outline">Quality check</Button>
                </Link>
              </div>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}
