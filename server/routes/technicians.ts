import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { hashPassword, logAccountActivity, requireAuth, requireOwner } from '../lib/auth'
import { asyncRoute, HttpError, parse, round2, param } from '../lib/http'
import { audit, notify } from '../lib/records'
import { daysBetween, parseDateRange } from '../lib/dates'
import { ACTIVE_STATUSES } from '../lib/constants'

export const techniciansRouter = Router()
techniciansRouter.use(requireAuth)

const createSchema = z.object({
  name: z.string().trim().min(2, 'Enter the technician name.').max(120),
  userId: z.string().trim().min(3, 'User ID must be at least 3 characters.').max(50).regex(/^[A-Za-z0-9_-]+$/, 'User ID can only contain letters, numbers, hyphens, and underscores.').optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  phone: z.string().trim().max(25).optional().or(z.literal('')),
  designation: z.string().trim().max(100).optional().or(z.literal('')),
  specialization: z.string().trim().max(160).optional().or(z.literal('')),
  incentiveRate: z.number().min(0, 'Cannot be negative.').max(100, 'Cannot exceed 100%.').default(10),
  password: z.string().min(8, 'Use at least 8 characters.'),
  accountStatus: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  joiningDate: z.string().optional(),
  profileImageUrl: z.string().optional().nullable(),
})

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  userId: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9_-]+$/).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(25).optional().or(z.literal('')),
  designation: z.string().trim().max(100).optional().or(z.literal('')),
  specialization: z.string().trim().max(160).optional().or(z.literal('')),
  incentiveRate: z.number().min(0).max(100).optional(),
  password: z.string().min(8).optional(),
  accountStatus: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  joiningDate: z.string().optional(),
  profileImageUrl: z.string().optional().nullable(),
  active: z.boolean().optional(),
})

function serializeTech(t: {
  id: string
  specialization: string | null
  phone: string | null
  incentiveRate: number
  active: boolean
  createdAt: Date
  user: {
    id: string
    userId: string | null
    name: string
    email: string
    phone: string | null
    active: boolean
    accountStatus?: string
    designation?: string | null
    profileImageUrl?: string | null
    emailVerified?: boolean
    mustChangePassword?: boolean
    joiningDate?: Date
    lastLogin?: Date | null
  }
}) {
  return {
    id: t.id,
    userId: t.user.userId || t.user.id,
    userDbId: t.user.id,
    name: t.user.name,
    email: t.user.email,
    phone: t.phone || t.user.phone,
    specialization: t.specialization,
    incentiveRate: t.incentiveRate,
    active: t.active && t.user.active,
    accountStatus: t.user.accountStatus ?? (t.active && t.user.active ? 'ACTIVE' : 'INACTIVE'),
    designation: t.user.designation ?? null,
    profileImageUrl: t.user.profileImageUrl ?? null,
    emailVerified: t.user.emailVerified ?? true,
    mustChangePassword: t.user.mustChangePassword ?? false,
    joiningDate: t.user.joiningDate ?? t.createdAt,
    lastLogin: t.user.lastLogin ?? null,
    createdAt: t.createdAt,
  }
}

// List technicians
techniciansRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const where =
      req.user!.role === 'OWNER' ? {} : { id: req.user!.technicianId ?? '__none__' }
    const technicians = await prisma.technician.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ items: technicians.map(serializeTech) })
  }),
)

// List Password Reset Requests (Owner only)
techniciansRouter.get(
  '/password-requests',
  requireOwner,
  asyncRoute(async (_req, res) => {
    const requests = await prisma.passwordResetRequest.findMany({
      include: {
        user: {
          select: {
            id: true,
            userId: true,
            name: true,
            email: true,
            phone: true,
            profileImageUrl: true,
            designation: true,
            accountStatus: true,
            technician: { select: { id: true, specialization: true } },
          },
        },
      },
      orderBy: [
        { requestStatus: 'asc' },
        { requestDate: 'desc' },
      ],
    })
    res.json({ items: requests })
  }),
)

