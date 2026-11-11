import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireOwner } from '../lib/auth'
import { asyncRoute, HttpError, paginationDefaults, parse, round2 , param } from '../lib/http'
import { audit, notify } from '../lib/records'
import { PART_QUALITIES } from '../lib/constants'
import { buildExternalPartSearchLinks } from '../lib/onlineParts'

export const partsRouter = Router()
partsRouter.use(requireAuth)

function skuFor(category: string) {
  const prefix = category.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'PRT'
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
}

// The shop's purchase cost is owner-only financial data. A technician needs a
// part's name, stock and retail price to attach it to a repair, but must never
// receive the internal cost even through a direct API request.
function partView<T extends { purchasePrice?: number }>(part: T, role: string): Omit<T, 'purchasePrice'> | T {
  if (role === 'OWNER') return part
  const { purchasePrice: _purchasePrice, ...safe } = part
  return safe
}

const partSchema = z.object({
  name: z.string().trim().min(2, 'Enter the part name.').max(160),
  sku: z.string().trim().max(60).optional().or(z.literal('')),
  category: z.string().trim().min(2, 'Enter a category.').max(80),
  brand: z.string().trim().max(80).optional().or(z.literal('')),
  compatibleModels: z.string().trim().max(500).optional().or(z.literal('')),
  quality: z.enum(PART_QUALITIES).default('Compatible'),
  supplierId: z.string().optional().nullable(),
  purchasePrice: z.number().min(0).max(1000000).default(0),
  sellingPrice: z.number().min(0).max(1000000).default(0),
  quantity: z.number().int().min(0).max(100000).default(0),
  minStock: z.number().int().min(0).max(10000).default(2),
  location: z.string().trim().max(120).optional().or(z.literal('')),
})

const partUpdateSchema = partSchema.partial()

partsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { page, pageSize, skip } = paginationDefaults(req.query as Record<string, unknown>)
    const q = String(req.query.q ?? '').trim()
    const category = String(req.query.category ?? '').trim()
    const lowStock = String(req.query.lowStock ?? '') === 'true'
    const where: Record<string, unknown> = { active: true }
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { sku: { contains: q } },
        { compatibleModels: { contains: q } },
        { brand: { contains: q } },
      ]
    }
    if (category) where.category = category

    if (lowStock) {
      const all = await prisma.sparePart.findMany({
        where,
        include: { supplier: true },
        orderBy: { quantity: 'asc' },
      })
      const filtered = all.filter((p) => p.quantity <= p.minStock)
      res.json({
        items: filtered.slice(skip, skip + pageSize).map((p) => partView(p, req.user!.role)),
        total: filtered.length,
        page,
        pageSize,
      })
      return
    }

    const [total, items] = await Promise.all([
      prisma.sparePart.count({ where }),
      prisma.sparePart.findMany({
        where,
        include: { supplier: true },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ])
    res.json({ items: items.map((p) => partView(p, req.user!.role)), total, page, pageSize })
  }),
)

partsRouter.get(
  '/summary',
  requireOwner,
  asyncRoute(async (_req, res) => {
    const parts = await prisma.sparePart.findMany({ where: { active: true } })
    res.json({
      totalParts: parts.length,
      totalUnits: parts.reduce((s, p) => s + p.quantity, 0),
      lowStock: parts.filter((p) => p.quantity <= p.minStock).length,
      outOfStock: parts.filter((p) => p.quantity === 0).length,
      stockValueCost: round2(parts.reduce((s, p) => s + p.purchasePrice * p.quantity, 0)),
      stockValueRetail: round2(parts.reduce((s, p) => s + p.sellingPrice * p.quantity, 0)),
    })
  }),
)

partsRouter.get(
  '/catalog',
  asyncRoute(async (req, res) => {
    const items = await prisma.sparePart.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        sku: true,
        quality: true,
        compatibleModels: true,
        sellingPrice: true,
        purchasePrice: true,
        quantity: true,
        minStock: true,
      },
      orderBy: { name: 'asc' },
    })
    res.json({ items: items.map((p) => partView(p, req.user!.role)) })
  }),
)

partsRouter.get(
  '/transactions',
  requireOwner,
  asyncRoute(async (req, res) => {
    const { page, pageSize, skip } = paginationDefaults(req.query as Record<string, unknown>)
    const partId = String(req.query.partId ?? '').trim()
    const where: Record<string, unknown> = {}
    if (partId) where.partId = partId
    const [total, items] = await Promise.all([
      prisma.inventoryTransaction.count({ where }),
      prisma.inventoryTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          part: { select: { id: true, name: true, sku: true } },
          user: { select: { name: true } },
        },
      }),
    ])
    res.json({ items, total, page, pageSize })
  }),
)

partsRouter.get(
  '/suppliers',
  asyncRoute(async (_req, res) => {
    const items = await prisma.supplier.findMany({ orderBy: { name: 'asc' } })
    res.json({ items })
  }),
)

