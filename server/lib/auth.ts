import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../db'
import { config } from '../env'
import { HttpError } from './http'

export const SESSION_COOKIE = 'fixit_session'
const SESSION_DAYS = 7

export type AuthUser = {
  id: string
  userId: string | null
  email: string
  name: string
  role: 'OWNER' | 'TECHNICIAN'
  phone: string | null
  active: boolean
  accountStatus: string
  profileImageUrl: string | null
  designation: string | null
  emailVerified: boolean
  mustChangePassword: boolean
  joiningDate: Date | null
  lastLogin: Date | null
  technicianId: string | null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
      sessionId?: string
    }
  }
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(password, salt, 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string, ip?: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await prisma.session.create({
    data: { id: hashToken(token), userId, expiresAt, ip, userAgent },
  })
  return { token, expiresAt }
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

export async function logAccountActivity(
  userId: string,
  activityType: string,
  activityDescription: string,
  ip?: string,
) {
  try {
    await prisma.accountActivityLog.create({
      data: {
        userId,
        activityType,
        activityDescription,
        ip: ip || null,
      },
    })
  } catch (err) {
    console.error('[activity-log] Failed to write log:', err)
  }
}

export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token || typeof token !== 'string') return next()
  try {
    const session = await prisma.session.findUnique({
      where: { id: hashToken(token) },
      include: { user: { include: { technician: true } } },
    })
    if (!session || session.expiresAt < new Date() || !session.user.active || session.user.accountStatus !== 'ACTIVE') {
      if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
      return next()
    }
    req.user = {
      id: session.user.id,
      userId: session.user.userId,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role === 'OWNER' ? 'OWNER' : 'TECHNICIAN',
      phone: session.user.phone,
      active: session.user.active,
      accountStatus: session.user.accountStatus,
      profileImageUrl: session.user.profileImageUrl,
      designation: session.user.designation,
      emailVerified: session.user.emailVerified,
      mustChangePassword: session.user.mustChangePassword,
      joiningDate: session.user.joiningDate,
      lastLogin: session.user.lastLogin,
      technicianId: session.user.technician?.id ?? null,
    }
    req.sessionId = session.id
    next()
  } catch (err) {
    next(err)
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.', { code: 'UNAUTHORIZED' }))
  if (req.user.mustChangePassword) {
    const path = req.originalUrl.split('?')[0]
    const allowed = [
      '/api/auth/me',
      '/api/auth/logout',
      '/api/auth/profile',
      '/api/auth/change-password',
      '/api/auth/first-login-change-password',
    ]
    if (!allowed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return next(
        new HttpError(403, 'Set a new password before using the rest of the workspace.', {
          code: 'PASSWORD_CHANGE_REQUIRED',
        }),
      )
    }
  }
  next()
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.', { code: 'UNAUTHORIZED' }))
  if (req.user.role !== 'OWNER') {
    return next(new HttpError(403, 'Only the shop owner can perform this action.', { code: 'FORBIDDEN' }))
  }
  next()
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    userId: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
    profileImageUrl: user.profileImageUrl,
    designation: user.designation,
    accountStatus: user.accountStatus,
    emailVerified: user.emailVerified,
    mustChangePassword: user.mustChangePassword,
    joiningDate: user.joiningDate,
    lastLogin: user.lastLogin,
    technicianId: user.technicianId,
  }
}
