import { createHash } from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../db'
import { config } from '../env'
import {
  clearSessionCookie,
  createSession,
  hashPassword,
  logAccountActivity,
  publicUser,
  requireAuth,
  sessionMiddleware,
  setSessionCookie,
  verifyPassword,
} from '../lib/auth'
import { asyncRoute, HttpError, parse, param } from '../lib/http'
import { audit, notify, newToken } from '../lib/records'

export const authRouter = Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
})

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your User ID or Email.'),
  password: z.string().min(1, 'Enter your password.'),
  portal: z.enum(['OWNER', 'TECHNICIAN']).optional(),
  rememberMe: z.boolean().optional(),
})

// Unified and Portal-Aware Login Endpoint
authRouter.post(
  '/login',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const body = parse(loginSchema, req.body)
    const identifier = body.identifier.trim()

    // Match by email (case-insensitive) or by custom userId (case-insensitive)
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier.toLowerCase() },
          { userId: identifier },
          { userId: identifier.toUpperCase() },
        ],
      },
      include: { technician: true },
    })

    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw new HttpError(401, 'Invalid credentials. Please check your User ID / Email and password.', {
        code: 'INVALID_CREDENTIALS',
      })
    }

    // Check account status
    if (!user.active || user.accountStatus !== 'ACTIVE') {
      const statusMsg =
        user.accountStatus === 'INACTIVE'
          ? 'Your account has been deactivated by the shop administrator.'
          : user.accountStatus === 'SUSPENDED'
          ? 'Your account has been suspended. Please contact the shop owner.'
          : 'Your account is currently disabled.'
      throw new HttpError(403, statusMsg, { code: 'ACCOUNT_DISABLED' })
    }

    // Role-portal boundary check
    if (body.portal === 'OWNER' && user.role !== 'OWNER') {
      throw new HttpError(403, 'This is the Owner Portal. Technicians must sign in using the Technician Login portal.', {
        code: 'PORTAL_MISMATCH',
      })
    }
    if (body.portal === 'TECHNICIAN' && user.role !== 'TECHNICIAN') {
      throw new HttpError(403, 'This is the Technician Portal. Shop Owners must sign in using the Owner Login portal.', {
        code: 'PORTAL_MISMATCH',
      })
    }

    // Update lastLogin
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    })

    // Create session
    const { token, expiresAt } = await createSession(user.id, req.ip, req.get('user-agent') ?? undefined)
    setSessionCookie(res, token, expiresAt)

    // Clean old expired sessions
    await prisma.session
      .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
      .catch(() => {})

    // Log account activity & audit
    await logAccountActivity(
      user.id,
      'LOGIN',
      `Signed in successfully from ${req.ip || 'web interface'} (${body.portal ?? user.role} portal)`,
      req.ip,
    )
    await audit({
      userId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      ip: req.ip,
    })

    res.json({
      user: {
        id: user.id,
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role === 'OWNER' ? 'OWNER' : 'TECHNICIAN',
        phone: user.phone,
        profileImageUrl: user.profileImageUrl,
        designation: user.designation,
        accountStatus: user.accountStatus,
        emailVerified: user.emailVerified,
        mustChangePassword: user.mustChangePassword,
        joiningDate: user.joiningDate,
        lastLogin: user.lastLogin,
        technicianId: user.technician?.id ?? null,
      },
    })
  }),
)

authRouter.post(
  '/logout',
  sessionMiddleware,
  requireAuth,
  asyncRoute(async (req, res) => {
    if (req.sessionId) {
      await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => {})
    }
    if (req.user) {
      await logAccountActivity(req.user.id, 'LOGOUT', 'User logged out', req.ip)
    }
    clearSessionCookie(res)
    res.json({ ok: true })
  }),
)

authRouter.get(
  '/me',
  sessionMiddleware,
  asyncRoute(async (req, res) => {
    if (!req.user) {
      res.json({ user: null })
      return
    }
    res.json({ user: publicUser(req.user) })
  }),
)

// Technician Forgot Password Request
const technicianForgotSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your User ID or Email.'),
  notes: z.string().trim().max(300).optional(),
})

