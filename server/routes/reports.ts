import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import QRCode from 'qrcode'
import { z } from 'zod'
import { prisma } from '../db'
import { config } from '../env'
import { requireAuth, requireOwner } from '../lib/auth'
import { asyncRoute, HttpError, parse, round2 , param } from '../lib/http'
import { getPublicReport, publishReport } from '../lib/report'
import { audit, notify } from '../lib/records'
import { STATUS_LABELS } from '../lib/constants'

export const reportsRouter = Router()

reportsRouter.get(
  '/',
  requireAuth,
  asyncRoute(async (req, res) => {
    const where =
      req.user!.role === 'OWNER' ? {} : { repair: { technicianId: req.user!.technicianId ?? '__none__' } }
    const reports = await prisma.repairReport.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      include: {
        repair: {
          include: {
            customer: { select: { name: true } },
            device: { select: { brand: true, model: true, category: true } },
            technician: { include: { user: { select: { name: true } } } },
            payments: { select: { amount: true } },
            quotations: { orderBy: { version: 'desc' }, take: 1 },
          },
        },
      },
    })
    res.json({
      items: reports.map((r) => ({
        id: r.id,
        repairId: r.repairId,
        token: r.token,
        publishedAt: r.publishedAt,
        url: `/r/${r.token}`,
        code: r.repair.code,
        status: r.repair.status,
        statusLabel: STATUS_LABELS[r.repair.status as keyof typeof STATUS_LABELS] ?? r.repair.status,
        customer: r.repair.customer.name,
        device: `${r.repair.device.brand} ${r.repair.device.model}`,
        category: r.repair.device.category,
        technician: r.repair.technician?.user.name ?? null,
        amount: r.repair.quotations[0]?.customerTotal ?? 0,
        paid: round2(r.repair.payments.reduce((s, p) => s + p.amount, 0)),
      })),
    })
  }),
)

reportsRouter.get(
  '/:repairId/qr',
  requireAuth,
  asyncRoute(async (req, res) => {
    const repair = await prisma.repair.findUnique({
      where: { id: param(req, 'repairId') },
      select: { id: true, technicianId: true, report: true, reportToken: true },
    })
    if (!repair) throw new HttpError(404, 'Repair not found.')
    if (req.user!.role !== 'OWNER' && repair.technicianId !== req.user!.technicianId) {
      throw new HttpError(403, 'This repair is not assigned to you.')
    }
    const token = repair.report?.token ?? repair.reportToken
    if (!token) throw new HttpError(400, 'Publish the service report first.')
    const url = `${config.publicBaseUrl}/r/${token}`
    const buffer = await QRCode.toBuffer(url, {
      type: 'png',
      width: Number(req.query.size) || 320,
      margin: 1,
      color: { dark: '#0b1117', light: '#ffffff' },
    })
    res.setHeader('content-type', 'image/png')
    res.setHeader('cache-control', 'private, max-age=300')
    res.send(buffer)
  }),
)

reportsRouter.post(
  '/:repairId/rotate',
  requireOwner,
  asyncRoute(async (req, res) => {
    const repair = await prisma.repair.findUnique({ where: { id: param(req, 'repairId') } })
    if (!repair) throw new HttpError(404, 'Repair not found.')
    const report = await publishReport(repair.id, req.user!.id, true)
    await audit({
      userId: req.user!.id,
      action: 'REPORT_TOKEN_ROTATED',
      entity: 'RepairReport',
      entityId: report.id,
      meta: { repairId: repair.id },
      ip: req.ip,
    })
    res.json({ token: report.token, url: `/r/${report.token}` })
  }),
)

// ---------------- public (no auth) ----------------

export const publicRouter = Router()

const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many feedback attempts. Please try again later.' },
})

publicRouter.get(
  '/reports/:token',
  asyncRoute(async (req, res) => {
    const token = param(req, 'token')
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new HttpError(404, 'Report not found.')
    const data = await getPublicReport(token)
    if (!data) throw new HttpError(404, 'This report link is invalid or has been replaced.')
    res.json(data)
  }),
)

publicRouter.get(
  '/reports/:token/qr',
  asyncRoute(async (req, res) => {
    const token = param(req, 'token')
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new HttpError(404, 'Report not found.')
    const url = `${config.publicBaseUrl}/r/${token}`
    const buffer = await QRCode.toBuffer(url, {
      type: 'png',
      width: Number(req.query.size) || 240,
      margin: 1,
      color: { dark: '#0b1117', light: '#ffffff' },
    })
    res.setHeader('content-type', 'image/png')
    res.setHeader('cache-control', 'public, max-age=3600')
    res.send(buffer)
  }),
)

publicRouter.post(
  '/reports/:token/feedback',
  feedbackLimiter,
  asyncRoute(async (req, res) => {
    const token = param(req, 'token')
    const body = parse(
      z.object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().max(800).optional().or(z.literal('')),
      }),
      req.body,
    )
    const report = await prisma.repairReport.findUnique({
      where: { token },
      select: { repairId: true, repair: { select: { code: true } } },
    })
    if (!report) throw new HttpError(404, 'This report link is invalid or has been replaced.')
    await prisma.customerFeedback.upsert({
      where: { repairId: report.repairId },
      create: {
        repairId: report.repairId,
        rating: body.rating,
        comment: body.comment || null,
      },
      update: { rating: body.rating, comment: body.comment || null },
    })
    await notify({
      role: 'OWNER',
      type: 'FEEDBACK',
      title: `Customer feedback: ${body.rating}/5`,
      body: `Report ${report.repair.code}${body.comment ? ` — "${body.comment.slice(0, 120)}"` : ''}`,
      link: `/repairs/${report.repairId}`,
    })
    res.status(201).json({ ok: true })
  }),
)
