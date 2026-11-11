import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Download,
  IndianRupee,
  Package,
  Percent,
  PieChart as PieIcon,
  TrendingUp,
  Users,
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
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, downloadCsv, errorMessage } from '../lib/api'
import { useToast } from '../lib/toast'
import { useTheme } from '../lib/theme'
import { compactMoney, date, money, number, percent, recentMonthOptions } from '../lib/format'
import type { Overview } from '../lib/types'
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
import { Rating } from '../components/badges'

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
]

const PIE_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#f43f5e', '#64748b']

function tooltipStyle(dark: boolean) {
  return {
    backgroundColor: dark ? '#0d141d' : '#ffffff',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : '#e2e8f0'}`,
    borderRadius: 12,
    fontSize: 12,
    color: dark ? '#e2e8f0' : '#0f172a',
    boxShadow: '0 12px 30px -12px rgba(15,23,42,0.3)',
  }
}

export default function Analytics() {
  const [period, setPeriod] = useState('month')
  const [month, setMonth] = useState('')
  const [exporting, setExporting] = useState<string | null>(null)
  const { theme } = useTheme()
  const { success, error } = useToast()
  const dark = theme === 'dark'
  const months = recentMonthOptions(24)

  const rangeQuery = month ? `month=${month}` : `period=${period}`
  const overview = useQuery({
    queryKey: ['overview', period, month],
    queryFn: () => api.get<Overview>(`/analytics/overview?${rangeQuery}`),
  })

  const exportCsv = async (type: string) => {
    setExporting(type)
    try {
      await downloadCsv(
        `/analytics/export?type=${type}&${rangeQuery}`,
        `fixit-${type}-${month || new Date().toISOString().slice(0, 10)}.csv`,
      )
      success('Export ready', 'The CSV downloaded with server-side figures.')
    } catch (err) {
      error('Export failed', errorMessage(err))
    } finally {
      setExporting(null)
    }
  }

  if (overview.isLoading) return <SkeletonRows rows={8} />
  if (overview.isError)
    return (
      <Card padded={false}>
        <ErrorState message="Analytics could not be loaded." onRetry={() => overview.refetch()} />
      </Card>
    )
  if (!overview.data) return null

  const data = overview.data
  const rangeLabel = `${date(data.range.from)} – ${date(data.range.to)}`

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Business intelligence"
        title="Analytics"
        description={`${rangeLabel}. Revenue is collected payments; costs include parts, recorded expenses and technician incentives.`}
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
            <Button
              variant="outline"
              icon={Download}
              loading={exporting === 'repairs'}
              onClick={() => exportCsv('repairs')}
            >
              Repairs CSV
            </Button>
            <Button
              variant="outline"
              icon={Download}
              loading={exporting === 'revenue'}
              onClick={() => exportCsv('revenue')}
            >
              Revenue CSV
            </Button>
            <Button
              variant="outline"
              icon={Download}
              loading={exporting === 'customers'}
              onClick={() => exportCsv('customers')}
            >
              Customers CSV
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue collected"
          value={money(data.kpis.revenue)}
          hint={`${data.kpis.completed} completed repairs`}
          icon={IndianRupee}
          tone="emerald"
        />
        <StatCard
          label="Net profit"
          value={money(data.kpis.netProfit)}
          hint={`Expenses ${money(data.kpis.totalExpenses)}`}
          icon={TrendingUp}
          tone={data.kpis.netProfit >= 0 ? 'indigo' : 'red'}
        />
        <StatCard
          label="Average ticket"
          value={money(data.kpis.averageTicket)}
          hint={`${data.kpis.repairs} repairs received`}
          icon={Wrench}
          tone="blue"
        />
        <StatCard
          label="Retention"
          value={percent(data.kpis.retentionRate, 1)}
          hint={`${data.kpis.returningCustomers} returning of ${data.kpis.totalCustomers} customers`}
          icon={Users}
          tone="violet"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" padded={false}>
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Daily revenue</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Cash collected per day in the selected range.
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
                  <linearGradient id="analytics-revenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={dark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}
                  vertical={false}
                />
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
                  contentStyle={tooltipStyle(dark)}
                  formatter={(value, name) => [money(Number(value)), String(name)]}
                  labelFormatter={(value) => date(String(value))}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  fill="url(#analytics-revenue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Device mix</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Repairs by category.</p>
          </div>
          {!data.charts.categoryDistribution.length ? (
            <EmptyState icon={PieIcon} title="No devices in this period" />
          ) : (
            <>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.charts.categoryDistribution}
                      dataKey="count"
                      nameKey="label"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {data.charts.categoryDistribution.map((entry, index) => (
                        <Cell key={entry.label} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle(dark)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 px-5 pb-5">
                {data.charts.categoryDistribution.map((entry, index) => (
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

      <div className="grid gap-5 xl:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Revenue vs cost</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Rolling 12 months.</p>
          </div>
          <div className="h-64 w-full px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.charts.monthly} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={dark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(value: number) => compactMoney(value)}
                  tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <Tooltip contentStyle={tooltipStyle(dark)} formatter={(value) => money(Number(value))} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="cost" name="Cost" stroke="#f43f5e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="profit" name="Profit" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Common faults</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Based on confirmed faults recorded by technicians.
            </p>
          </div>
          {!data.charts.commonFaults.length ? (
            <EmptyState icon={AlertTriangle} title="No confirmed faults yet" />
          ) : (
            <div className="h-64 w-full px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.charts.commonFaults}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={dark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}
                    horizontal={false}
                  />
                  <XAxis type="number" tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={130}
                    tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle(dark)} />
                  <Bar dataKey="count" name="Repairs" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Brand split</h2>
            <BarChart3 className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Phones</p>
              {data.charts.mobileBrands.length ? (
                <div className="mt-2 space-y-1.5">
                  {data.charts.mobileBrands.map((brand) => (
                    <div key={brand.label} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{brand.label}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{brand.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-400">No phone repairs in this range.</p>
              )}
            </div>
            <div className="border-t border-slate-100 pt-3 dark:border-white/5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Laptops & tablets
              </p>
              {data.charts.laptopBrands.length ? (
                <div className="mt-2 space-y-1.5">
                  {data.charts.laptopBrands.map((brand) => (
                    <div key={brand.label} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{brand.label}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{brand.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-400">No laptop or tablet repairs in this range.</p>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Most replaced parts</h2>
            <Package className="h-4 w-4 text-slate-400" />
          </div>
          {!data.charts.mostReplaced.length ? (
            <EmptyState title="No parts used" description="Parts used on repairs will appear here." className="py-8" />
          ) : (
            <div className="mt-4 space-y-2.5">
              {data.charts.mostReplaced.map((part) => (
                <div key={part.name}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-slate-600 dark:text-slate-300">{part.name}</span>
                    <span className="shrink-0 font-semibold text-slate-800 dark:text-slate-100">
                      {part.count} · {money(part.cost)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{
                        width: `${Math.max(
                          6,
                          (part.count / Math.max(...data.charts.mostReplaced.map((p) => p.count))) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Inventory health</h2>
            <Boxes className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.04]">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Parts</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                {number(data.inventory.totalParts)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {number(data.inventory.totalUnits)} units
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.04]">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Stock value</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                {money(data.inventory.valueAtCost)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {money(data.inventory.valueAtRetail)} retail
              </p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
              <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400">Low stock</p>
              <p className="mt-1 text-lg font-bold text-amber-800 dark:text-amber-300">
                {number(data.inventory.lowStock)}
              </p>
            </div>
            <div className="rounded-xl bg-rose-50 p-3 dark:bg-rose-500/10">
              <p className="text-[11px] uppercase tracking-wide text-rose-700 dark:text-rose-400">Out of stock</p>
              <p className="mt-1 text-lg font-bold text-rose-800 dark:text-rose-300">
                {number(data.inventory.outOfStock)}
              </p>
            </div>
          </div>
          {data.inventory.lowStockItems.length ? (
            <div className="mt-4 space-y-1.5">
              {data.inventory.lowStockItems.slice(0, 4).map((item) => (
                <Link
                  key={item.id}
                  to="/inventory"
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                >
                  <span className="truncate text-slate-600 dark:text-slate-300">{item.name}</span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {item.quantity} / {item.minStock}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Technician comparison</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Contribution = collected revenue − parts cost − incentives.
            </p>
          </div>
          <Link
            to="/technicians"
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Team details <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {!data.charts.technicianComparison.length ? (
          <EmptyState icon={Users} title="No technician activity" description="Assign repairs to see contribution." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-y border-slate-200/80 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Technician</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Assigned</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Completed</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Revenue</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Parts cost</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Incentives</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Contribution</th>
                  <th className="px-4 py-2.5 font-semibold">Quality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.charts.technicianComparison.map((tech) => (
                  <tr key={tech.id} className="transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3.5">
                      <Link
                        to={`/technicians/${tech.id}`}
                        className="font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                      >
                        {tech.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-center text-slate-700 dark:text-slate-300">{tech.assigned}</td>
                    <td className="px-4 py-3.5 text-center text-slate-700 dark:text-slate-300">{tech.completed}</td>
                    <td className="px-4 py-3.5 text-right text-slate-800 dark:text-slate-200">{money(tech.revenue)}</td>
                    <td className="px-4 py-3.5 text-right text-slate-600 dark:text-slate-300">{money(tech.partsCost)}</td>
                    <td className="px-4 py-3.5 text-right text-slate-600 dark:text-slate-300">{money(tech.incentives)}</td>
                    <td className="px-4 py-3.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {money(tech.contribution)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Rating value={tech.avgRating} />
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {tech.avgCompletionDays === null
                          ? 'No completion data'
                          : `${tech.avgCompletionDays.toFixed(1)} days avg`}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 sm:grid-cols-3">
        <Card>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Percent className="h-3.5 w-3.5" /> Cost breakdown
          </p>
          <div className="mt-3 space-y-2 text-sm">
            {[
              ['Parts cost', data.kpis.partsCost],
              ['Overhead / expenses', data.kpis.overhead],
              ['Technician incentives', data.kpis.incentives],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">{label}</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{money(Number(value))}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 font-semibold dark:border-white/5">
              <span className="text-slate-800 dark:text-slate-200">Total expenses</span>
              <span className="text-rose-600 dark:text-rose-400">{money(data.kpis.totalExpenses)}</span>
            </div>
          </div>
        </Card>

        <Card>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Users className="h-3.5 w-3.5" /> Customers
          </p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">Total customers</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{number(data.kpis.totalCustomers)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">New this period</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{number(data.kpis.newCustomers)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">Returning</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {number(data.kpis.returningCustomers)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 font-semibold dark:border-white/5">
              <span className="text-slate-800 dark:text-slate-200">Retention rate</span>
              <span className="text-emerald-600 dark:text-emerald-400">{percent(data.kpis.retentionRate, 1)}</span>
            </div>
          </div>
        </Card>

        <Card>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Wrench className="h-3.5 w-3.5" /> Operations
          </p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">Active repairs</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{number(data.kpis.pending)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">Ready for pickup</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{number(data.kpis.awaitingPickup)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">Pending quote approvals</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {number(data.kpis.pendingApprovals)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 font-semibold dark:border-white/5">
              <span className="text-slate-800 dark:text-slate-200">Active technicians</span>
              <span className="text-slate-800 dark:text-slate-200">{number(data.kpis.activeTechnicians)}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