authRouter.post(
  '/forgot-password/technician',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const body = parse(technicianForgotSchema, req.body)
    const identifier = body.identifier.trim()

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier.toLowerCase() },
          { userId: identifier },
          { userId: identifier.toUpperCase() },
        ],
      },
      include: { technician: true },
    })

    if (!user) {
      // Avoid account enumeration in production. Development returns a clear
      // error so the demo flow is easy to test.
      if (config.isProd) {
        return res.json({
          ok: true,
          message: 'If an account exists for that User ID or email, a reset request has been recorded for the shop owner.',
        })
      }
      throw new HttpError(404, 'No account found matching that User ID or Email.')
    }

    if (user.role !== 'TECHNICIAN') {
      throw new HttpError(400, 'This recovery request is for technicians only. Shop owners should use Owner Password Recovery.')
    }

    // Check for existing pending request
    const existing = await prisma.passwordResetRequest.findFirst({
      where: {
        userId: user.id,
        requestStatus: 'PENDING',
      },
    })

    if (existing) {
      return res.json({
        ok: true,
        alreadyPending: true,
        requestId: existing.id,
        message: 'A password reset request is already pending review with the shop owner.',
      })
    }

    // Create password reset request
    const request = await prisma.passwordResetRequest.create({
      data: {
        userId: user.id,
        requestStatus: 'PENDING',
        notes: body.notes || 'Technician forgot password request via portal',
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
      },
    })

    await logAccountActivity(
      user.id,
      'PASSWORD_RESET_REQUESTED',
      'Submitted password reset request to Shop Owner',
      req.ip,
    )

    await notify({
      role: 'OWNER',
      type: 'PASSWORD_RESET',
      title: 'Technician Password Reset Request',
      body: `${user.name} (${user.userId || user.email}) has requested a password reset.`,
      link: '/owner/password-requests',
    })

    res.json({
      ok: true,
      requestId: request.id,
      message: 'Password reset request submitted successfully. The Shop Owner will review your request and issue a temporary password or reset link.',
    })
  }),
)

// Owner Forgot Password Request (Email verification token link)
const ownerForgotSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter your registered owner email address.'),
})

authRouter.post(
  '/forgot-password/owner',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const body = parse(ownerForgotSchema, req.body)
    const user = await prisma.user.findUnique({
      where: { email: body.email },
    })

    if (!user || user.role !== 'OWNER') {
      // Do not disclose whether an owner account exists in production.
      if (config.isProd) {
        return res.json({
          ok: true,
          message: 'If that email belongs to the shop owner, a password reset link has been generated and recorded for the administrator.',
        })
      }
      throw new HttpError(404, 'No registered shop owner found with this email address.')
    }

    const rawToken = newToken(32)
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')

    // Only the newest link stays valid.
    await prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id, verifiedAt: null },
    })

    // Save token with 1 hour expiry
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        email: user.email,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })

    await logAccountActivity(
      user.id,
      'PASSWORD_RESET_REQUESTED',
      'Requested owner password reset link via registered email',
      req.ip,
    )

    // For local development, return the reset token and URL directly. In
    // production never put a reset token in the HTTP response: log it for the
    // administrator until a transactional email provider is configured.
    const resetUrl = `/reset-password?token=${rawToken}`

    if (!config.exposeResetTokens) {
      console.warn(`[auth] Owner password reset link for ${user.email}: ${config.publicBaseUrl}${resetUrl}`)
      return res.json({
        ok: true,
        message: 'If that email belongs to the shop owner, a password reset link has been generated. Contact the platform administrator to receive it through a verified channel.',
      })
    }

    res.json({
      ok: true,
      token: rawToken,
      resetUrl,
      devOnly: true,
      message: 'A secure password reset link has been generated. Use the link to set your new password.',
    })
  }),
)

// Verify reset token
authRouter.get(
  '/verify-reset-token/:token',
  asyncRoute(async (req, res) => {
    const rawToken = param(req, 'token')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')

    const tokenRecord = await prisma.emailVerificationToken.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: new Date() },
        verifiedAt: null,
      },
      include: { user: true },
    })

    if (!tokenRecord) {
      return res.status(400).json({ valid: false, error: 'Password reset link is invalid or has expired.' })
    }

    res.json({
      valid: true,
      email: tokenRecord.email,
      name: tokenRecord.user.name,
      role: tokenRecord.user.role,
    })
  }),
)