// Approve Password Reset Request (Owner only)
techniciansRouter.post(
  '/password-requests/:id/approve',
  requireOwner,
  asyncRoute(async (req, res) => {
    const request = await prisma.passwordResetRequest.findUnique({
      where: { id: param(req, 'id') },
      include: { user: true },
    })
    if (!request) throw new HttpError(404, 'Password reset request not found.')
    if (request.requestStatus !== 'PENDING') {
      throw new HttpError(400, `This request is already ${request.requestStatus.toLowerCase()}.`)
    }

    const tempPassword = req.body.temporaryPassword || `Fixit@${Math.floor(100000 + Math.random() * 900000)}`

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: request.userId },
        data: {
          passwordHash: hashPassword(tempPassword),
          mustChangePassword: true,
        },
      })
      await tx.passwordResetRequest.update({
        where: { id: request.id },
        data: {
          requestStatus: 'APPROVED',
          approvedBy: req.user!.id,
          completedAt: new Date(),
        },
      })
      await tx.session.deleteMany({ where: { userId: request.userId } })
    })

    await logAccountActivity(
      request.userId,
      'PASSWORD_RESET_APPROVED',
      `Owner approved password reset request and issued temporary password`,
      req.ip,
    )

    res.json({
      ok: true,
      temporaryPassword: tempPassword,
      message: 'Password reset request approved and temporary password generated.',
    })
  }),
)

// Reject Password Reset Request (Owner only)
techniciansRouter.post(
  '/password-requests/:id/reject',
  requireOwner,
  asyncRoute(async (req, res) => {
    const request = await prisma.passwordResetRequest.findUnique({
      where: { id: param(req, 'id') },
    })
    if (!request) throw new HttpError(404, 'Password reset request not found.')

    await prisma.passwordResetRequest.update({
      where: { id: request.id },
      data: {
        requestStatus: 'REJECTED',
        approvedBy: req.user!.id,
        completedAt: new Date(),
        notes: req.body.reason ? `Rejected: ${req.body.reason}` : request.notes,
      },
    })

    res.json({ ok: true, message: 'Password reset request rejected.' })
  }),
)

