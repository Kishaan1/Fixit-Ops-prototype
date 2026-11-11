import { Router } from 'express'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth } from '../lib/auth'
import type { AuthUser } from '../lib/auth'
import {
  asyncRoute,
  HttpError,
  normalizePhone,
  paginationDefaults,
  param,
  parse,
  round2,
} from '../lib/http'
import {
  ACTIVE_STATUSES,
  canTransition,
  PART_QUALITIES,
  PRICE_SOURCES,
  PRIORITIES,
  REPAIR_STATUSES,
  REPORTABLE_STATUSES,
  nextStatuses,
} from '../lib/constants'
import { audit, nextRepairCode, notify } from '../lib/records'
import { computeQuote, sumPayments } from '../lib/money'
import { aiDiagnose, localChecklist } from '../lib/diagnosis'
import { publishReport } from '../lib/report'
import { parseDateRange } from '../lib/dates'
import { isStoredImageId } from '../lib/images'

export const repairsRouter = Router()
repairsRouter.use(requireAuth)

function techWhere(user: AuthUser) {
  return user.role === 'OWNER' ? {} : { technicianId: user.technicianId ?? '__none__' }
}

async function getRepair(id: string, user: AuthUser) {
  const repair = await prisma.repair.findUnique({
    where: { id },
    include: {
      customer: true,
      device: true,
      technician: { include: { user: true } },
      createdBy: { select: { id: true, name: true, role: true } },
      diagnostics: { orderBy: { createdAt: 'desc' } },
      activities: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true, role: true } } } },
      parts: { orderBy: { createdAt: 'asc' }, include: { addedBy: { select: { name: true } } } },
      quotations: {
        orderBy: { version: 'desc' },
        include: {
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
      },
      payments: { orderBy: { paidAt: 'desc' }, include: { recordedBy: { select: { name: true } } } },
      report: true,
      warranty: true,
      feedback: true,
      images: {
        orderBy: { createdAt: 'desc' },
        include: { uploadedBy: { select: { id: true, name: true } } },
      },
    },
  })
  if (!repair) throw new HttpError(404, 'Repair not found.')
  if (user.role !== 'OWNER' && repair.technicianId !== user.technicianId) {
    throw new HttpError(403, 'This repair is not assigned to you.')
  }
  return repair
}

function moneySummary(repair: {
  parts: Array<{ unitPrice: number; unitCost: number; quantity: number }>
  payments: Array<{ amount: number }>
  quotations: Array<{ customerTotal: number; status: string; version: number }>
}) {
  const approved = repair.quotations.find((q) => q.status === 'APPROVED')
  const latest = repair.quotations[0]
  const partsCharged = round2(repair.parts.reduce((s, p) => s + p.unitPrice * p.quantity, 0))
  const partsCost = round2(repair.parts.reduce((s, p) => s + p.unitCost * p.quantity, 0))
  const paid = sumPayments(repair.payments)
  const quotedTotal = approved?.customerTotal ?? latest?.customerTotal ?? partsCharged
  return {
    partsCharged,
    partsCost,
    paidTotal: paid,
    balance: round2(Math.max(0, quotedTotal - paid)),
    quotedTotal,
    hasApprovedQuote: Boolean(approved),
  }
}

// Owner-only cost and margin fields. Technicians need customer-facing totals to
// do their job, but internal purchase cost, profit and incentives must never
// reach a technician session, even through a direct API request.
const OWNER_ONLY_QUOTE_FIELDS = [
  'estimatedPartsCost',
  'actualPartsCost',
  'otherCost',
  'technicianIncentive',
  'netProfit',
] as const

function quoteView(quote: any, user: AuthUser) {
  if (!quote || user.role === 'OWNER') return quote
  const copy = { ...quote }
  for (const field of OWNER_ONLY_QUOTE_FIELDS) delete copy[field]
  return copy
}

function repairView(repair: any, user: AuthUser) {
  if (!repair || user.role === 'OWNER') return repair
  return {
    ...repair,
    parts: Array.isArray(repair.parts)
      ? repair.parts.map((part: any) => {
          const copy = { ...part }
          delete copy.unitCost
          return copy
        })
      : repair.parts,
    quotations: Array.isArray(repair.quotations)
      ? repair.quotations.map((quote: any) => quoteView(quote, user))
      : repair.quotations,
  }
}

function moneyView(repair: Parameters<typeof moneySummary>[0], user: AuthUser) {
  const summary = moneySummary(repair)
  if (user.role === 'OWNER') return summary
  const { partsCost, ...safe } = summary
  return safe
}

const createSchema = z.object({
  customerId: z.string().optional(),
  customer: z
    .object({
      name: z.string().trim().min(2, 'Enter the customer name.').max(120),
      phone: z.string().trim().min(7, 'Enter a valid phone number.').max(20),
      email: z.string().trim().email().optional().or(z.literal('')),
      address: z.string().trim().max(300).optional().or(z.literal('')),
    })
    .optional(),
  device: z.object({
    category: z.enum(['Smartphone', 'Laptop', 'Tablet', 'Keypad Phone', 'Other']),
    brand: z.string().trim().min(1, 'Enter the device brand.').max(80),
    model: z.string().trim().min(1, 'Enter the device model.').max(120),
    imei: z.string().trim().max(40).optional().or(z.literal('')),
    serialNumber: z.string().trim().max(80).optional().or(z.literal('')),
    color: z.string().trim().max(40).optional().or(z.literal('')),
    accessories: z.string().trim().max(200).optional().or(z.literal('')),
    conditionNotes: z.string().trim().max(1000).optional().or(z.literal('')),
    imagePath: z.string().trim().optional().or(z.literal('')),
  }),
  problem: z.string().trim().min(5, 'Describe the reported problem.').max(3000),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  technicianId: z.string().optional().nullable(),
  // Generated once per intake form. Re-sending the same key returns the
  // already-created repair instead of creating a second one.
  clientRequestId: z.string().trim().min(8).max(120).optional(),
})