// Perform Reset Password via Token
const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required.'),
  newPassword: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .regex(/[A-Za-z]/, 'Include at least one letter.')
    .regex(/[0-9]/, 'Include at least one number.'),
})

authRouter.post(
  '/reset-password',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const body = parse(resetPasswordSchema, req.body)
    const tokenHash = createHash('sha256').update(body.token).digest('hex')

    const tokenRecord = await prisma.emailVerificationToken.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: new Date() },
        verifiedAt: null,
      },
      include: { user: true },
    })

    if (!tokenRecord) {
      throw new HttpError(400, 'Password reset link is invalid or has expired.')
    }

    // Update user password and clear mustChangePassword
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: {
          passwordHash: hashPassword(body.newPassword),
          mustChangePassword: false,
        },
      })
      await tx.emailVerificationToken.update({
        where: { id: tokenRecord.id },
        data: { verifiedAt: new Date() },
      })
      // Invalidate all active sessions for security
      await tx.session.deleteMany({
        where: { userId: tokenRecord.userId },
      })
    })

    await logAccountActivity(
      tokenRecord.userId,
      'PASSWORD_RESET_COMPLETED',
      'Password reset completed successfully via verified link',
      req.ip,
    )

    res.json({
      ok: true,
      message: 'Your password has been successfully reset. You can now sign in with your new password.',
    })
  }),
)

// Mandatory Password Change on First Login
const firstLoginChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your temporary password.'),
  newPassword: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .regex(/[A-Za-z]/, 'Include at least one letter.')
    .regex(/[0-9]/, 'Include at least one number.'),
})

authRouter.post(
  '/first-login-change-password',
  sessionMiddleware,
  requireAuth,
  asyncRoute(async (req, res) => {
    const body = parse(firstLoginChangePasswordSchema, req.body)
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user || !verifyPassword(body.currentPassword, user.passwordHash)) {
      throw new HttpError(400, 'Current temporary password is incorrect.')
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(body.newPassword),
        mustChangePassword: false,
      },
    })

    await logAccountActivity(
      user.id,
      'PASSWORD_CHANGED',
      'Completed mandatory initial password update',
      req.ip,
    )

    res.json({ ok: true, message: 'Password updated successfully.' })
  }),
)

// Authenticated Change Password
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .regex(/[A-Za-z]/, 'Include at least one letter.')
      .regex(/[0-9]/, 'Include at least one number.'),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'The new password must be different from the current password.',
    path: ['newPassword'],
  })

authRouter.post(
  '/change-password',
  sessionMiddleware,
  requireAuth,
  asyncRoute(async (req, res) => {
    const body = parse(changePasswordSchema, req.body)
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user || !verifyPassword(body.currentPassword, user.passwordHash)) {
      throw new HttpError(400, 'Current password is incorrect.')
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(body.newPassword),
        mustChangePassword: false,
      },
    })

    // Invalidate other sessions
    await prisma.session.deleteMany({
      where: { userId: user.id, id: { not: req.sessionId } },
    })

    await logAccountActivity(
      user.id,
      'PASSWORD_CHANGED',
      'Changed account password',
      req.ip,
    )
    await audit({
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      entity: 'User',
      entityId: user.id,
      ip: req.ip,
    })

    res.json({ ok: true, message: 'Password changed successfully.' })
  }),
)

// Authenticated Change Registered Email
const changeEmailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  currentPassword: z.string().min(1, 'Enter your current password for security verification.'),
})

