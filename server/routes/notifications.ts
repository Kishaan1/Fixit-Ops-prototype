import { Router } from 'express'
import { prisma } from '../db'
import { requireAuth } from '../lib/auth'
import { asyncRoute, HttpError , param } from '../lib/http'

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

function scopeWhere(user: { id: string; role: string }) {
  return {
    OR: [
      { userId: user.id },
      { role: user.role === 'OWNER' ? 'OWNER' : 'TECHNICIAN' },
    ],
  }
}

notificationsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const where = scopeWhere(req.user!)
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { ...where, read: false } }),
    ])
    res.json({ items, unread })
  }),
)

notificationsRouter.post(
  '/:id/read',
  asyncRoute(async (req, res) => {
    const notification = await prisma.notification.findFirst({
      where: { id: param(req, 'id'), ...scopeWhere(req.user!) },
    })
    if (!notification) throw new HttpError(404, 'Notification not found.')
    await prisma.notification.update({ where: { id: notification.id }, data: { read: true } })
    res.json({ ok: true })
  }),
)

notificationsRouter.post(
  '/read-all',
  asyncRoute(async (req, res) => {
    await prisma.notification.updateMany({
      where: { ...scopeWhere(req.user!), read: false },
      data: { read: true },
    })
    res.json({ ok: true })
  }),
)
