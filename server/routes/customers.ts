import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth } from '../lib/auth'
import { asyncRoute, HttpError, normalizePhone, paginationDefaults, parse, round2 , param } from '../lib/http'
import { audit } from '../lib/records'

export const customersRouter = Router()
customersRouter.use(requireAuth)

const customerInput = z.object({
  name: z.string().trim().min(2, 'Enter the customer name.').max(120),
  phone: z
    .string()
    .trim()
    .min(7, 'Enter a valid phone number.')
    .max(20)
    .refine((v) => normalizePhone(v).length >= 7, 'Enter a valid phone number.'),
  email: z.string().trim().email('Enter a valid email or leave it empty.').optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
})

function techCustomerFilter(user: { role: string; technicianId: string | null }) {
  if (user.role === 'OWNER') return {}
  return { repairs: { some: { technicianId: user.technicianId ?? '__none__' } } }
}

function repairSummary(repairs: Array<{ status: string; createdAt: Date; paymentSum?: number; total?: number }>) {
  return {
    visits: repairs.length,
    completed: repairs.filter((r) => r.status === 'DELIVERED' || r.status === 'COMPLETED').length,
    totalSpent: round2(repairs.reduce((s, r) => s + (r.paymentSum ?? 0), 0)),
    lastServiceDate:
      repairs.length > 0
        ? repairs
            .map((r) => r.createdAt)
            .sort((a, b) => b.getTime() - a.getTime())[0]
            .toISOString()
        : null,
  }
}

customersRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { page, pageSize, skip } = paginationDefaults(req.query as Record<string, unknown>)
    const q = String(req.query.q ?? '').trim()
    const where: Record<string, unknown> = { ...techCustomerFilter(req.user!) }
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { phone: { contains: q } },
        { email: { contains: q } },
      ]
    }

    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          repairs: {
            where: req.user!.role === 'OWNER' ? {} : { technicianId: req.user!.technicianId ?? '__none__' },
            select: {
              id: true,
              status: true,
              createdAt: true,
              payments: { select: { amount: true } },
            },
          },
          _count: { select: { devices: true } },
        },
      }),
    ])

    res.json({
      items: customers.map((c) => {
        const repairs = c.repairs.map((r) => ({
          ...r,
          paymentSum: r.payments.reduce((s, p) => s + p.amount, 0),
        }))
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          address: c.address,
          notes: c.notes,
          isDemo: c.isDemo,
          deviceCount: c._count.devices,
          createdAt: c.createdAt,
          ...repairSummary(repairs),
          returning: repairs.length > 1,
        }
      }),
      total,
      page,
      pageSize,
    })
  }),
)

customersRouter.get(
  '/lookup',
  asyncRoute(async (req, res) => {
    const phone = normalizePhone(String(req.query.phone ?? ''))
    if (phone.length < 7) throw new HttpError(400, 'Enter a valid phone number.')
    const customer = await prisma.customer.findUnique({
      where: { phone },
      include: {
        repairs: {
          where: req.user!.role === 'OWNER' ? {} : { technicianId: req.user!.technicianId ?? '__none__' },
          select: { id: true, status: true, createdAt: true, payments: { select: { amount: true } } },
        },
      },
    })
    if (!customer) {
      res.json({ customer: null, returning: false })
      return
    }
    const repairs = customer.repairs.map((r) => ({
      ...r,
      paymentSum: r.payments.reduce((s, p) => s + p.amount, 0),
    }))
    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        notes: customer.notes,
      },
      returning: repairs.length > 0,
      ...repairSummary(repairs),
    })
  }),
)

customersRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = parse(customerInput, req.body)
    const phone = normalizePhone(body.phone)
    const existing = await prisma.customer.findUnique({ where: { phone } })
    if (existing) {
      throw new HttpError(409, 'A customer with this phone number already exists.', {
        code: 'CUSTOMER_EXISTS',
        details: { customer: existing },
      })
    }
    const customer = await prisma.customer.create({
      data: {
        name: body.name,
        phone,
        email: body.email || null,
        address: body.address || null,
        notes: body.notes || null,
        createdById: req.user!.id,
      },
    })
    await audit({
      userId: req.user!.id,
      action: 'CUSTOMER_CREATED',
      entity: 'Customer',
      entityId: customer.id,
      ip: req.ip,
    })
    res.status(201).json({ customer })
  }),
)

customersRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: param(req, 'id') },
      include: {
        repairs: {
          where: req.user!.role === 'OWNER' ? {} : { technicianId: req.user!.technicianId ?? '__none__' },
          orderBy: { createdAt: 'desc' },
          include: {
            device: true,
            technician: { include: { user: true } },
            parts: true,
            payments: true,
            quotations: { orderBy: { version: 'desc' }, take: 1 },
          },
        },
        devices: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!customer) throw new HttpError(404, 'Customer not found.')
    if (req.user!.role !== 'OWNER' && customer.repairs.length === 0) {
      throw new HttpError(403, 'You can only view customers you have served.')
    }
    const repairs = customer.repairs.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      problem: r.problem,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      device: r.device,
      technicianName: r.technician?.user.name ?? null,
      paymentTotal: round2(r.payments.reduce((s, p) => s + p.amount, 0)),
      quoteTotal: r.quotations[0]?.customerTotal ?? 0,
      parts: r.parts.map((p) => ({ name: p.name, quantity: p.quantity, unitPrice: p.unitPrice })),
    }))
    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        notes: customer.notes,
        isDemo: customer.isDemo,
        createdAt: customer.createdAt,
      },
      summary: {
        ...repairSummary(repairs.map((r) => ({ ...r, paymentSum: r.paymentTotal }))),
        returning: repairs.length > 1,
        devices: customer.devices,
      },
      repairs,
      scoped: req.user!.role !== 'OWNER',
      scopeNote:
        req.user!.role !== 'OWNER'
          ? 'Technician view: only repairs assigned to you are shown.'
          : null,
    })
  }),
)

customersRouter.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const body = parse(customerInput.partial(), req.body)
    const customer = await prisma.customer.findUnique({
      where: { id: param(req, 'id') },
      include: { repairs: { select: { technicianId: true } } },
    })
    if (!customer) throw new HttpError(404, 'Customer not found.')
    if (
      req.user!.role !== 'OWNER' &&
      !customer.repairs.some((r) => r.technicianId === req.user!.technicianId)
    ) {
      throw new HttpError(403, 'You can only edit customers you have served.')
    }
    let phone: string | undefined
    if (body.phone) {
      phone = normalizePhone(body.phone)
      const clash = await prisma.customer.findFirst({ where: { phone, id: { not: customer.id } } })
      if (clash) throw new HttpError(409, 'Another customer already uses this phone number.')
    }
    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(phone ? { phone } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.address !== undefined ? { address: body.address || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      },
    })
    await audit({
      userId: req.user!.id,
      action: 'CUSTOMER_UPDATED',
      entity: 'Customer',
      entityId: customer.id,
      ip: req.ip,
    })
    res.json({ customer: updated })
  }),
)