// Overall Performance (Owner only)
techniciansRouter.get(
  '/performance',
  requireOwner,
  asyncRoute(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>)
    const technicians = await prisma.technician.findMany({
      include: {
        user: true,
        repairs: {
          where: { createdAt: { gte: range.from, lte: range.to } },
          include: {
            payments: { where: { paidAt: { gte: range.from, lte: range.to } } },
            parts: true,
            quotations: { orderBy: { version: 'desc' }, take: 1 },
            feedback: true,
            customer: { select: { id: true, _count: { select: { repairs: true } } } },
          },
        },
        incentives: { where: { createdAt: { gte: range.from, lte: range.to } } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const items = technicians.map((t) => {
      const repairs = t.repairs
      const completedRepairs = repairs.filter((r) =>
        ['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'].includes(r.status),
      )
      const revenue = round2(
        repairs.reduce((sum, r) => sum + r.payments.reduce((s, p) => s + p.amount, 0), 0),
      )
      const partsCost = round2(
        repairs.reduce(
          (sum, r) => sum + r.parts.reduce((s, p) => s + p.unitCost * p.quantity, 0),
          0,
        ),
      )
      const otherCost = round2(
        repairs.reduce((sum, r) => sum + (r.quotations[0]?.otherCost ?? 0), 0),
      )
      const labour = round2(
        repairs.reduce((sum, r) => sum + (r.quotations[0]?.labourCharge ?? 0), 0),
      )
      const incentives = round2(t.incentives.reduce((s, i) => s + i.amount, 0))
      const grossProfit = round2(revenue - partsCost - otherCost)
      const feedback = completedRepairs.map((r) => r.feedback).filter(Boolean)
      const avgRating = feedback.length
        ? round2(feedback.reduce((s, f) => s + (f?.rating ?? 0), 0) / feedback.length)
        : null
      const durations = completedRepairs
        .filter((r) => r.completedAt)
        .map((r) => daysBetween(r.createdAt, r.completedAt as Date))

      return {
        ...serializeTech(t),
        assigned: repairs.length,
        completed: completedRepairs.length,
        pending: repairs.filter((r) => (ACTIVE_STATUSES as readonly string[]).includes(r.status)).length,
        cancelled: repairs.filter((r) => r.status === 'CANCELLED').length,
        revenue,
        partsCost,
        otherCost,
        labour,
        grossProfit,
        incentives,
        netContribution: round2(grossProfit - incentives),
        avgCompletionDays: durations.length
          ? round2(durations.reduce((s, d) => s + d, 0) / durations.length)
          : null,
        feedbackCount: feedback.length,
        avgRating,
        repeatRepairs: repairs.filter((r) => r.customer._count.repairs > 1).length,
        qualityChecks: repairs.filter((r) => ['QUALITY_CHECK', 'COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'].includes(r.status)).length,
      }
    })

    res.json({ items, range: { from: range.from, to: range.to, period: range.period } })
  }),
)

// Detailed Single Technician Performance & Profile
techniciansRouter.get(
  '/:id/performance',
  asyncRoute(async (req, res) => {
    // Technicians can view their own performance; owner can view all
    const targetId = param(req, 'id')
    if (req.user!.role !== 'OWNER' && req.user!.technicianId !== targetId) {
      throw new HttpError(403, 'You can only view your own technician performance.')
    }

    const range = parseDateRange(req.query as Record<string, unknown>)
    const tech = await prisma.technician.findUnique({
      where: { id: targetId },
      include: {
        user: {
          include: {
            activityLogs: {
              orderBy: { timestamp: 'desc' },
              take: 15,
            },
          },
        },
        repairs: {
          where: { createdAt: { gte: range.from, lte: range.to } },
          orderBy: { createdAt: 'desc' },
          include: {
            customer: true,
            device: true,
            payments: true,
            parts: true,
            quotations: { orderBy: { version: 'desc' }, take: 1 },
            feedback: true,
          },
        },
        incentives: { where: { createdAt: { gte: range.from, lte: range.to } } },
      },
    })
    if (!tech) throw new HttpError(404, 'Technician not found.')
    const repairs = tech.repairs
    const revenue = round2(repairs.reduce((s, r) => s + r.payments.reduce((x, p) => x + p.amount, 0), 0))
    const partsCost = round2(
      repairs.reduce((s, r) => s + r.parts.reduce((x, p) => x + p.unitCost * p.quantity, 0), 0),
    )
    const incentives = round2(tech.incentives.reduce((s, i) => s + i.amount, 0))
    const otherCost = round2(repairs.reduce((s, r) => s + (r.quotations[0]?.otherCost ?? 0), 0))
    const labour = round2(repairs.reduce((s, r) => s + (r.quotations[0]?.labourCharge ?? 0), 0))
    const feedback = repairs.map((r) => r.feedback).filter(Boolean)
    const completedRepairs = repairs.filter((r) => ['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'].includes(r.status))
    const durations = completedRepairs
      .filter((r) => r.completedAt)
      .map((r) => daysBetween(r.createdAt, r.completedAt as Date))
    const isOwner = req.user!.role === 'OWNER'

    // Shop revenue, parts cost and profit are owner-only. A technician may see
    // their own workload, ratings and incentive, but not the shop's margins.
    res.json({
      technician: serializeTech(tech),
      summary: {
        assigned: repairs.length,
        completed: completedRepairs.length,
        pending: repairs.filter((r) => (ACTIVE_STATUSES as readonly string[]).includes(r.status)).length,
        cancelled: repairs.filter((r) => r.status === 'CANCELLED').length,
        ...(isOwner
          ? {
              revenue,
              partsCost,
              otherCost,
              labour,
              grossProfit: round2(revenue - partsCost - otherCost),
              netContribution: round2(revenue - partsCost - otherCost - incentives),
            }
          : {}),
        incentives,
        avgCompletionDays: durations.length
          ? round2(durations.reduce((s, d) => s + d, 0) / durations.length)
          : null,
        avgRating: feedback.length
          ? round2(feedback.reduce((s, f) => s + (f?.rating ?? 0), 0) / feedback.length)
          : null,
        feedbackCount: feedback.length,
      },
      repairs: repairs.map((r) => ({
        id: r.id,
        code: r.code,
        customer: r.customer.name,
        device: `${r.device.brand} ${r.device.model}`,
        status: r.status,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        ...(isOwner
          ? {
              revenue: round2(r.payments.reduce((s, p) => s + p.amount, 0)),
              partsCost: round2(r.parts.reduce((s, p) => s + p.unitCost * p.quantity, 0)),
            }
          : {}),
        quoteTotal: r.quotations[0]?.customerTotal ?? 0,
        rating: r.feedback?.rating ?? null,
      })),
      activityLogs: tech.user.activityLogs.map((l) => ({
        id: l.id,
        activityType: l.activityType,
        activityDescription: l.activityDescription,
        timestamp: l.timestamp,
        ip: l.ip,
      })),
      range: { from: range.from, to: range.to, period: range.period },
    })
  }),
)

// Single Technician details by ID
techniciansRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const targetId = param(req, 'id')
    if (req.user!.role !== 'OWNER' && req.user!.technicianId !== targetId) {
      throw new HttpError(403, 'Permission denied.')
    }
    const tech = await prisma.technician.findUnique({
      where: { id: targetId },
      include: {
        user: {
          include: {
            activityLogs: {
              orderBy: { timestamp: 'desc' },
              take: 20,
            },
          },
        },
      },
    })
    if (!tech) throw new HttpError(404, 'Technician not found.')
    res.json({
      technician: serializeTech(tech),
      activityLogs: tech.user.activityLogs,
    })
  }),
)