function requestIdFor(prefix: string, seed: string) {
  return `c${createHash('sha256').update(`${prefix}:${seed}`).digest('hex').slice(0, 24)}`
}

repairsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { page, pageSize, skip } = paginationDefaults(req.query as Record<string, unknown>)
    const range = parseDateRange(req.query as Record<string, unknown>)
    const statusParam = String(req.query.status ?? '').trim()
    const statuses = statusParam
      ? statusParam.split(',').filter((s) => (REPAIR_STATUSES as readonly string[]).includes(s))
      : []
    const q = String(req.query.q ?? '').trim()
    const technicianIdQ = String(req.query.technicianId ?? '').trim()
    const priority = String(req.query.priority ?? '').trim()

    const where: Record<string, unknown> = {
      ...techWhere(req.user!),
      createdAt: { gte: range.from, lte: range.to },
    }
    if (statuses.length) where.status = { in: statuses }
    if (priority) where.priority = priority
    if (req.user!.role === 'OWNER' && technicianIdQ) {
      where.technicianId = technicianIdQ === 'unassigned' ? null : technicianIdQ
    }
    if (q) {
      where.OR = [
        { code: { contains: q } },
        { problem: { contains: q } },
        { customer: { name: { contains: q } } },
        { customer: { phone: { contains: q } } },
        { device: { brand: { contains: q } } },
        { device: { model: { contains: q } } },
      ]
    }

    const [total, repairs] = await Promise.all([
      prisma.repair.count({ where }),
      prisma.repair.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          device: true,
          technician: { include: { user: { select: { name: true } } } },
          quotations: { orderBy: { version: 'desc' }, take: 1 },
          payments: { select: { amount: true } },
          parts: { select: { quantity: true } },
          feedback: { select: { rating: true } },
        },
      }),
    ])

    res.json({
      items: repairs.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        priority: r.priority,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        problem: r.problem,
        customer: r.customer,
        device: { category: r.device.category, brand: r.device.brand, model: r.device.model },
        technician: r.technician
          ? { id: r.technician.id, name: r.technician.user.name }
          : null,
        quoteTotal: r.quotations[0]?.customerTotal ?? 0,
        quoteStatus: r.quotations[0]?.status ?? null,
        paidTotal: round2(r.payments.reduce((s, p) => s + p.amount, 0)),
        partsCount: r.parts.reduce((s, p) => s + p.quantity, 0),
        rating: r.feedback?.rating ?? null,
      })),
      total,
      page,
      pageSize,
      range: { from: range.from, to: range.to, period: range.period },
    })
  }),
)

repairsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = parse(createSchema, req.body)

    // A double-click or an automatic retry must not create a second repair.
    // The browser sends one clientRequestId per intake form, so the second
    // submission resolves to the same deterministic row.
    const idSeed = body.clientRequestId
      ? `${req.user!.id}:${body.clientRequestId}`
      : null
    const requestedRepairId = idSeed ? requestIdFor('repair', idSeed) : null
    const requestedDeviceId = idSeed ? requestIdFor('device', idSeed) : null
    if (requestedRepairId) {
      const existingRepair = await prisma.repair.findUnique({
        where: { id: requestedRepairId },
        include: { customer: true, device: true, technician: { include: { user: true } } },
      })
      if (existingRepair) {
        res.status(200).json({ repair: repairView(existingRepair, req.user!), duplicate: true })
        return
      }
    }

    let customer =
      body.customerId != null
        ? await prisma.customer.findUnique({ where: { id: body.customerId } })
        : null

    if (body.customerId && !customer) throw new HttpError(404, 'Customer not found.')

    if (!customer) {
      if (!body.customer) throw new HttpError(400, 'Select a customer or enter their details.')
      const phone = normalizePhone(body.customer.phone)
      if (phone.length < 7) throw new HttpError(400, 'Enter a valid phone number.')
      customer = await prisma.customer.upsert({
        where: { phone },
        create: {
          name: body.customer.name,
          phone,
          email: body.customer.email || null,
          address: body.customer.address || null,
          createdById: req.user!.id,
        },
        update: {},
      })
    }

    let technicianId: string | null = null
    if (req.user!.role === 'OWNER') {
      if (body.technicianId) {
        const tech = await prisma.technician.findUnique({
          where: { id: body.technicianId },
          include: { user: true },
        })
        if (!tech || !tech.active || !tech.user.active) {
          throw new HttpError(400, 'Select an active technician.')
        }
        technicianId = tech.id
      }
    } else {
      if (!req.user!.technicianId) throw new HttpError(403, 'Your technician profile is not linked.')
      technicianId = req.user!.technicianId
    }

    const code = await nextRepairCode()
    const deviceData = {
      customerId: customer.id,
      category: body.device.category,
      brand: body.device.brand,
      model: body.device.model,
      imei: body.device.imei || null,
      serialNumber: body.device.serialNumber || null,
      color: body.device.color || null,
      accessories: body.device.accessories || null,
      conditionNotes: body.device.conditionNotes || null,
      imagePath:
        body.device.imagePath && isStoredImageId(body.device.imagePath)
          ? body.device.imagePath
          : null,
      createdById: req.user!.id,
    }
    const device = requestedDeviceId
      ? await prisma.device.upsert({
          where: { id: requestedDeviceId },
          create: { id: requestedDeviceId, ...deviceData },
          update: {},
        })
      : await prisma.device.create({ data: deviceData })
    let repair
    try {
      repair = await prisma.repair.create({
        data: {
          ...(requestedRepairId ? { id: requestedRepairId } : {}),
          code,
          customerId: customer.id,
          deviceId: device.id,
          technicianId,
          createdById: req.user!.id,
          status: 'NEW_REQUEST',
          priority: body.priority,
          problem: body.problem,
          warrantyDays: 0,
          activities: {
            create: {
              userId: req.user!.id,
              type: 'STATUS',
              note: 'Repair request created',
              meta: JSON.stringify({ status: 'NEW_REQUEST' }),
            },
          },
        },
        include: { customer: true, device: true, technician: { include: { user: true } } },
      })
    } catch (err) {
      // A simultaneous duplicate may have won the race after our first check.
      if (requestedRepairId && (err as { code?: string }).code === 'P2002') {
        const existingRepair = await prisma.repair.findUnique({
          where: { id: requestedRepairId },
          include: { customer: true, device: true, technician: { include: { user: true } } },
        })
        if (existingRepair) {
          res.status(200).json({ repair: repairView(existingRepair, req.user!), duplicate: true })
          return
        }
      }
      throw err
    }

    await audit({
      userId: req.user!.id,
      action: 'REPAIR_CREATED',
      entity: 'Repair',
      entityId: repair.id,
      meta: { code: repair.code },
      ip: req.ip,
    })

    if (technicianId && technicianId !== req.user!.technicianId) {
      const tech = await prisma.technician.findUnique({ where: { id: technicianId } })
      if (tech) {
        await notify({
          userId: tech.userId,
          type: 'ASSIGNMENT',
          title: `New repair assigned: ${repair.code}`,
          body: `${customer.name} — ${repair.device.brand} ${repair.device.model}`,
          link: `/repairs/${repair.id}`,
        })
      }
    }
    await notify({
      role: 'OWNER',
      type: 'REPAIR',
      title: `New repair ${repair.code}`,
      body: `${customer.name} — ${repair.device.brand} ${repair.device.model}`,
      link: `/repairs/${repair.id}`,
    })

    res.status(201).json({ repair: repairView(repair, req.user!) })
  }),
)

repairsRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    res.json({
      repair: repairView(repair, req.user!),
      money: moneyView(repair, req.user!),
      allowedStatuses: nextStatuses(repair.status, req.user!.role),
    })
  }),
)

const REPAIR_IMAGE_KINDS = ['BEFORE', 'AFTER', 'EVIDENCE'] as const

const repairImageSchema = z.object({
  imagePath: z.string().trim().refine(isStoredImageId, 'Upload a JPG, PNG or WEBP image first.'),
  kind: z.enum(REPAIR_IMAGE_KINDS),
  caption: z.string().trim().max(240).optional().or(z.literal('')),
})

repairsRouter.get(
  '/:id/images',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    const images = await prisma.repairImage.findMany({
      where: { repairId: repair.id },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true } } },
    })
    res.json({ images })
  }),
)

repairsRouter.post(
  '/:id/images',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    const body = parse(repairImageSchema, req.body)
    const image = await prisma.repairImage.create({
      data: {
        repairId: repair.id,
        imagePath: body.imagePath,
        kind: body.kind,
        caption: body.caption || null,
        uploadedById: req.user!.id,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    })
    await audit({
      userId: req.user!.id,
      action: 'repair.image.add',
      entity: 'Repair',
      entityId: repair.id,
      meta: { imageId: image.id, kind: image.kind },
      ip: req.ip,
    })
    res.status(201).json({ image })
  }),
)

repairsRouter.delete(
  '/:id/images/:imageId',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    const image = await prisma.repairImage.findFirst({
      where: { id: param(req, 'imageId'), repairId: repair.id },
    })
    if (!image) throw new HttpError(404, 'Image not found for this repair.')
    await prisma.repairImage.delete({ where: { id: image.id } })
    await audit({
      userId: req.user!.id,
      action: 'repair.image.remove',
      entity: 'Repair',
      entityId: repair.id,
      meta: { imageId: image.id, kind: image.kind },
      ip: req.ip,
    })
    res.json({ ok: true })
  }),
)