authRouter.post(
  '/change-email',
  sessionMiddleware,
  requireAuth,
  asyncRoute(async (req, res) => {
    const body = parse(changeEmailSchema, req.body)
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user || !verifyPassword(body.currentPassword, user.passwordHash)) {
      throw new HttpError(400, 'Current password verification failed.')
    }

    if (user.email === body.newEmail) {
      throw new HttpError(400, 'The new email must be different from your current email.')
    }

    const existing = await prisma.user.findUnique({ where: { email: body.newEmail } })
    if (existing) {
      throw new HttpError(409, 'An account with this email address already exists.')
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        email: body.newEmail,
        emailVerified: true,
      },
    })

    await logAccountActivity(
      user.id,
      'EMAIL_CHANGED',
      `Changed registered email from ${user.email} to ${body.newEmail}`,
      req.ip,
    )

    res.json({
      ok: true,
      email: body.newEmail,
      message: 'Email address updated successfully.',
    })
  }),
)

// Authenticated Full Profile
authRouter.get(
  '/profile',
  sessionMiddleware,
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        technician: {
          include: {
            repairs: {
              select: {
                id: true,
                status: true,
                createdAt: true,
              },
            },
            incentives: {
              select: {
                amount: true,
              },
            },
          },
        },
        activityLogs: {
          orderBy: { timestamp: 'desc' },
          take: 20,
        },
      },
    })

    if (!user) throw new HttpError(404, 'User not found.')

    const technician = user.technician
    const repairs = technician?.repairs ?? []
    const totalAssigned = repairs.length
    const completedCount = repairs.filter((r) =>
      ['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED'].includes(r.status),
    ).length
    const totalIncentives = technician?.incentives.reduce((sum, i) => sum + i.amount, 0) ?? 0

    res.json({
      profile: {
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
        createdAt: user.createdAt,
        technicianId: technician?.id ?? null,
        specialization: technician?.specialization ?? null,
        incentiveRate: technician?.incentiveRate ?? null,
        stats: technician
          ? {
              totalAssigned,
              completedCount,
              totalIncentives,
            }
          : null,
        activityLogs: user.activityLogs.map((l) => ({
          id: l.id,
          activityType: l.activityType,
          activityDescription: l.activityDescription,
          timestamp: l.timestamp,
          ip: l.ip,
        })),
      },
    })
  }),
)

// Authenticated Update Profile
const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120).optional(),
  phone: z.string().trim().max(25).optional().or(z.literal('')),
  userId: z.string().trim().min(3, 'User ID must be at least 3 characters.').max(50).regex(/^[A-Za-z0-9_-]+$/, 'User ID can only contain letters, numbers, hyphens, and underscores.').optional(),
  profileImageUrl: z.string().trim().nullable().optional(),
  designation: z.string().trim().max(100).optional().or(z.literal('')),
})

authRouter.patch(
  '/profile',
  sessionMiddleware,
  requireAuth,
  asyncRoute(async (req, res) => {
    const body = parse(updateProfileSchema, req.body)

    // Check unique User ID if changed
    if (body.userId) {
      const existing = await prisma.user.findFirst({
        where: {
          userId: body.userId,
          id: { not: req.user!.id },
        },
      })
      if (existing) {
        throw new HttpError(409, `User ID "${body.userId}" is already in use by another account.`)
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.userId ? { userId: body.userId } : {}),
        ...(body.profileImageUrl !== undefined ? { profileImageUrl: body.profileImageUrl } : {}),
        ...(body.designation !== undefined ? { designation: body.designation || null } : {}),
      },
    })

    // If technician, sync phone
    if (req.user!.technicianId && body.phone !== undefined) {
      await prisma.technician.update({
        where: { id: req.user!.technicianId },
        data: { phone: body.phone || null },
      }).catch(() => {})
    }

    await logAccountActivity(
      req.user!.id,
      'PROFILE_UPDATED',
      'Updated account profile details',
      req.ip,
    )

    res.json({
      user: {
        id: updated.id,
        userId: updated.userId,
        email: updated.email,
        name: updated.name,
        role: updated.role === 'OWNER' ? 'OWNER' : 'TECHNICIAN',
        phone: updated.phone,
        profileImageUrl: updated.profileImageUrl,
        designation: updated.designation,
        accountStatus: updated.accountStatus,
        emailVerified: updated.emailVerified,
        mustChangePassword: updated.mustChangePassword,
        joiningDate: updated.joiningDate,
        lastLogin: updated.lastLogin,
        technicianId: req.user!.technicianId,
      },
      message: 'Profile updated successfully.',
    })
  }),
)