// Create Technician Account (Owner only)
techniciansRouter.post(
  '/',
  requireOwner,
  asyncRoute(async (req, res) => {
    const body = parse(createSchema, req.body)

    // Check unique email
    const existingEmail = await prisma.user.findUnique({ where: { email: body.email } })
    if (existingEmail) throw new HttpError(409, 'A user with this email address already exists.')

    let finalUserId = body.userId?.toUpperCase()
    if (!finalUserId) {
      const count = await prisma.user.count({ where: { role: 'TECHNICIAN' } })
      finalUserId = `TECH${count < 9 ? `0${count + 1}` : count + 1}`
    }

    // Check unique userId
    const existingUserId = await prisma.user.findFirst({
      where: {
        OR: [{ userId: finalUserId }, { userId: finalUserId.toUpperCase() }],
      },
    })
    if (existingUserId) throw new HttpError(409, `User ID "${finalUserId}" is already in use.`)

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: body.email,
          userId: finalUserId,
          name: body.name,
          phone: body.phone || null,
          role: 'TECHNICIAN',
          designation: body.designation || null,
          profileImageUrl: body.profileImageUrl || null,
          accountStatus: body.accountStatus,
          active: body.accountStatus === 'ACTIVE',
          joiningDate: body.joiningDate ? new Date(body.joiningDate) : new Date(),
          passwordHash: hashPassword(body.password),
        },
      })

      const tech = await tx.technician.create({
        data: {
          userId: user.id,
          phone: body.phone || null,
          specialization: body.specialization || null,
          incentiveRate: body.incentiveRate,
          active: body.accountStatus === 'ACTIVE',
        },
        include: { user: true },
      })

      return tech
    })

    await logAccountActivity(
      result.user.id,
      'ACCOUNT_CREATED',
      `Technician account created by Shop Owner (${req.user!.name})`,
      req.ip,
    )

    await audit({
      userId: req.user!.id,
      action: 'TECHNICIAN_CREATED',
      entity: 'Technician',
      entityId: result.id,
      meta: { email: body.email, userId: body.userId },
      ip: req.ip,
    })

    res.status(201).json({ technician: serializeTech(result) })
  }),
)