const patchSchema = z.object({
  problem: z.string().trim().min(5).max(3000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  internalNotes: z.string().trim().max(4000).optional().or(z.literal('')),
  confirmedFault: z.string().trim().max(3000).optional().or(z.literal('')),
  repairProcedure: z.string().trim().max(6000).optional().or(z.literal('')),
  testingResults: z.string().trim().max(3000).optional().or(z.literal('')),
  finalCondition: z.string().trim().max(3000).optional().or(z.literal('')),
  warrantyDays: z.number().int().min(0).max(3650).optional(),
  warrantyTerms: z.string().trim().max(2000).optional().or(z.literal('')),
  estimatedCompletion: z.string().datetime().nullable().optional().or(z.literal('')),
  technicianId: z.string().nullable().optional(),
})

repairsRouter.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const existing = await getRepair(param(req, 'id'), req.user!)
    const body = parse(patchSchema, req.body)

    if (body.technicianId !== undefined && req.user!.role !== 'OWNER') {
      throw new HttpError(403, 'Only the owner can reassign a repair.')
    }
    if (body.technicianId) {
      const tech = await prisma.technician.findUnique({
        where: { id: body.technicianId },
        include: { user: true },
      })
      if (!tech || !tech.active || !tech.user.active) throw new HttpError(400, 'Select an active technician.')
    }

    const data: Record<string, unknown> = {}
    for (const key of [
      'problem',
      'priority',
      'internalNotes',
      'confirmedFault',
      'repairProcedure',
      'testingResults',
      'finalCondition',
      'warrantyDays',
      'warrantyTerms',
    ] as const) {
      if (body[key] !== undefined) data[key] = body[key] === '' ? null : body[key]
    }
    if (body.estimatedCompletion !== undefined) {
      data.estimatedCompletion = body.estimatedCompletion ? new Date(body.estimatedCompletion) : null
    }
    if (body.technicianId !== undefined) data.technicianId = body.technicianId || null

    const repair = await prisma.repair.update({
      where: { id: existing.id },
      data,
      include: { customer: true, device: true, technician: { include: { user: true } } },
    })

    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: body.technicianId !== undefined ? 'ASSIGNMENT' : 'NOTE',
        note:
          body.technicianId !== undefined
            ? `Technician assignment updated`
            : 'Repair details updated by technician',
      },
    })

    if (
      body.technicianId !== undefined &&
      body.technicianId &&
      body.technicianId !== existing.technicianId
    ) {
      const tech = await prisma.technician.findUnique({ where: { id: body.technicianId } })
      if (tech) {
        await notify({
          userId: tech.userId,
          type: 'ASSIGNMENT',
          title: `Repair assigned: ${repair.code}`,
          body: `${repair.customer.name} — ${repair.device.brand} ${repair.device.model}`,
          link: `/repairs/${repair.id}`,
        })
      }
    }

    await audit({
      userId: req.user!.id,
      action: 'REPAIR_UPDATED',
      entity: 'Repair',
      entityId: repair.id,
      meta: Object.keys(body),
      ip: req.ip,
    })

    const full = await getRepair(repair.id, req.user!)
    res.json({
      repair: repairView(full, req.user!),
      money: moneyView(full, req.user!),
      allowedStatuses: nextStatuses(full.status, req.user!.role),
    })
  }),
)

const statusSchema = z.object({
  status: z.enum(REPAIR_STATUSES),
  note: z.string().trim().max(1000).optional(),
  warrantyDays: z.number().int().min(0).max(3650).optional(),
  warrantyTerms: z.string().trim().max(2000).optional(),
  repairProcedure: z.string().trim().max(6000).optional(),
  testingResults: z.string().trim().max(3000).optional(),
})

