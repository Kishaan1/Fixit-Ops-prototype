import { randomBytes } from 'node:crypto'
import { prisma } from '../db'

export function newToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}

export async function audit(input: {
  userId?: string | null
  action: string
  entity: string
  entityId?: string | null
  meta?: unknown
  ip?: string
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        meta: input.meta === undefined ? null : JSON.stringify(input.meta),
        ip: input.ip,
      },
    })
  } catch (err) {
    // Audit failures must never make a legitimate business action fail silently,
    // but they must be visible in server logs.
    console.error('[audit] failed to write entry', err)
  }
}

export async function notify(input: {
  userId?: string | null
  role?: 'OWNER' | 'TECHNICIAN' | null
  type?: string
  title: string
  body?: string
  link?: string
}) {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId ?? null,
        role: input.role ?? null,
        type: input.type ?? 'INFO',
        title: input.title,
        body: input.body,
        link: input.link,
      },
    })
  } catch (err) {
    console.error('[notify] failed to write notification', err)
  }
}

export async function nextRepairCode() {
  const year = new Date().getFullYear()
  const prefix = `FIX-${year}-`
  const count = await prisma.repair.count({ where: { code: { startsWith: prefix } } })
  for (let i = count + 1; i < count + 1000; i++) {
    const code = `${prefix}${String(i).padStart(4, '0')}`
    const exists = await prisma.repair.findUnique({ where: { code }, select: { id: true } })
    if (!exists) return code
  }
  return `${prefix}${Date.now().toString().slice(-6)}`
}
