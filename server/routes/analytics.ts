import { Router } from 'express'
import { prisma } from '../db'
import { requireAuth, requireOwner } from '../lib/auth'
import { asyncRoute, round2 } from '../lib/http'
import { ACTIVE_STATUSES, STATUS_LABELS } from '../lib/constants'
import {
  dayKey,
  daysBetween,
  monthKey,
  monthKeyMonthsAgo,
  parseDateRange,
  shiftMonthKey,
  startOfIstDay,
} from '../lib/dates'

export const analyticsRouter = Router()
analyticsRouter.use(requireAuth)

function countBy<T>(items: T[], key: (item: T) => string | null | undefined) {
  const map = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    if (!k) continue
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

function buildDailySeries(
  from: Date,
  to: Date,
  payments: Array<{ amount: number; paidAt: Date }>,
  createdRepairs: Array<{ createdAt: Date }>,
  completedRepairs: Array<{ completedAt: Date | null }>,
) {
  const start = startOfIstDay(from)
  const end = startOfIstDay(to)
  const dayCount = Math.min(90, Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1))
  const series: Array<{ date: string; revenue: number; repairs: number; completed: number }> = []
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start.getTime() + i * 86400000)
    const key = dayKey(d)
    series.push({ date: key, revenue: 0, repairs: 0, completed: 0 })
  }
  const byKey = new Map(series.map((s) => [s.date, s]))
  for (const p of payments) {
    const row = byKey.get(dayKey(p.paidAt))
    if (row) row.revenue = round2(row.revenue + p.amount)
  }
  for (const r of createdRepairs) {
    const row = byKey.get(dayKey(r.createdAt))
    if (row) row.repairs += 1
  }
  for (const r of completedRepairs) {
    if (!r.completedAt) continue
    const row = byKey.get(dayKey(r.completedAt))
    if (row) row.completed += 1
  }
  return series
}

function buildMonthlySeries(
  payments: Array<{ amount: number; paidAt: Date }>,
  completedRepairs: Array<{ completedAt: Date | null; parts: Array<{ unitCost: number; quantity: number }> }>,
  expenses: Array<{ amount: number; incurredAt: Date }>,
  incentives: Array<{ amount: number; createdAt: Date }>,
) {
  const months: Array<{ month: string; revenue: number; cost: number; profit: number }> = []
  for (let i = 11; i >= 0; i--) {
    months.push({ month: monthKeyMonthsAgo(i), revenue: 0, cost: 0, profit: 0 })
  }
  const byKey = new Map(months.map((m) => [m.month, m]))
  for (const p of payments) {
    const row = byKey.get(monthKey(p.paidAt))
    if (row) row.revenue = round2(row.revenue + p.amount)
  }
  for (const r of completedRepairs) {
    if (!r.completedAt) continue
    const row = byKey.get(monthKey(r.completedAt))
    if (row) row.cost = round2(row.cost + r.parts.reduce((s, p) => s + p.unitCost * p.quantity, 0))
  }
  for (const e of expenses) {
    const row = byKey.get(monthKey(e.incurredAt))
    if (row) row.cost = round2(row.cost + e.amount)
  }
  for (const i of incentives) {
    const row = byKey.get(monthKey(i.createdAt))
    if (row) row.cost = round2(row.cost + i.amount)
  }
  for (const m of months) m.profit = round2(m.revenue - m.cost)
  return months
}

type MonthSource = {
  status: string
  createdAt: Date
  completedAt: Date | null
  payments: Array<{ amount: number; paidAt: Date }>
  parts: Array<{ unitCost: number; quantity: number }>
}

const TERMINAL_REPAIR_STATUSES = ['COMPLETED', 'DELIVERED', 'CANCELLED']

/**
 * One month's figures. Repairs and completions are counted separately (a repair
 * created last month but completed this month counts once in each place), and
 * parts cost is only taken from repairs completed in the month, so revenue and
 * costs are never counted twice.
 */