partsRouter.post(
  '/suppliers',
  requireOwner,
  asyncRoute(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        phone: z.string().trim().max(30).optional().or(z.literal('')),
        email: z.string().trim().email().optional().or(z.literal('')),
        website: z.string().trim().url().optional().or(z.literal('')),
        notes: z.string().trim().max(500).optional().or(z.literal('')),
      }),
      req.body,
    )
    const supplier = await prisma.supplier.create({
      data: {
        name: body.name,
        phone: body.phone || null,
        email: body.email || null,
        website: body.website || null,
        notes: body.notes || null,
      },
    })
    res.status(201).json({ supplier })
  }),
)

partsRouter.post(
  '/',
  requireOwner,
  asyncRoute(async (req, res) => {
    const body = parse(partSchema, req.body)
    if (body.supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: body.supplierId } })
      if (!supplier) throw new HttpError(400, 'Supplier not found.')
    }
    const part = await prisma.$transaction(async (tx) => {
      const created = await tx.sparePart.create({
        data: {
          sku: body.sku || skuFor(body.category),
          name: body.name,
          category: body.category,
          brand: body.brand || null,
          compatibleModels: body.compatibleModels || '',
          quality: body.quality,
          supplierId: body.supplierId || null,
          purchasePrice: body.purchasePrice,
          sellingPrice: body.sellingPrice,
          quantity: body.quantity,
          minStock: body.minStock,
          location: body.location || null,
        },
      })
      if (body.quantity > 0) {
        await tx.inventoryTransaction.create({
          data: {
            partId: created.id,
            type: 'IN',
            quantity: body.quantity,
            unitCost: body.purchasePrice,
            note: 'Opening stock',
            userId: req.user!.id,
          },
        })
      }
      return created
    })
    await audit({
      userId: req.user!.id,
      action: 'PART_CREATED',
      entity: 'SparePart',
      entityId: part.id,
      meta: { name: part.name, sku: part.sku, quantity: part.quantity },
      ip: req.ip,
    })
    res.status(201).json({ part })
  }),
)