repairsRouter.post(
  '/:id/status',
  asyncRoute(async (req, res) => {
    const existing = await getRepair(param(req, 'id'), req.user!)
    const body = parse(statusSchema, req.body)
    if (existing.status === body.status) throw new HttpError(400, 'This is already the current status.')
    if (!canTransition(existing.status, body.status, req.user!.role)) {
      throw new HttpError(400, `Cannot move a repair from ${existing.status} to ${body.status}.`, {
        code: 'INVALID_TRANSITION',
        details: { allowed: nextStatuses(existing.status, req.user!.role) },
      })
    }

    const now = new Date()
    const data: Record<string, unknown> = {
      status: body.status,
      ...(body.warrantyDays !== undefined ? { warrantyDays: body.warrantyDays } : {}),
      ...(body.warrantyTerms !== undefined ? { warrantyTerms: body.warrantyTerms } : {}),
      ...(body.repairProcedure !== undefined ? { repairProcedure: body.repairProcedure } : {}),
      ...(body.testingResults !== undefined ? { testingResults: body.testingResults } : {}),
    }
    if (['COMPLETED', 'READY_FOR_PICKUP'].includes(body.status) && !existing.completedAt) {
      data.completedAt = now
    }
    if (body.status === 'DELIVERED') {
      data.completedAt = existing.completedAt ?? now
      data.deliveredAt = now
    }
    if (body.status === 'CANCELLED') data.cancelledAt = now

    let updated = await prisma.repair.update({
      where: { id: existing.id },
      data,
      include: {
        technician: { include: { user: true } },
        quotations: { orderBy: { version: 'desc' }, take: 1 },
        customer: true,
        device: true,
      },
    })

    await prisma.repairActivity.create({
      data: {
        repairId: updated.id,
        userId: req.user!.id,
        type: 'STATUS',
        note: body.note?.trim()
          ? `Status changed to ${body.status}: ${body.note.trim()}`
          : `Status changed to ${body.status}`,
        meta: JSON.stringify({ from: existing.status, to: body.status }),
      },
    })

    // Warranty record is created when the repair is marked complete.
    if (['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'].includes(body.status) && updated.warrantyDays > 0) {
      const start = updated.completedAt ?? now
      const end = new Date(start.getTime() + updated.warrantyDays * 24 * 60 * 60 * 1000)
      await prisma.warrantyRecord.upsert({
        where: { repairId: updated.id },
        create: {
          repairId: updated.id,
          days: updated.warrantyDays,
          startDate: start,
          endDate: end,
          terms: updated.warrantyTerms,
        },
        update: {
          days: updated.warrantyDays,
          startDate: start,
          endDate: end,
          terms: updated.warrantyTerms,
        },
      })
    }

    // Record the technician incentive once, from the approved/latest quote labour.
    if (body.status === 'COMPLETED' && updated.technicianId) {
      const quote = updated.quotations[0]
      const tech = await prisma.technician.findUnique({ where: { id: updated.technicianId } })
      if (quote && tech) {
        const amount = round2((quote.labourCharge * tech.incentiveRate) / 100)
        const existingIncentive = await prisma.technicianIncentive.findFirst({
          where: { repairId: updated.id, type: 'PER_REPAIR' },
        })
        if (!existingIncentive && amount > 0) {
          await prisma.technicianIncentive.create({
            data: {
              technicianId: tech.id,
              repairId: updated.id,
              amount,
              type: 'PER_REPAIR',
              note: `${tech.incentiveRate}% of labour on ${updated.code}`,
            },
          })
        }
        if (quote) {
          await prisma.quotation.update({
            where: { id: quote.id },
            data: { technicianIncentive: amount },
          })
        }
      }
    }

    if (REPORTABLE_STATUSES.includes(body.status)) {
      try {
        await publishReport(updated.id, req.user!.id)
      } catch (err) {
        console.error('[report] could not publish during status change', err)
      }
    }

    if (body.status === 'READY_FOR_PICKUP') {
      await notify({
        role: 'OWNER',
        type: 'READY',
        title: `Ready for pickup: ${updated.code}`,
        body: `${updated.customer.name} — ${updated.device.brand} ${updated.device.model}`,
        link: `/repairs/${updated.id}`,
      })
    }
    if (body.status === 'COMPLETED') {
      await notify({
        role: 'OWNER',
        type: 'COMPLETED',
        title: `Repair completed: ${updated.code}`,
        body: `${updated.customer.name} — ${updated.device.brand} ${updated.device.model}`,
        link: `/repairs/${updated.id}`,
      })
    }

    await audit({
      userId: req.user!.id,
      action: 'REPAIR_STATUS_CHANGED',
      entity: 'Repair',
      entityId: updated.id,
      meta: { from: existing.status, to: body.status, note: body.note ?? null },
      ip: req.ip,
    })

    updated = await prisma.repair.findUniqueOrThrow({
      where: { id: updated.id },
      include: {
        technician: { include: { user: true } },
        quotations: { orderBy: { version: 'desc' }, take: 1 },
        customer: true,
        device: true,
      },
    })

    res.json({
      repair: repairView(updated, req.user!),
      reportToken: updated.reportToken,
      allowedStatuses: nextStatuses(updated.status, req.user!.role),
    })
  }),
)

const diagnoseSchema = z.object({
  mode: z.enum(['ai', 'checklist']).default('checklist'),
})

repairsRouter.post(
  '/:id/diagnose',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    const body = parse(diagnoseSchema, req.body)
    const confirmedFault = repair.confirmedFault

    const result =
      body.mode === 'ai'
        ? await aiDiagnose({
            brand: repair.device.brand,
            model: repair.device.model,
            category: repair.device.category,
            problem: repair.problem,
            confirmedFault,
            technicianNotes: repair.internalNotes,
          })
        : localChecklist({ category: repair.device.category, problem: repair.problem })

    const diagnostic = await prisma.repairDiagnostic.create({
      data: {
        repairId: repair.id,
        mode: result.mode,
        provider: result.provider,
        model: result.model,
        summary: result.summary,
        causes: JSON.stringify(result.causes),
        tests: JSON.stringify(result.tests),
        parts: JSON.stringify(result.parts),
        difficulty: result.difficulty,
        estimatedMinutes: result.estimatedMinutes,
        confidence: result.confidence,
        sources: JSON.stringify(result.sources),
        rawText: result.rawText,
        createdById: req.user!.id,
      },
    })

    const earlyStatuses = ['NEW_REQUEST', 'DEVICE_RECEIVED', 'AI_DIAGNOSIS_COMPLETED']
    if (earlyStatuses.includes(repair.status)) {
      await prisma.repair.update({
        where: { id: repair.id },
        data: { status: 'AI_DIAGNOSIS_COMPLETED' },
      })
    }

    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: 'DIAGNOSIS',
        note:
          result.mode === 'AI'
            ? 'AI research completed (unverified suggestions)'
            : 'Offline checklist generated (generic guidance)',
      },
    })

    const full = await getRepair(repair.id, req.user!)
    res.json({ diagnostic, repair: repairView(full, req.user!) })
  }),
)