function summarizeMonth(
  month: string,
  repairs: MonthSource[],
  expenses: Array<{ amount: number; incurredAt: Date }>,
  incentives: Array<{ amount: number; createdAt: Date }>,
) {
  const createdRepairs = repairs.filter((r) => monthKey(r.createdAt) === month)
  const created = createdRepairs.length
  const pending = createdRepairs.filter((r) => !TERMINAL_REPAIR_STATUSES.includes(r.status)).length
  const cancelled = createdRepairs.filter((r) => r.status === 'CANCELLED').length
  const completedRepairs = repairs.filter((r) => r.completedAt && monthKey(r.completedAt) === month)
  const revenue = round2(
    repairs.reduce(
      (sum, r) =>
        sum +
        r.payments
          .filter((p) => monthKey(p.paidAt) === month)
          .reduce((x, p) => x + p.amount, 0),
      0,
    ),
  )
  const partsCost = round2(
    completedRepairs.reduce(
      (sum, r) => sum + r.parts.reduce((x, p) => x + p.unitCost * p.quantity, 0),
      0,
    ),
  )
  const overhead = round2(
    expenses
      .filter((e) => monthKey(e.incurredAt) === month)
      .reduce((sum, e) => sum + e.amount, 0),
  )
  const incentiveTotal = round2(
    incentives
      .filter((i) => monthKey(i.createdAt) === month)
      .reduce((sum, i) => sum + i.amount, 0),
  )
  const expensesTotal = round2(partsCost + overhead + incentiveTotal)
  return {
    month,
    repairs: created,
    completed: completedRepairs.length,
    pending,
    cancelled,
    revenue,
    expenses: expensesTotal,
    partsCost,
    overhead,
    incentives: incentiveTotal,
    profit: round2(revenue - expensesTotal),
  }
}

