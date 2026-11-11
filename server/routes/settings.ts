import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireOwner } from '../lib/auth'
import { asyncRoute, HttpError, paginationDefaults, parse, round2 , param } from '../lib/http'
import { audit } from '../lib/records'
import { parseDateRange } from '../lib/dates'
import { config } from '../env'
import { gateway, sheetsConfigured } from '../sheets/runtime'

export const settingsRouter = Router()
settingsRouter.use(requireAuth)

async function getShop() {
  const existing = await prisma.shop.findFirst()
  if (existing) return existing
  return prisma.shop.create({ data: { id: 'shop' } })
}

settingsRouter.get(
  '/',
  requireOwner,
  asyncRoute(async (_req, res) => {
    const shop = await getShop()
    const [counts, lowStock] = await Promise.all([
      prisma.$transaction([
        prisma.repair.count(),
        prisma.repair.count({ where: { isDemo: true } }),
        prisma.customer.count(),
        prisma.customer.count({ where: { isDemo: true } }),
        prisma.sparePart.count(),
        prisma.sparePart.count({ where: { isDemo: true } }),
        prisma.user.count(),
      ]),
      prisma.sparePart.findMany({ where: { active: true } }).then((parts) => parts.filter((p) => p.quantity <= p.minStock).length),
    ])
    res.json({
      shop,
      counts: {
        repairs: counts[0],
        demoRepairs: counts[1],
        customers: counts[2],
        demoCustomers: counts[3],
        parts: counts[4],
        demoParts: counts[5],
        users: counts[6],
        lowStock,
      },
      storage: {
        type: 'google-sheets',
        configured: sheetsConfigured(),
        timezone: config.sheetsTimezone,
      },
    })
  }),
)

// Owner-only backup: the Apps Script gateway copies the whole spreadsheet into
// the owner's Google Drive. No database dump or secret ever leaves Google.
settingsRouter.post(
  '/backup',
  requireOwner,
  asyncRoute(async (req, res) => {
    if (!sheetsConfigured()) {
      throw new HttpError(
        503,
        'Google Sheets is not configured, so a backup cannot be created yet.',
        { code: 'SHEETS_NOT_CONFIGURED' },
      )
    }
    const backup = await gateway.backup()
    await audit({
      userId: req.user!.id,
      action: 'SPREADSHEET_BACKUP_CREATED',
      entity: 'System',
      entityId: backup.fileId,
      meta: { name: backup.name },
      ip: req.ip,
    })
    res.status(201).json({
      backup,
      message: 'A complete copy of the spreadsheet was saved to Google Drive.',
    })
  }),
)

const shopSchema = z.object({
  name: z.string().trim().min(2, 'Enter the shop name.').max(140),
  legalName: z.string().trim().max(140).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
  address: z.string().trim().max(400).optional().or(z.literal('')),
  gstin: z.string().trim().max(30).optional().or(z.literal('')),
  logoPath: z.string().trim().max(500).optional().or(z.literal('')),
  taxRate: z.number().min(0).max(50).default(0),
  ownerApprovalThreshold: z.number().min(0).max(10000000).default(0),
  lowStockAlerts: z.boolean().default(true),
})

settingsRouter.patch(
  '/',
  requireOwner,
  asyncRoute(async (req, res) => {
    const body = parse(shopSchema.partial(), req.body)
    const shop = await getShop()
    const updated = await prisma.shop.update({
      where: { id: shop.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.legalName !== undefined ? { legalName: body.legalName || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.address !== undefined ? { address: body.address || null } : {}),
        ...(body.gstin !== undefined ? { gstin: body.gstin || null } : {}),
        ...(body.logoPath !== undefined ? { logoPath: body.logoPath || null } : {}),
        ...(body.taxRate !== undefined ? { taxRate: body.taxRate } : {}),
        ...(body.ownerApprovalThreshold !== undefined
          ? { ownerApprovalThreshold: body.ownerApprovalThreshold }
          : {}),
        ...(body.lowStockAlerts !== undefined ? { lowStockAlerts: body.lowStockAlerts } : {}),
      },
    })
    await audit({
      userId: req.user!.id,
      action: 'SHOP_SETTINGS_UPDATED',
      entity: 'Shop',
      entityId: shop.id,
      meta: Object.keys(body),
      ip: req.ip,
    })
    res.json({ shop: updated })
  }),
)