partsRouter.patch(
  '/:id',
  requireOwner,
  asyncRoute(async (req, res) => {
    const body = parse(partUpdateSchema, req.body)
    const existing = await prisma.sparePart.findUnique({ where: { id: param(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Spare part not found.')

    // Quantity changes go through the stock endpoint so every movement is recorded.
    const { quantity, ...rest } = body
    const part = await prisma.sparePart.update({
      where: { id: existing.id },
      data: {
        ...(rest.name ? { name: rest.name } : {}),
        ...(rest.sku ? { sku: rest.sku } : {}),
        ...(rest.category ? { category: rest.category } : {}),
        ...(rest.brand !== undefined ? { brand: rest.brand || null } : {}),
        ...(rest.compatibleModels !== undefined
          ? { compatibleModels: rest.compatibleModels || '' }
          : {}),
        ...(rest.quality ? { quality: rest.quality } : {}),
        ...(rest.supplierId !== undefined ? { supplierId: rest.supplierId || null } : {}),
        ...(rest.purchasePrice !== undefined ? { purchasePrice: rest.purchasePrice } : {}),
        ...(rest.sellingPrice !== undefined ? { sellingPrice: rest.sellingPrice } : {}),
        ...(rest.minStock !== undefined ? { minStock: rest.minStock } : {}),
        ...(rest.location !== undefined ? { location: rest.location || null } : {}),
      },
    })
    if (quantity !== undefined && quantity !== existing.quantity) {
      const delta = quantity - existing.quantity
      await prisma.$transaction(async (tx) => {
        await tx.sparePart.update({ where: { id: part.id }, data: { quantity } })
        await tx.inventoryTransaction.create({
          data: {
            partId: part.id,
            type: 'ADJUST',
            quantity: delta,
            unitCost: part.purchasePrice,
            note: 'Manual quantity adjustment',
            userId: req.user!.id,
          },
        })
      })
    }
    await audit({
      userId: req.user!.id,
      action: 'PART_UPDATED',
      entity: 'SparePart',
      entityId: part.id,
      meta: Object.keys(body),
      ip: req.ip,
    })
    const updated = await prisma.sparePart.findUnique({ where: { id: part.id }, include: { supplier: true } })
    res.json({ part: updated })
  }),
)

partsRouter.delete(
  '/:id',
  requireOwner,
  asyncRoute(async (req, res) => {
    const part = await prisma.sparePart.findUnique({ where: { id: param(req, 'id') } })
    if (!part) throw new HttpError(404, 'Spare part not found.')
    await prisma.sparePart.update({ where: { id: part.id }, data: { active: false } })
    await audit({
      userId: req.user!.id,
      action: 'PART_DEACTIVATED',
      entity: 'SparePart',
      entityId: part.id,
      ip: req.ip,
    })
    res.json({ ok: true })
  }),
)

const stockSchema = z.object({
  type: z.enum(['IN', 'OUT', 'ADJUST']),
  quantity: z.number().int().min(1, 'Quantity must be at least 1.').max(100000),
  unitCost: z.number().min(0).max(1000000).optional(),
  note: z.string().trim().max(500).optional().or(z.literal('')),
})

partsRouter.post(
  '/:id/stock',
  requireOwner,
  asyncRoute(async (req, res) => {
    const part = await prisma.sparePart.findUnique({ where: { id: param(req, 'id') } })
    if (!part) throw new HttpError(404, 'Spare part not found.')
    const body = parse(stockSchema, req.body)
    let newQuantity = part.quantity
    if (body.type === 'IN') newQuantity += body.quantity
    if (body.type === 'OUT') {
      if (body.quantity > part.quantity) throw new HttpError(400, 'Cannot remove more stock than is available.')
      newQuantity -= body.quantity
    }
    if (body.type === 'ADJUST') newQuantity = body.quantity

    const [updated] = await prisma.$transaction(async (tx) => {
      const saved = await tx.sparePart.update({
        where: { id: part.id },
        data: { quantity: newQuantity },
      })
      await tx.inventoryTransaction.create({
        data: {
          partId: part.id,
          type: body.type === 'ADJUST' ? 'ADJUST' : body.type,
          quantity: body.type === 'OUT' ? -body.quantity : body.quantity,
          unitCost: body.unitCost ?? part.purchasePrice,
          note: body.note || `${body.type} stock movement`,
          userId: req.user!.id,
        },
      })
      return [saved]
    })
    if (updated.quantity <= updated.minStock) {
      await notify({
        role: 'OWNER',
        type: 'LOW_STOCK',
        title: `Low stock: ${updated.name}`,
        body: `${updated.quantity} left (minimum ${updated.minStock}).`,
        link: '/inventory',
      })
    }
    await audit({
      userId: req.user!.id,
      action: 'STOCK_MOVEMENT',
      entity: 'SparePart',
      entityId: part.id,
      meta: { type: body.type, quantity: body.quantity, newQuantity, note: body.note ?? null },
      ip: req.ip,
    })
    res.json({ part: updated })
  }),
)

// Online Spare-Parts Search & Discovery Engine
partsRouter.get(
  '/search-online',
  asyncRoute(async (req, res) => {
    const query = String(req.query.q ?? '').trim()
    const brand = String(req.query.brand ?? '').trim()
    const model = String(req.query.model ?? '').trim()
    const category = String(req.query.category ?? '').trim()

    const externalLinks = buildExternalPartSearchLinks({ query, brand, model, category })

    res.json({
      items: [],
      total: 0,
      externalLinks,
      providerConfigured: false,
      searchedAt: new Date().toISOString(),
      disclaimer:
        'No live marketplace price provider is configured, so FIXIT AI did not fetch or estimate any price, supplier or stock level. Use the external search links to verify a real listing, then record the exact purchase cost manually. Nothing is purchased automatically.',
    })
  }),
)

// 1-Click Import of Online Discovered Part into Shop Inventory
partsRouter.post(
  '/import-from-online',
  asyncRoute(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2),
        category: z.string().trim().min(2),
        brand: z.string().trim().optional(),
        compatibleModels: z.string().trim().optional(),
        quality: z.string().default('Compatible'),
        supplierName: z.string().trim().min(1),
        purchasePrice: z.number().min(0),
        sellingPrice: z.number().min(0),
        quantity: z.number().int().min(0).default(1),
        minStock: z.number().int().min(0).default(2),
        location: z.string().trim().optional(),
      }),
      req.body,
    )

    // Find or create supplier
    let supplier = await prisma.supplier.findFirst({
      where: { name: { contains: body.supplierName } },
    })
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: {
          name: body.supplierName,
          notes: 'Auto-created from online spare parts discovery engine',
        },
      })
    }

    const sku = skuFor(body.category)
    const part = await prisma.$transaction(async (tx) => {
      const created = await tx.sparePart.create({
        data: {
          sku,
          name: body.name,
          category: body.category,
          brand: body.brand || null,
          compatibleModels: body.compatibleModels || '',
          quality: body.quality,
          supplierId: supplier.id,
          purchasePrice: body.purchasePrice,
          sellingPrice: body.sellingPrice > 0 ? body.sellingPrice : round2(body.purchasePrice * 1.35), // Default 35% margin
          quantity: body.quantity,
          minStock: body.minStock,
          location: body.location || 'Bin A-1',
        },
        include: { supplier: true },
      })

      if (body.quantity > 0) {
        await tx.inventoryTransaction.create({
          data: {
            partId: created.id,
            type: 'IN',
            quantity: body.quantity,
            unitCost: body.purchasePrice,
            note: `Imported from ${body.supplierName} catalog`,
            userId: req.user!.id,
          },
        })
      }
      return created
    })

    await audit({
      userId: req.user!.id,
      action: 'ONLINE_PART_IMPORTED',
      entity: 'SparePart',
      entityId: part.id,
      meta: { name: part.name, supplier: body.supplierName, price: body.purchasePrice },
      ip: req.ip,
    })

    res.status(201).json({ part, message: `Successfully added ${part.name} to shop inventory!` })
  }),
)

