/**
 * Local-only UI preview harness.
 *
 * Boots the in-memory gateway from scripts/fake-gateway.ts, seeds a small demo
 * dataset, and starts the real Express app so the React client can be inspected
 * without Google credentials. Never used in production.
 */
import { createFakeGateway } from './fake-gateway'

const GATEWAY_PORT = 4791
const SECRET = 'ui-preview-secret'

process.env.SHEETS_GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`
process.env.SHEETS_GATEWAY_SECRET = SECRET
process.env.PORT = '4000'
process.env.PUBLIC_BASE_URL = 'http://localhost:5174'
process.env.SESSION_SECRET = 'ui-preview-session-secret-0123456789abcdef'
// One-click demo login buttons on /login. On by default for local previewing;
// pass DEMO_LOGIN_HINTS=false to capture production-accurate screenshots.
process.env.DEMO_LOGIN_HINTS = process.env.DEMO_LOGIN_HINTS ?? 'true'
process.env.EXPOSE_RESET_TOKENS = 'true'

const gateway = createFakeGateway({ port: GATEWAY_PORT, secret: SECRET })
await gateway.listen()

const { prisma } = await import('../server/db')
const { hashPassword } = await import('../server/lib/auth')
const { ensureSheetsSchema, runWithSheetsWrite } = await import('../server/sheets/runtime')
const { publishReport } = await import('../server/lib/report')

const db = prisma as unknown as Record<string, any>
const password = hashPassword('Fixit@12345')
const now = Date.now()
const daysAgo = (days: number) => new Date(now - days * 86_400_000)

await ensureSheetsSchema()
await runWithSheetsWrite(async () => {
  await db.shop.upsert({
    where: { id: 'shop' },
    create: {
      id: 'shop',
      name: 'FIXIT AI Repair Lab',
      legalName: 'Fixit Device Services LLP',
      phone: '+91 98765 43210',
      email: 'care@fixitai.demo',
      address: '14, MG Road, Bengaluru, Karnataka 560001',
      gstin: '29ABCDE1234F1Z5',
      taxRate: 0,
      ownerApprovalThreshold: 0,
      lowStockAlerts: true,
    },
    update: {},
  })

  const owner = await db.user.create({
    data: {
      email: 'owner@fixit.local',
      name: 'Ravi Menon',
      role: 'OWNER',
      userId: 'OWNER01',
      phone: '9876500001',
      passwordHash: password,
    },
  })
  const techUser1 = await db.user.create({
    data: {
      email: 'tech1@fixit.local',
      name: 'Arjun Das',
      role: 'TECHNICIAN',
      userId: 'TECH01',
      phone: '9876500002',
      passwordHash: password,
    },
  })
  const techUser2 = await db.user.create({
    data: {
      email: 'tech2@fixit.local',
      name: 'Meena Joseph',
      role: 'TECHNICIAN',
      userId: 'TECH02',
      phone: '9876500003',
      passwordHash: password,
    },
  })
  const tech1 = await db.technician.create({
    data: {
      userId: techUser1.id,
      specialization: 'Smartphones · board-level diagnostics',
      phone: '9876500002',
      incentiveRate: 12,
      active: true,
    },
  })
  const tech2 = await db.technician.create({
    data: {
      userId: techUser2.id,
      specialization: 'Laptops · tablets · displays',
      phone: '9876500003',
      incentiveRate: 10,
      active: true,
    },
  })

  const supplier = await db.supplier.create({
    data: { name: 'Mobile Parts Hub', phone: '080-4123 8899', isDemo: true },
  })

  const partSpecs = [
    ['SMOKE-PORT', 'Samsung Galaxy A54 charging port flex', 'Charging', 450, 899, 6, 2],
    ['SMOKE-LCD', 'Redmi Note 10 Pro display assembly', 'Display', 4200, 6499, 1, 2],
    ['SMOKE-BATT', 'iPhone 13 battery', 'Battery', 1900, 2899, 4, 2],
  ]
  const parts: Array<Record<string, any>> = []
  for (const [sku, name, category, purchasePrice, sellingPrice, quantity, minStock] of partSpecs) {
    parts.push(
      await db.sparePart.create({
        data: {
          sku,
          name,
          category,
          quality: 'Compatible',
          supplierId: supplier.id,
          purchasePrice,
          sellingPrice,
          quantity,
          minStock,
          isDemo: true,
        },
      }),
    )
  }

  const customerSpecs = [
    ['Priya Sharma', '9812345670', 'priya@example.com', 'Smartphone', 'Samsung', 'Galaxy A54 5G'],
    ['Mohammed Irfan', '9823456781', 'irfan@example.com', 'Smartphone', 'Apple', 'iPhone 13'],
    ['Ananya Rao', '9834567892', 'ananya@example.com', 'Laptop', 'HP', 'Pavilion 15'],
    ['Vikram Singh', '9845678903', 'vikram@example.com', 'Tablet', 'Apple', 'iPad Air 4'],
  ]
  const customers: Array<Record<string, any>> = []
  for (const [name, phone, email, category, brand, model] of customerSpecs) {
    const customer = await db.customer.create({
      data: { name, phone, email, isDemo: true, createdById: owner.id },
    })
    const device = await db.device.create({
      data: {
        customerId: customer.id,
        category,
        brand,
        model,
        color: 'Midnight',
        isDemo: true,
        createdById: owner.id,
      },
    })
    customers.push({ ...customer, deviceId: device.id })
  }

  const repairSpecs: Array<{
    n: number
    customer: number
    tech: Record<string, any>
    status: string
    problem: string
    createdAtDays: number
    completed?: boolean
    delivered?: boolean
    cancelled?: boolean
    quote?: [number, number, number, number]
  }> = [
    {
      n: 1,
      customer: 0,
      tech: tech1,
      status: 'DELIVERED',
      problem: 'Phone is not charging, started 3 days ago',
      createdAtDays: 12,
      completed: true,
      delivered: true,
      quote: [899, 450, 0, 150],
    },
    {
      n: 2,
      customer: 1,
      tech: tech1,
      status: 'REPAIR_IN_PROGRESS',
      problem: 'Battery drains quickly and shuts down at 20%',
      createdAtDays: 4,
      quote: [2899, 500, 0, 300],
    },
    {
      n: 3,
      customer: 2,
      tech: tech2,
      status: 'READY_FOR_PICKUP',
      problem: 'Screen flickers when opening the lid',
      createdAtDays: 8,
      completed: true,
      quote: [6499, 900, 200, 500],
    },
    {
      n: 4,
      customer: 3,
      tech: tech2,
      status: 'CANCELLED',
      problem: 'Cracked display after a drop',
      createdAtDays: 20,
      cancelled: true,
    },
  ]

  for (const spec of repairSpecs) {
    const customer = customers[spec.customer]
    const createdAt = daysAgo(spec.createdAtDays)
    const completedAt = spec.completed ? daysAgo(spec.createdAtDays - 2) : null
    const deliveredAt = spec.delivered ? daysAgo(spec.createdAtDays - 3) : null
    const repair = await db.repair.create({
      data: {
        code: `FIX-${new Date().getFullYear()}-${String(spec.n).padStart(4, '0')}`,
        customerId: customer.id,
        deviceId: customer.deviceId,
        technicianId: spec.tech.id,
        createdById: spec.tech.userId,
        status: spec.status,
        priority: spec.n === 2 ? 'HIGH' : 'NORMAL',
        problem: spec.problem,
        confirmedFault: spec.n === 1 ? 'Charging port connector damaged' : null,
        warrantyDays: spec.n === 1 ? 90 : 0,
        internalNotes: 'Demo record. Do not use as real business data.',
        createdAt,
        updatedAt: completedAt ?? createdAt,
        completedAt,
        deliveredAt,
        cancelledAt: spec.cancelled ? daysAgo(spec.createdAtDays - 1) : null,
        isDemo: true,
      },
    })

    await db.repairActivity.create({
      data: {
        repairId: repair.id,
        userId: spec.tech.userId,
        type: 'STATUS',
        note: 'Repair request created',
        meta: JSON.stringify({ status: 'NEW_REQUEST' }),
        createdAt,
      },
    })

    if (spec.quote) {
      const [partsTotal, labour, other, discount] = spec.quote
      const customerTotal = partsTotal + labour + other - discount
      await db.quotation.create({
        data: {
          repairId: repair.id,
          version: 1,
          status: 'APPROVED',
          partsTotal,
          labourCharge: labour,
          otherExpenses: other,
          discount,
          customerTotal,
          estimatedPartsCost: partsTotal * 0.7,
          actualPartsCost: partsTotal * 0.65,
          otherCost: 0,
          technicianIncentive: customerTotal * 0.1,
          netProfit: customerTotal - partsTotal * 0.65,
          customerDecision: 'ACCEPTED',
          decidedAt: completedAt ?? createdAt,
          createdById: spec.tech.userId,
          approvedById: owner.id,
          approvedAt: completedAt ?? createdAt,
          createdAt,
          updatedAt: completedAt ?? createdAt,
        },
      })
      if (spec.delivered) {
        await db.payment.create({
          data: {
            repairId: repair.id,
            amount: customerTotal,
            method: 'UPI',
            reference: 'UPI-DEMO-1001',
            paidAt: deliveredAt,
            recordedById: owner.id,
            createdAt: deliveredAt,
          },
        })
        // Publish through the real report builder so the public /r/:token page
        // renders exactly what production customers see.
        await publishReport(repair.id)
      }
    }
  }

  await db.expense.create({
    data: {
      category: 'Rent',
      amount: 18000,
      note: 'Workshop rent',
      incurredAt: daysAgo(6),
      createdById: owner.id,
      isDemo: true,
    },
  })
  await db.expense.create({
    data: {
      category: 'Utilities',
      amount: 2400,
      note: 'Electricity',
      incurredAt: daysAgo(3),
      createdById: owner.id,
      isDemo: true,
    },
  })

  await db.notification.createMany({
    data: [
      {
        role: 'OWNER',
        type: 'APPROVAL',
        title: 'Quotation awaiting approval: FIX-2026-0002',
        body: 'Battery replacement for iPhone 13 — ₹3,699.00',
        link: '/repairs',
        createdAt: daysAgo(1),
      },
      {
        userId: techUser1.id,
        type: 'APPROVAL',
        title: 'Quotation approved: FIX-2026-0001',
        body: 'Charging port replacement is approved.',
        link: '/repairs',
        createdAt: daysAgo(2),
      },
      {
        role: 'OWNER',
        type: 'LOW_STOCK',
        title: 'Low stock: Redmi Note 10 Pro display assembly',
        body: '1 left (minimum 2).',
        link: '/inventory',
        createdAt: daysAgo(3),
      },
    ],
  })
})

await import('../server/index')