settingsRouter.get(
  '/audit',
  requireOwner,
  asyncRoute(async (req, res) => {
    const { page, pageSize, skip } = paginationDefaults(req.query as Record<string, unknown>)
    const [total, items] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { user: { select: { name: true, role: true } } },
      }),
    ])
    res.json({ items, total, page, pageSize })
  }),
)

// ---- expenses ----

settingsRouter.get(
  '/expenses',
  requireOwner,
  asyncRoute(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>)
    const expenses = await prisma.expense.findMany({
      where: { incurredAt: { gte: range.from, lte: range.to } },
      orderBy: { incurredAt: 'desc' },
      include: { repair: { select: { code: true } }, createdBy: { select: { name: true } } },
    })
    res.json({
      items: expenses,
      total: round2(expenses.reduce((s, e) => s + e.amount, 0)),
      range: { from: range.from, to: range.to, period: range.period },
    })
  }),
)

settingsRouter.post(
  '/expenses',
  requireOwner,
  asyncRoute(async (req, res) => {
    const body = parse(
      z.object({
        category: z.string().trim().min(2).max(80),
        amount: z.number().positive('Enter an amount greater than zero.').max(10000000),
        note: z.string().trim().max(500).optional().or(z.literal('')),
        incurredAt: z.string().datetime().optional(),
        repairId: z.string().optional().or(z.literal('')),
      }),
      req.body,
    )
    const expense = await prisma.expense.create({
      data: {
        category: body.category,
        amount: round2(body.amount),
        note: body.note || null,
        incurredAt: body.incurredAt ? new Date(body.incurredAt) : new Date(),
        repairId: body.repairId || null,
        createdById: req.user!.id,
      },
    })
    await audit({
      userId: req.user!.id,
      action: 'EXPENSE_RECORDED',
      entity: 'Expense',
      entityId: expense.id,
      meta: { category: expense.category, amount: expense.amount },
      ip: req.ip,
    })
    res.status(201).json({ expense })
  }),
)

settingsRouter.delete(
  '/expenses/:id',
  requireOwner,
  asyncRoute(async (req, res) => {
    const expense = await prisma.expense.findUnique({ where: { id: param(req, 'id') } })
    if (!expense) {
      res.status(404).json({ error: 'Expense not found.' })
      return
    }
    await prisma.expense.delete({ where: { id: expense.id } })
    await audit({
      userId: req.user!.id,
      action: 'EXPENSE_DELETED',
      entity: 'Expense',
      entityId: expense.id,
      meta: { category: expense.category, amount: expense.amount },
      ip: req.ip,
    })
    res.json({ ok: true })
  }),
)

// ---- demo data ----

settingsRouter.post(
  '/demo/purge',
  requireOwner,
  asyncRoute(async (req, res) => {
    const confirmation = String(req.body?.confirmation ?? '')
    if (confirmation !== 'DELETE DEMO DATA') {
      res.status(400).json({ error: 'Type "DELETE DEMO DATA" to confirm.' })
      return
    }
    const demoRepairs = await prisma.repair.findMany({ where: { isDemo: true }, select: { id: true } })
    const repairIds = demoRepairs.map((r) => r.id)
    const result = await prisma.$transaction(async (tx) => {
      const deletedRepairs = await tx.repair.deleteMany({ where: { id: { in: repairIds } } })
      const deletedDevices = await tx.device.deleteMany({ where: { isDemo: true } })
      const deletedCustomers = await tx.customer.deleteMany({ where: { isDemo: true } })
      const deletedParts = await tx.sparePart.deleteMany({ where: { isDemo: true } })
      const deletedSuppliers = await tx.supplier.deleteMany({ where: { isDemo: true } })
      const deletedExpenses = await tx.expense.deleteMany({ where: { isDemo: true } })
      return {
        repairs: deletedRepairs.count,
        devices: deletedDevices.count,
        customers: deletedCustomers.count,
        parts: deletedParts.count,
        suppliers: deletedSuppliers.count,
        expenses: deletedExpenses.count,
      }
    })
    await audit({
      userId: req.user!.id,
      action: 'DEMO_DATA_PURGED',
      entity: 'System',
      meta: result,
      ip: req.ip,
    })
    res.json({ ok: true, deleted: result })
  }),
)