analyticsRouter.get(
  '/overview',
  requireOwner,
  asyncRoute(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>)
    const now = new Date()

    const [
      repairsInRange,
      completedInRange,
      payments,
      expenses,
      incentives,
      activeCount,
      pickupCount,
      pendingApprovals,
      customerCount,
      newCustomers,
      techCount,
      allParts,
      customerRepairCounts,
      recentRepairs,
      allRepairs,
      allExpenses,
      allIncentives,
    ] = await Promise.all([
      prisma.repair.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        include: { device: true, customer: { select: { id: true, name: true } }, technician: { include: { user: true } } },
      }),
      prisma.repair.findMany({
        where: { completedAt: { gte: range.from, lte: range.to } },
        include: { parts: true },
      }),
      prisma.payment.findMany({
        where: { paidAt: { gte: range.from, lte: range.to } },
        select: { amount: true, paidAt: true, method: true, repairId: true },
      }),
      prisma.expense.findMany({
        where: { incurredAt: { gte: range.from, lte: range.to } },
      }),
      prisma.technicianIncentive.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
      }),
      prisma.repair.count({ where: { status: { in: ACTIVE_STATUSES as unknown as string[] } } }),
      prisma.repair.count({ where: { status: 'READY_FOR_PICKUP' } }),
      prisma.quotation.count({ where: { status: 'PENDING_OWNER' } }),
      prisma.customer.count(),
      prisma.customer.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
      prisma.technician.count({ where: { active: true } }),
      prisma.sparePart.findMany({ where: { active: true } }),
      prisma.repair.groupBy({ by: ['customerId'], _count: { _all: true } }),
      prisma.repair.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: { customer: { select: { name: true } }, device: true },
      }),
      // Whole-ledger reads power outstanding payments and the current vs
      // previous month comparison. They are separate from the range totals so
      // no figure is counted twice.
      prisma.repair.findMany({
        include: {
          payments: true,
          parts: { select: { unitCost: true, quantity: true } },
          quotations: { orderBy: { version: 'desc' }, take: 1 },
        },
      }),
      prisma.expense.findMany(),
      prisma.technicianIncentive.findMany(),
    ])

    const revenue = round2(payments.reduce((s, p) => s + p.amount, 0))
    const partsCost = round2(
      completedInRange.reduce(
        (s, r) => s + r.parts.reduce((x, p) => x + p.unitCost * p.quantity, 0),
        0,
      ),
    )
    const overhead = round2(expenses.reduce((s, e) => s + e.amount, 0))
    const incentiveTotal = round2(incentives.reduce((s, i) => s + i.amount, 0))
    const totalExpenses = round2(partsCost + overhead + incentiveTotal)
    const netProfit = round2(revenue - totalExpenses)
    const returningCustomers = customerRepairCounts.filter((c) => c._count._all > 1).length
    const lowStock = allParts.filter((p) => p.quantity <= p.minStock)

    // Outstanding = latest quoted total minus payments received, for every
    // repair that has not been cancelled. Revenue only counts actual payments,
    // so an unpaid balance is never also counted as income.
    const activeRepairs = allRepairs.filter((r) => r.status !== 'CANCELLED')
    const outstandingByRepair = activeRepairs.map((r) => {
      const quoted = r.quotations[0]?.customerTotal ?? 0
      const paid = r.payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)
      return Math.max(0, quoted - paid)
    })
    const outstanding = round2(outstandingByRepair.reduce((sum, value) => sum + value, 0))
    const outstandingRepairs = outstandingByRepair.filter((value) => value > 0.005).length

    // When the owner selects a historical month, the comparison follows that
    // month (selected vs the month before it) instead of always showing today.
    const requestedMonth = typeof req.query.month === 'string' ? req.query.month.trim() : ''
    const comparisonMonth = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : monthKey(now)
    const monthlyComparison = {
      current: summarizeMonth(comparisonMonth, allRepairs, allExpenses, allIncentives),
      previous: summarizeMonth(
        shiftMonthKey(comparisonMonth, -1),
        allRepairs,
        allExpenses,
        allIncentives,
      ),
    }

    const faults = countBy(
      repairsInRange.map((r) => r.confirmedFault).filter(Boolean) as string[],
      (v) => v.trim().slice(0, 80),
    )
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }))

    const mobileBrands = countBy(
      repairsInRange.filter((r) => ['Smartphone', 'Keypad Phone'].includes(r.device.category)),
      (r) => r.device.brand,
    ).slice(0, 6)
    const laptopBrands = countBy(
      repairsInRange.filter((r) => ['Laptop', 'Tablet'].includes(r.device.category)),
      (r) => r.device.brand,
    ).slice(0, 6)
    const categoryDistribution = countBy(repairsInRange, (r) => r.device.category).map(
      ([label, count]) => ({ label, count }),
    )

    // Parts used on repairs created in the selected range.
    const repairParts = await prisma.repairPart.findMany({
      where: { repair: { createdAt: { gte: range.from, lte: range.to } } },
      select: { name: true, quantity: true, unitCost: true },
    })
    const partTotals = new Map<string, { quantity: number; cost: number }>()
    for (const p of repairParts) {
      const current = partTotals.get(p.name) ?? { quantity: 0, cost: 0 }
      current.quantity += p.quantity
      current.cost = round2(current.cost + p.unitCost * p.quantity)
      partTotals.set(p.name, current)
    }
    const mostReplaced = [...partTotals.entries()]
      .map(([name, v]) => ({ name, count: v.quantity, cost: v.cost }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    const technicianRows = await prisma.technician.findMany({
      include: {
        user: true,
        repairs: {
          where: { createdAt: { gte: range.from, lte: range.to } },
          include: {
            payments: { where: { paidAt: { gte: range.from, lte: range.to } } },
            parts: true,
            quotations: { orderBy: { version: 'desc' }, take: 1 },
            feedback: true,
          },
        },
        incentives: { where: { createdAt: { gte: range.from, lte: range.to } } },
      },
    })

    const technicianComparison = technicianRows.map((t) => {
      const techRevenue = round2(
        t.repairs.reduce((s, r) => s + r.payments.reduce((x, p) => x + p.amount, 0), 0),
      )
      const techPartsCost = round2(
        t.repairs.reduce((s, r) => s + r.parts.reduce((x, p) => x + p.unitCost * p.quantity, 0), 0),
      )
      const techIncentive = round2(t.incentives.reduce((s, i) => s + i.amount, 0))
      const completed = t.repairs.filter((r) =>
        ['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'].includes(r.status),
      )
      const feedback = completed.map((r) => r.feedback).filter(Boolean)
      const durations = completed
        .filter((r) => r.completedAt)
        .map((r) => daysBetween(r.createdAt, r.completedAt as Date))
      return {
        id: t.id,
        name: t.user.name,
        assigned: t.repairs.length,
        completed: completed.length,
        revenue: techRevenue,
        partsCost: techPartsCost,
        incentives: techIncentive,
        contribution: round2(techRevenue - techPartsCost - techIncentive),
        avgRating: feedback.length
          ? round2(feedback.reduce((s, f) => s + (f?.rating ?? 0), 0) / feedback.length)
          : null,
        avgCompletionDays: durations.length
          ? round2(durations.reduce((s, d) => s + d, 0) / durations.length)
          : null,
      }
    })

    res.json({
      range: { from: range.from, to: range.to, period: range.period },
      kpis: {
        revenue,
        totalExpenses,
        netProfit,
        partsCost,
        overhead,
        incentives: incentiveTotal,
        repairs: repairsInRange.length,
        completed: completedInRange.length,
        cancelled: repairsInRange.filter((r) => r.status === 'CANCELLED').length,
        pending: activeCount,
        awaitingPickup: pickupCount,
        returningCustomers,
        newCustomers,
        totalCustomers: customerCount,
        retentionRate: customerCount ? round2((returningCustomers / customerCount) * 100) : 0,
        activeTechnicians: techCount,
        pendingApprovals,
        lowStockCount: lowStock.length,
        outstanding,
        outstandingRepairs,
        averageTicket: payments.length ? round2(revenue / Math.max(1, completedInRange.length)) : 0,
      },
      monthlyComparison,
      charts: {
        daily: buildDailySeries(range.from, range.to, payments, repairsInRange, completedInRange),
        monthly: buildMonthlySeries(
          await prisma.payment.findMany({
            where: { paidAt: { gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } },
            select: { amount: true, paidAt: true },
          }),
          await prisma.repair.findMany({
            where: { completedAt: { gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } },
            include: { parts: true },
          }),
          await prisma.expense.findMany({
            where: { incurredAt: { gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } },
          }),
          await prisma.technicianIncentive.findMany({
            where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } },
          }),
        ),
        categoryDistribution,
        mobileBrands: mobileBrands.map(([label, count]) => ({ label, count })),
        laptopBrands: laptopBrands.map(([label, count]) => ({ label, count })),
        commonFaults: faults,
        mostReplaced,
        technicianComparison,
        statusDistribution: countBy(repairsInRange, (r) => STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status).map(
          ([label, count]) => ({ label, count }),
        ),
      },
      inventory: {
        totalParts: allParts.length,
        totalUnits: allParts.reduce((s, p) => s + p.quantity, 0),
        lowStock: lowStock.length,
        outOfStock: allParts.filter((p) => p.quantity === 0).length,
        valueAtCost: round2(allParts.reduce((s, p) => s + p.purchasePrice * p.quantity, 0)),
        valueAtRetail: round2(allParts.reduce((s, p) => s + p.sellingPrice * p.quantity, 0)),
        lowStockItems: lowStock.slice(0, 8).map((p) => ({
          id: p.id,
          name: p.name,
          quantity: p.quantity,
          minStock: p.minStock,
        })),
      },
      recentRepairs: recentRepairs.map((r) => ({
        id: r.id,
        code: r.code,
        customer: r.customer.name,
        device: `${r.device.brand} ${r.device.model}`,
        status: r.status,
        createdAt: r.createdAt,
      })),
    })
  }),
)