const partSchema = z.object({
  sparePartId: z.string().optional(),
  name: z.string().trim().max(160).optional(),
  quality: z.enum(PART_QUALITIES).default('Compatible'),
  supplierName: z.string().trim().max(160).optional().or(z.literal('')),
  sourceUrl: z.string().trim().url('Enter a valid URL.').max(1000).optional().or(z.literal('')),
  priceSource: z.enum(PRICE_SOURCES).default('MANUAL'),
  lastCheckedAt: z.string().datetime().optional().or(z.literal('')),
  unitPrice: z.number().min(0).max(1000000),
  unitCost: z.number().min(0).max(1000000).default(0),
  quantity: z.number().int().min(1).max(100).default(1),
  isEstimated: z.boolean().optional(),
  note: z.string().trim().max(500).optional().or(z.literal('')),
})

repairsRouter.post(
  '/:id/parts',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    const body = parse(partSchema, req.body)

    let partData: {
      name: string
      quality: string
      supplierName: string | null
      sourceUrl: string | null
      priceSource: string
      lastCheckedAt: Date | null
      unitPrice: number
      unitCost: number
      isEstimated: boolean
      sparePartId: string | null
    }

    if (body.sparePartId) {
      const part = await prisma.sparePart.findUnique({
        where: { id: body.sparePartId },
        include: { supplier: true },
      })
      if (!part || !part.active) throw new HttpError(404, 'Spare part not found.')
      if (part.quantity < body.quantity) {
        throw new HttpError(400, `Only ${part.quantity} unit(s) of ${part.name} are in stock.`)
      }
      partData = {
        name: part.name,
        quality: part.quality,
        supplierName: part.supplier?.name ?? null,
        sourceUrl: null,
        priceSource: 'INVENTORY',
        lastCheckedAt: null,
        unitPrice: body.unitPrice || part.sellingPrice,
        unitCost: part.purchasePrice,
        isEstimated: false,
        sparePartId: part.id,
      }
    } else {
      if (!body.name) throw new HttpError(400, 'Enter the part name.')
      if (body.priceSource === 'VERIFIED_LISTING' && !body.sourceUrl) {
        throw new HttpError(400, 'Online purchasing requires a valid product URL link.')
      }
      if (body.priceSource === 'OFFLINE_STORE' && !body.supplierName) {
        throw new HttpError(400, 'Offline store purchasing requires the physical shop or store name.')
      }
      partData = {
        name: body.name,
        quality: body.quality,
        supplierName: body.supplierName || null,
        sourceUrl: body.priceSource === 'OFFLINE_STORE' ? null : body.sourceUrl || null,
        priceSource: body.priceSource,
        lastCheckedAt: body.lastCheckedAt ? new Date(body.lastCheckedAt) : body.sourceUrl ? new Date() : null,
        unitPrice: body.unitPrice,
        unitCost: body.unitCost,
        isEstimated:
          body.isEstimated ??
          (body.priceSource === 'ESTIMATE' || (body.priceSource === 'VERIFIED_LISTING' && !body.sourceUrl)),
        sparePartId: null,
      }
    }

    const part = await prisma.$transaction(async (tx) => {
      const created = await tx.repairPart.create({
        data: {
          repairId: repair.id,
          ...partData,
          quantity: body.quantity,
          note: body.note || null,
          addedById: req.user!.id,
        },
      })
      if (partData.sparePartId) {
        const updatedPart = await tx.sparePart.update({
          where: { id: partData.sparePartId },
          data: { quantity: { decrement: body.quantity } },
        })
        await tx.inventoryTransaction.create({
          data: {
            partId: partData.sparePartId,
            type: 'OUT',
            quantity: body.quantity,
            unitCost: partData.unitCost,
            repairId: repair.id,
            note: `Used in ${repair.code}`,
            userId: req.user!.id,
          },
        })
        if (updatedPart.quantity <= updatedPart.minStock) {
          await notify({
            role: 'OWNER',
            type: 'LOW_STOCK',
            title: `Low stock: ${updatedPart.name}`,
            body: `${updatedPart.quantity} left (minimum ${updatedPart.minStock}).`,
            link: '/inventory',
          })
        }
      }
      return created
    })

    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: 'PART',
        note: `Added part: ${part.name} × ${part.quantity} (${part.priceSource})`,
      },
    })
    await audit({
      userId: req.user!.id,
      action: 'REPAIR_PART_ADDED',
      entity: 'Repair',
      entityId: repair.id,
      meta: { part: part.name, quantity: part.quantity, unitCost: part.unitCost, unitPrice: part.unitPrice },
      ip: req.ip,
    })

    const full = await getRepair(repair.id, req.user!)
    res.status(201).json({ part: repairView({ parts: [part] }, req.user!).parts[0], money: moneyView(full, req.user!) })
  }),
)

repairsRouter.delete(
  '/:id/parts/:partId',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    const part = await prisma.repairPart.findFirst({
      where: { id: param(req, 'partId'), repairId: repair.id },
    })
    if (!part) throw new HttpError(404, 'Part not found on this repair.')
    await prisma.$transaction(async (tx) => {
      await tx.repairPart.delete({ where: { id: part.id } })
      if (part.sparePartId) {
        await tx.sparePart.update({
          where: { id: part.sparePartId },
          data: { quantity: { increment: part.quantity } },
        })
        await tx.inventoryTransaction.create({
          data: {
            partId: part.sparePartId,
            type: 'IN',
            quantity: part.quantity,
            unitCost: part.unitCost,
            repairId: repair.id,
            note: `Returned from ${repair.code}`,
            userId: req.user!.id,
          },
        })
      }
    })
    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: 'PART',
        note: `Removed part: ${part.name} × ${part.quantity}`,
      },
    })
    await audit({
      userId: req.user!.id,
      action: 'REPAIR_PART_REMOVED',
      entity: 'Repair',
      entityId: repair.id,
      meta: { part: part.name, quantity: part.quantity },
      ip: req.ip,
    })
    const full = await getRepair(repair.id, req.user!)
    res.json({ ok: true, money: moneyView(full, req.user!) })
  }),
)