// Edit Technician Account (Owner only)
techniciansRouter.patch(
  '/:id',
  requireOwner,
  asyncRoute(async (req, res) => {
    const body = parse(updateSchema, req.body)
    const tech = await prisma.technician.findUnique({ where: { id: param(req, 'id') }, include: { user: true } })
    if (!tech) throw new HttpError(404, 'Technician not found.')

    // Validate unique userId if updated
    if (body.userId && body.userId !== tech.user.userId) {
      const existing = await prisma.user.findFirst({
        where: {
          userId: body.userId,
          id: { not: tech.userId },
        },
      })
      if (existing) throw new HttpError(409, `User ID "${body.userId}" is already in use.`)
    }

    // Validate unique email if updated
    if (body.email && body.email !== tech.user.email) {
      const existing = await prisma.user.findFirst({
        where: {
          email: body.email,
          id: { not: tech.userId },
        },
      })
      if (existing) throw new HttpError(409, `Email "${body.email}" is already in use.`)
    }

    const updated = await prisma.$transaction(async (tx) => {
      const isDeactivating =
        body.accountStatus === 'INACTIVE' ||
        body.accountStatus === 'SUSPENDED' ||
        body.active === false

      await tx.user.update({
        where: { id: tech.userId },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.userId ? { userId: body.userId } : {}),
          ...(body.email ? { email: body.email } : {}),
          ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
          ...(body.designation !== undefined ? { designation: body.designation || null } : {}),
          ...(body.profileImageUrl !== undefined ? { profileImageUrl: body.profileImageUrl } : {}),
          ...(body.accountStatus ? { accountStatus: body.accountStatus } : {}),
          ...(body.active !== undefined
            ? { active: body.active }
            : body.accountStatus
            ? { active: body.accountStatus === 'ACTIVE' }
            : {}),
          ...(body.joiningDate ? { joiningDate: new Date(body.joiningDate) } : {}),
          ...(body.password ? { passwordHash: hashPassword(body.password) } : {}),
        },
      })

      const t = await tx.technician.update({
        where: { id: tech.id },
        data: {
          ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
          ...(body.specialization !== undefined ? { specialization: body.specialization || null } : {}),
          ...(body.incentiveRate !== undefined ? { incentiveRate: body.incentiveRate } : {}),
          ...(body.active !== undefined
            ? { active: body.active }
            : body.accountStatus
            ? { active: body.accountStatus === 'ACTIVE' }
            : {}),
        },
        include: { user: true },
      })

      if (isDeactivating) {
        await tx.session.deleteMany({ where: { userId: tech.userId } })
      }

      return t
    })

    await logAccountActivity(
      tech.userId,
      'PROFILE_UPDATED',
      `Account details updated by Shop Owner`,
      req.ip,
    )

    await audit({
      userId: req.user!.id,
      action: 'TECHNICIAN_UPDATED',
      entity: 'Technician',
      entityId: tech.id,
      meta: body,
      ip: req.ip,
    })

    res.json({ technician: serializeTech(updated) })
  }),
)

// Owner Direct Password Reset for Technician
techniciansRouter.post(
  '/:id/reset-password',
  requireOwner,
  asyncRoute(async (req, res) => {
    const tech = await prisma.technician.findUnique({
      where: { id: param(req, 'id') },
      include: { user: true },
    })
    if (!tech) throw new HttpError(404, 'Technician not found.')

    const tempPassword = req.body.temporaryPassword || `Fixit@${Math.floor(100000 + Math.random() * 900000)}`

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: tech.userId },
        data: {
          passwordHash: hashPassword(tempPassword),
          mustChangePassword: true,
        },
      })
      await tx.session.deleteMany({ where: { userId: tech.userId } })
    })

    await logAccountActivity(
      tech.userId,
      'PASSWORD_RESET_APPROVED',
      'Owner directly reset account password with mandatory change required',
      req.ip,
    )

    res.json({
      ok: true,
      temporaryPassword: tempPassword,
      message: `Password reset successfully for ${tech.user.name}.`,
    })
  }),
)

// Delete or Deactivate Technician (Owner only)
techniciansRouter.delete(
  '/:id',
  requireOwner,
  asyncRoute(async (req, res) => {
    if (param(req, 'id') === req.user!.technicianId) {
      throw new HttpError(400, 'You cannot deactivate your own account here.')
    }
    const tech = await prisma.technician.findUnique({
      where: { id: param(req, 'id') },
      include: { user: true, _count: { select: { repairs: true } } },
    })
    if (!tech) throw new HttpError(404, 'Technician not found.')
    if (tech._count.repairs > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.technician.update({ where: { id: tech.id }, data: { active: false } })
        await tx.user.update({
          where: { id: tech.userId },
          data: { active: false, accountStatus: 'INACTIVE' },
        })
        await tx.session.deleteMany({ where: { userId: tech.userId } })
      })
      await audit({
        userId: req.user!.id,
        action: 'TECHNICIAN_DEACTIVATED',
        entity: 'Technician',
        entityId: tech.id,
        meta: { reason: 'has assigned repair history' },
        ip: req.ip,
      })
      res.json({
        deactivated: true,
        message: 'Technician has repair history, so the account was deactivated instead of deleted.',
      })
      return
    }
    await prisma.user.delete({ where: { id: tech.userId } })
    await audit({
      userId: req.user!.id,
      action: 'TECHNICIAN_DELETED',
      entity: 'Technician',
      entityId: tech.id,
      ip: req.ip,
    })
    res.json({ deleted: true })
  }),
)