analyticsRouter.get(
  '/me',
  asyncRoute(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>)
    const technicianId = req.user!.technicianId ?? '__none__'
    const repairs = await prisma.repair.findMany({
      where: { technicianId, createdAt: { gte: range.from, lte: range.to } },
      include: {
        customer: { select: { name: true } },
        device: true,
        payments: { where: { paidAt: { gte: range.from, lte: range.to } } },
        parts: true,
        quotations: { orderBy: { version: 'desc' }, take: 1 },
        feedback: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    const revenue = round2(repairs.reduce((s, r) => s + r.payments.reduce((x, p) => x + p.amount, 0), 0))
    const partsCost = round2(repairs.reduce((s, r) => s + r.parts.reduce((x, p) => x + p.unitCost * p.quantity, 0), 0))
    const completed = repairs.filter((r) => ['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'].includes(r.status))
    const feedback = completed.map((r) => r.feedback).filter(Boolean)
    const pending = repairs.filter((r) => (ACTIVE_STATUSES as readonly string[]).includes(r.status))
    res.json({
      range: { from: range.from, to: range.to, period: range.period },
      kpis: {
        assigned: repairs.length,
        pending: pending.length,
        completed: completed.length,
        revenue,
        partsCost,
        contribution: round2(revenue - partsCost),
        awaitingPickup: repairs.filter((r) => r.status === 'READY_FOR_PICKUP').length,
        avgRating: feedback.length
          ? round2(feedback.reduce((s, f) => s + (f?.rating ?? 0), 0) / feedback.length)
          : null,
        feedbackCount: feedback.length,
      },
      recentRepairs: repairs.slice(0, 8).map((r) => ({
        id: r.id,
        code: r.code,
        customer: r.customer.name,
        device: `${r.device.brand} ${r.device.model}`,
        status: r.status,
        createdAt: r.createdAt,
        quoteTotal: r.quotations[0]?.customerTotal ?? 0,
      })),
      statusDistribution: countBy(repairs, (r) => STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status).map(
        ([label, count]) => ({ label, count }),
      ),
    })
  }),
)

function csvEscape(value: unknown) {
  const s = value === null || value === undefined ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

analyticsRouter.get(
  '/export',
  requireOwner,
  asyncRoute(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>)
    const type = String(req.query.type ?? 'repairs')
    let header: string[] = []
    let rows: unknown[][] = []

    if (type === 'customers') {
      const customers = await prisma.customer.findMany({
        include: {
          repairs: { include: { payments: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      header = ['Customer ID', 'Name', 'Phone', 'Email', 'Repairs', 'Total Paid', 'Created']
      rows = customers.map((c) => [
        c.id,
        c.name,
        c.phone,
        c.email ?? '',
        c.repairs.length,
        round2(c.repairs.reduce((s, r) => s + r.payments.reduce((x, p) => x + p.amount, 0), 0)),
        c.createdAt.toISOString(),
      ])
    } else if (type === 'revenue') {
      const payments = await prisma.payment.findMany({
        where: { paidAt: { gte: range.from, lte: range.to } },
        include: { repair: { include: { customer: true } } },
        orderBy: { paidAt: 'desc' },
      })
      header = ['Payment ID', 'Repair Code', 'Customer', 'Amount', 'Method', 'Reference', 'Paid At']
      rows = payments.map((p) => [
        p.id,
        p.repair.code,
        p.repair.customer.name,
        p.amount,
        p.method,
        p.reference ?? '',
        p.paidAt.toISOString(),
      ])
    } else {
      const repairs = await prisma.repair.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        include: {
          customer: true,
          device: true,
          technician: { include: { user: true } },
          quotations: { orderBy: { version: 'desc' }, take: 1 },
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
      })
      header = [
        'Repair Code',
        'Status',
        'Customer',
        'Phone',
        'Device',
        'Category',
        'Problem',
        'Confirmed Fault',
        'Technician',
        'Quote Total',
        'Paid',
        'Created',
        'Completed',
      ]
      rows = repairs.map((r) => [
        r.code,
        r.status,
        r.customer.name,
        r.customer.phone,
        `${r.device.brand} ${r.device.model}`,
        r.device.category,
        r.problem,
        r.confirmedFault ?? '',
        r.technician?.user.name ?? '',
        r.quotations[0]?.customerTotal ?? 0,
        round2(r.payments.reduce((s, p) => s + p.amount, 0)),
        r.createdAt.toISOString(),
        r.completedAt?.toISOString() ?? '',
      ])
    }

    const csv = '\uFEFF' + [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')
    res.setHeader('content-type', 'text/csv; charset=utf-8')
    res.setHeader(
      'content-disposition',
      `attachment; filename="fixit-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
    )
    res.send(csv)
  }),
)