const quoteSchema = z.object({
  labourCharge: z.number().min(0).max(1000000),
  otherExpenses: z.number().min(0).max(1000000).default(0),
  otherCost: z.number().min(0).max(1000000).default(0),
  discount: z.number().min(0).max(1000000).default(0),
  taxRate: z.number().min(0).max(100).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})

repairsRouter.post(
  '/:id/quote',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    const body = parse(quoteSchema, req.body)
    const shop = await prisma.shop.findFirst()
    const techRate = repair.technician?.incentiveRate ?? 0
    const computed = computeQuote({
      parts: repair.parts.map((p) => ({
        unitPrice: p.unitPrice,
        unitCost: p.unitCost,
        quantity: p.quantity,
      })),
      labourCharge: body.labourCharge,
      otherExpenses: body.otherExpenses,
      otherCost: body.otherCost,
      discount: body.discount,
      taxRate: body.taxRate ?? shop?.taxRate ?? 0,
      technicianRate: techRate,
    })
    if (computed.customerTotal < 0) throw new HttpError(400, 'The discount cannot exceed the quoted amount.')

    const latest = await prisma.quotation.findFirst({
      where: { repairId: repair.id },
      orderBy: { version: 'desc' },
    })

    const quote = await prisma.quotation.create({
      data: {
        repairId: repair.id,
        version: (latest?.version ?? 0) + 1,
        status: 'PENDING_OWNER',
        ...computed,
        notes: body.notes || null,
        createdById: req.user!.id,
      },
    })

    await prisma.repair.update({
      where: { id: repair.id },
      data: {
        status: ['NEW_REQUEST', 'DEVICE_RECEIVED', 'AI_DIAGNOSIS_COMPLETED', 'AWAITING_INSPECTION', 'ESTIMATE_PREPARED', 'AWAITING_CUSTOMER_APPROVAL'].includes(
          repair.status,
        )
          ? 'AWAITING_OWNER_APPROVAL'
          : repair.status,
      },
    })
    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: 'QUOTE',
        note: `Quotation v${quote.version} submitted for owner approval (${computed.customerTotal.toFixed(2)} customer total)`,
      },
    })
    await notify({
      role: 'OWNER',
      type: 'APPROVAL',
      title: `Quotation awaiting approval: ${repair.code}`,
      body: `Customer total ₹${computed.customerTotal.toFixed(2)} — ${repair.customer.name}`,
      link: `/repairs/${repair.id}`,
    })
    await audit({
      userId: req.user!.id,
      action: 'QUOTE_SUBMITTED',
      entity: 'Quotation',
      entityId: quote.id,
      meta: { repairId: repair.id, ...computed },
      ip: req.ip,
    })

    const full = await getRepair(repair.id, req.user!)
    res.status(201).json({
      quote: quoteView(quote, req.user!),
      repair: repairView(full, req.user!),
      money: moneyView(full, req.user!),
    })
  }),
)

repairsRouter.post(
  '/:id/quotations/:quoteId/approve',
  asyncRoute(async (req, res) => {
    if (req.user!.role !== 'OWNER') throw new HttpError(403, 'Only the owner can approve quotations.')
    const repair = await getRepair(param(req, 'id'), req.user!)
    const quote = await prisma.quotation.findFirst({
      where: { id: param(req, 'quoteId'), repairId: repair.id },
    })
    if (!quote) throw new HttpError(404, 'Quotation not found.')
    if (quote.status === 'APPROVED') throw new HttpError(400, 'This quotation is already approved.')

    const approved = await prisma.quotation.update({
      where: { id: quote.id },
      data: { status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date() },
    })
    if (['ESTIMATE_PREPARED', 'AWAITING_OWNER_APPROVAL', 'AWAITING_CUSTOMER_APPROVAL'].includes(repair.status)) {
      await prisma.repair.update({
        where: { id: repair.id },
        data: { status: 'AWAITING_CUSTOMER_APPROVAL' },
      })
    }
    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: 'QUOTE',
        note: `Quotation v${quote.version} approved by owner`,
      },
    })
    if (repair.technician) {
      await notify({
        userId: repair.technician.userId,
        type: 'APPROVAL',
        title: `Quotation approved: ${repair.code}`,
        body: 'Record the customer decision to continue.',
        link: `/repairs/${repair.id}`,
      })
    }
    await audit({
      userId: req.user!.id,
      action: 'QUOTE_APPROVED',
      entity: 'Quotation',
      entityId: quote.id,
      meta: { repairId: repair.id, customerTotal: quote.customerTotal, netProfit: quote.netProfit },
      ip: req.ip,
    })
    const full = await getRepair(repair.id, req.user!)
    res.json({ quote: quoteView(approved, req.user!), repair: repairView(full, req.user!) })
  }),
)

