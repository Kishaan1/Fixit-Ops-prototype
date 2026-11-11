import { prisma } from '../db'
import { round2 } from './http'
import { jsonArray } from './http'
import { REPORTABLE_STATUSES, STATUS_LABELS } from './constants'
import { newToken } from './records'

export type PublicReportSnapshot = {
  version: number
  generatedAt: string
  shop: {
    name: string
    phone: string | null
    email: string | null
    address: string | null
    logoPath: string | null
  }
  repair: {
    code: string
    status: string
    statusLabel: string
    createdAt: string
    completedAt: string | null
    deliveredAt: string | null
    problem: string
    confirmedFault: string | null
    repairProcedure: string | null
    testingResults: string | null
    technicianName: string | null
    warranty: { days: number; endDate: string; terms: string | null } | null
  }
  customer: { name: string }
  device: {
    category: string
    brand: string
    model: string
    imei: string | null
    serialNumber: string | null
  }
  diagnosis: Array<{
    mode: string
    summary: string
    causes: unknown[]
    confidence: number | null
    sources: unknown[]
    createdAt: string
  }>
  parts: Array<{ name: string; quality: string; quantity: number; unitPrice: number }>
  charges: {
    partsTotal: number
    labourCharge: number
    otherExpenses: number
    taxAmount: number
    discount: number
    customerTotal: number
    paidTotal: number
  }
  payments: Array<{ amount: number; method: string; paidAt: string }>
}

export async function buildReportSnapshot(repairId: string): Promise<PublicReportSnapshot> {
  const [repair, shop] = await Promise.all([
    prisma.repair.findUnique({
      where: { id: repairId },
      include: {
        customer: true,
        device: true,
        technician: { include: { user: true } },
        parts: true,
        payments: { orderBy: { paidAt: 'asc' } },
        quotations: { orderBy: { version: 'desc' } },
        diagnostics: { orderBy: { createdAt: 'desc' }, take: 3 },
        warranty: true,
      },
    }),
    prisma.shop.findFirst(),
  ])
  if (!repair) throw new Error('Repair not found')
  if (!REPORTABLE_STATUSES.includes(repair.status)) {
    throw new Error('This repair is not complete yet.')
  }

  const quote = repair.quotations.find((q) => q.status === 'APPROVED') ?? repair.quotations[0]
  const partsTotal = quote?.partsTotal ?? round2(repair.parts.reduce((s, p) => s + p.unitPrice * p.quantity, 0))
  const labourCharge = quote?.labourCharge ?? 0
  const otherExpenses = quote?.otherExpenses ?? 0
  const taxAmount = quote?.taxAmount ?? 0
  const discount = quote?.discount ?? 0
  const customerTotal = quote?.customerTotal ?? partsTotal
  const paidTotal = round2(repair.payments.reduce((s, p) => s + p.amount, 0))

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    shop: {
      name: shop?.name ?? 'FIXIT AI Repair Lab',
      phone: shop?.phone ?? null,
      email: shop?.email ?? null,
      address: shop?.address ?? null,
      logoPath: shop?.logoPath ?? null,
    },
    repair: {
      code: repair.code,
      status: repair.status,
      statusLabel: STATUS_LABELS[repair.status as keyof typeof STATUS_LABELS] ?? repair.status,
      createdAt: repair.createdAt.toISOString(),
      completedAt: repair.completedAt?.toISOString() ?? null,
      deliveredAt: repair.deliveredAt?.toISOString() ?? null,
      problem: repair.problem,
      confirmedFault: repair.confirmedFault,
      repairProcedure: repair.repairProcedure,
      testingResults: repair.testingResults,
      technicianName: repair.technician?.user.name ?? null,
      warranty: repair.warranty
        ? {
            days: repair.warranty.days,
            endDate: repair.warranty.endDate.toISOString(),
            terms: repair.warranty.terms,
          }
        : null,
    },
    customer: { name: repair.customer.name },
    device: {
      category: repair.device.category,
      brand: repair.device.brand,
      model: repair.device.model,
      imei: null,
      serialNumber: null,
    },
    diagnosis: repair.diagnostics.map((d) => ({
      mode: d.mode,
      summary: d.summary,
      causes: jsonArray(d.causes),
      confidence: d.confidence,
      sources: jsonArray(d.sources),
      createdAt: d.createdAt.toISOString(),
    })),
    parts: repair.parts.map((p) => ({
      name: p.name,
      quality: p.quality,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
    })),
    charges: {
      partsTotal,
      labourCharge,
      otherExpenses,
      taxAmount,
      discount,
      customerTotal,
      paidTotal,
    },
    payments: repair.payments.map((p) => ({
      amount: p.amount,
      method: p.method,
      paidAt: p.paidAt.toISOString(),
    })),
  }
}

export async function publishReport(repairId: string, userId?: string | null, rotateToken = false) {
  const snapshot = await buildReportSnapshot(repairId)
  const existing = await prisma.repairReport.findUnique({ where: { repairId } })
  const token = !existing || rotateToken ? newToken(24) : existing.token
  const report = await prisma.repairReport.upsert({
    where: { repairId },
    create: {
      repairId,
      token,
      snapshot: JSON.stringify(snapshot),
      createdById: userId ?? null,
      publishedAt: new Date(),
    },
    update: {
      token,
      snapshot: JSON.stringify(snapshot),
      publishedAt: new Date(),
    },
  })
  await prisma.repair.update({
    where: { id: repairId },
    data: { reportToken: report.token, reportPublishedAt: report.publishedAt },
  })
  return report
}

export async function getPublicReport(token: string) {
  const report = await prisma.repairReport.findUnique({
    where: { token },
    include: {
      repair: { select: { status: true, deliveredAt: true, completedAt: true, feedback: true } },
    },
  })
  if (!report) return null
  let snapshot: PublicReportSnapshot
  try {
    snapshot = JSON.parse(report.snapshot) as PublicReportSnapshot
    // Live status is safe to expose and keeps the page accurate after delivery.
    snapshot.repair.status = report.repair.status
    snapshot.repair.statusLabel =
      STATUS_LABELS[report.repair.status as keyof typeof STATUS_LABELS] ?? report.repair.status
    snapshot.repair.deliveredAt = report.repair.deliveredAt?.toISOString() ?? snapshot.repair.deliveredAt
  } catch {
    // Malformed or legacy snapshot — treat the link as invalid instead of crashing.
    return null
  }
  return {
    snapshot,
    feedback: report.repair.feedback
      ? {
          rating: report.repair.feedback.rating,
          comment: report.repair.feedback.comment,
          createdAt: report.repair.feedback.createdAt.toISOString(),
        }
      : null,
  }
}