repairsRouter.post(
  '/:id/quotations/:quoteId/reject',
  asyncRoute(async (req, res) => {
    if (req.user!.role !== 'OWNER') throw new HttpError(403, 'Only the owner can reject quotations.')
    const repair = await getRepair(param(req, 'id'), req.user!)
    const quote = await prisma.quotation.findFirst({
      where: { id: param(req, 'quoteId'), repairId: repair.id },
    })
    if (!quote) throw new HttpError(404, 'Quotation not found.')
    const reason = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {})
    const rejected = await prisma.quotation.update({
      where: { id: quote.id },
      data: { status: 'REJECTED' },
    })
    if (repair.status === 'AWAITING_OWNER_APPROVAL') {
      await prisma.repair.update({ where: { id: repair.id }, data: { status: 'ESTIMATE_PREPARED' } })
    }
    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: 'QUOTE',
        note: `Quotation v${quote.version} rejected${reason.reason ? `: ${reason.reason}` : ''}`,
      },
    })
    if (repair.technician) {
      await notify({
        userId: repair.technician.userId,
        type: 'APPROVAL',
        title: `Quotation rejected: ${repair.code}`,
        body: reason.reason || 'Revise the quotation and resubmit.',
        link: `/repairs/${repair.id}`,
      })
    }
    await audit({
      userId: req.user!.id,
      action: 'QUOTE_REJECTED',
      entity: 'Quotation',
      entityId: quote.id,
      meta: { repairId: repair.id, reason: reason.reason ?? null },
      ip: req.ip,
    })
    const full = await getRepair(repair.id, req.user!)
    res.json({ quote: quoteView(rejected, req.user!), repair: repairView(full, req.user!) })
  }),
)

repairsRouter.post(
  '/:id/quote/customer-decision',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    const body = z
      .object({ accepted: z.boolean(), note: z.string().trim().max(500).optional() })
      .parse(req.body)
    const quote = repair.quotations.find((q) => q.status === 'APPROVED')
    if (!quote) throw new HttpError(400, 'There is no approved quotation yet.')
    await prisma.quotation.update({
      where: { id: quote.id },
      data: {
        customerDecision: body.accepted ? 'ACCEPTED' : 'REJECTED',
        decidedAt: new Date(),
      },
    })
    const next = body.accepted
      ? repair.status === 'AWAITING_CUSTOMER_APPROVAL'
        ? 'PARTS_ORDERED'
        : repair.status
      : 'ESTIMATE_PREPARED'
    await prisma.repair.update({ where: { id: repair.id }, data: { status: next } })
    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: 'QUOTE',
        note: body.accepted
          ? 'Customer accepted the quotation'
          : 'Customer declined the quotation',
      },
    })
    await notify({
      role: 'OWNER',
      type: 'APPROVAL',
      title: `Customer ${body.accepted ? 'accepted' : 'declined'} quote: ${repair.code}`,
      body: `Quotation v${quote.version}`,
      link: `/repairs/${repair.id}`,
    })
    const full = await getRepair(repair.id, req.user!)
    res.json({ repair: repairView(full, req.user!) })
  }),
)

const paymentSchema = z.object({
  amount: z.number().positive('Enter an amount greater than zero.').max(10000000),
  method: z.enum(['CASH', 'UPI', 'CARD', 'BANK', 'OTHER']),
  reference: z.string().trim().max(200).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  paidAt: z.string().datetime().optional(),
})

repairsRouter.post(
  '/:id/payments',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    const body = parse(paymentSchema, req.body)
    const money = moneySummary(repair)
    if (money.paidTotal + body.amount > money.quotedTotal + 0.5) {
      throw new HttpError(
        400,
        `This payment exceeds the balance. Outstanding balance is ₹${money.balance.toFixed(2)}.`,
      )
    }
    const payment = await prisma.payment.create({
      data: {
        repairId: repair.id,
        amount: round2(body.amount),
        method: body.method,
        reference: body.reference || null,
        notes: body.notes || null,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        recordedById: req.user!.id,
      },
    })
    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: 'PAYMENT',
        note: `Payment recorded: ₹${payment.amount.toFixed(2)} (${payment.method})`,
      },
    })
    await audit({
      userId: req.user!.id,
      action: 'PAYMENT_RECORDED',
      entity: 'Payment',
      entityId: payment.id,
      meta: { repairId: repair.id, amount: payment.amount, method: payment.method },
      ip: req.ip,
    })
    if (REPORTABLE_STATUSES.includes(repair.status)) {
      await publishReport(repair.id, req.user!.id).catch((err) =>
        console.error('[report] refresh after payment failed', err),
      )
    }
    const full = await getRepair(repair.id, req.user!)
    res.status(201).json({ payment, money: moneyView(full, req.user!) })
  }),
)

repairsRouter.post(
  '/:id/report',
  asyncRoute(async (req, res) => {
    const repair = await getRepair(param(req, 'id'), req.user!)
    if (!REPORTABLE_STATUSES.includes(repair.status)) {
      throw new HttpError(400, 'Complete the repair before publishing a service report.')
    }
    const rotate = Boolean(req.body?.rotateToken) && req.user!.role === 'OWNER'
    const report = await publishReport(repair.id, req.user!.id, rotate)
    await prisma.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: req.user!.id,
        type: 'REPORT',
        note: rotate ? 'Service report regenerated with a new secure link' : 'Service report published',
      },
    })
    const full = await getRepair(repair.id, req.user!)
    res.json({ report: { token: report.token, publishedAt: report.publishedAt }, repair: repairView(full, req.user!) })
  }),
)
