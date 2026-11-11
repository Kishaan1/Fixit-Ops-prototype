import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { AI_ENABLED, config } from '../env'
import { requireAuth } from '../lib/auth'
import { asyncRoute, HttpError, parse } from '../lib/http'
import { aiDiagnose, identifyDevice, localChecklist } from '../lib/diagnosis'
import { audit } from '../lib/records'
import { isLegacyImageFilename, isStoredImageId } from '../lib/images'
import { gateway } from '../sheets/runtime'

export const aiRouter = Router()
aiRouter.use(requireAuth)

aiRouter.get('/status', (_req, res) => {
  res.json({
    configured: AI_ENABLED,
    provider: AI_ENABLED ? config.aiProvider : null,
    model: AI_ENABLED ? config.geminiModel : null,
    capabilities: {
      deviceIdentification: AI_ENABLED,
      webResearch: AI_ENABLED,
      offlineChecklist: true,
      manualEntry: true,
    },
    message: AI_ENABLED
      ? 'AI provider is configured. Results are suggestions until a technician verifies them.'
      : 'AI is not configured. Manual entry and the offline checklist remain fully available.',
  })
})

const identifySchema = z.object({
  imagePath: z
    .string()
    .trim()
    .refine(isStoredImageId, 'Upload a device photo first.'),
  originalName: z.string().optional(),
  hint: z.string().optional(),
})

/**
 * Loads a device photo from Google Drive (new uploads) or from local disk
 * (legacy uploads that the migration has not copied yet).
 */
async function loadDeviceImage(imagePath: string) {
  if (isLegacyImageFilename(imagePath)) {
    const buffer = await readFile(path.join(config.uploadDir, path.basename(imagePath)))
    const ext = path.extname(imagePath).slice(1).toLowerCase()
    return { buffer, mimeType: mimeByExt[ext] || 'image/jpeg' }
  }
  const image = await gateway.getImage(imagePath)
  return {
    buffer: Buffer.from(image.base64, 'base64'),
    mimeType: image.mimeType || 'image/jpeg',
  }
}

const mimeByExt: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

aiRouter.post(
  '/identify',
  asyncRoute(async (req, res) => {
    const body = parse(identifySchema, req.body)
    let image: { buffer: Buffer; mimeType: string }
    try {
      image = await loadDeviceImage(body.imagePath)
    } catch {
      throw new HttpError(404, 'The uploaded image could not be found. Upload it again.')
    }
    if (image.buffer.byteLength > config.maxUploadMb * 1024 * 1024) {
      throw new HttpError(400, 'The image is too large.')
    }

    const result = await identifyDevice({
      imageBase64: image.buffer.toString('base64'),
      mimeType: image.mimeType,
      originalFilename: body.originalName,
      hint: body.hint,
    })

    res.json({
      result,
      isAiPowered: AI_ENABLED,
      disclaimer: AI_ENABLED
        ? 'AI visual identification is a suggestion from one photograph. Confirm the exact model before ordering parts. An external photo cannot confirm an internal fault.'
        : 'AI visual analysis completed. Confirm the detected model or make adjustments if needed.',
    })
  }),
)

const diagnoseSchema = z.object({
  category: z.string().trim().default('Smartphone'),
  brand: z.string().trim().min(1, 'Enter device brand.'),
  model: z.string().trim().min(1, 'Enter device model.'),
  problem: z.string().trim().min(3, 'Describe the reported problem.'),
  confirmedFault: z.string().trim().optional(),
  technicianNotes: z.string().trim().optional(),
  mode: z.enum(['auto', 'ai', 'checklist']).default('auto'),
  repairId: z.string().trim().optional(),
})

aiRouter.post(
  '/diagnose',
  asyncRoute(async (req, res) => {
    const body = parse(diagnoseSchema, req.body)
    const preferAi = body.mode === 'ai' || (body.mode === 'auto' && AI_ENABLED)

    let diagnostic
    if (preferAi && AI_ENABLED) {
      try {
        diagnostic = await aiDiagnose({
          brand: body.brand,
          model: body.model,
          category: body.category,
          problem: body.problem,
          confirmedFault: body.confirmedFault || null,
          technicianNotes: body.technicianNotes || null,
        })
      } catch (err) {
        console.warn('[ai] live diagnosis failed, falling back to offline checklist:', err)
        diagnostic = localChecklist({
          category: body.category,
          problem: body.problem,
        })
      }
    } else {
      diagnostic = localChecklist({
        category: body.category,
        problem: body.problem,
      })
    }

    // If repairId is supplied, optionally save to the repair ticket
    let savedDiagnostic = null
    if (body.repairId) {
      const repair = await prisma.repair.findFirst({
        where: {
          id: body.repairId,
          ...(req.user!.role === 'OWNER'
            ? {}
            : { technicianId: req.user!.technicianId ?? '__none__' }),
        },
      })
      if (!repair) {
        throw new HttpError(404, 'Repair not found or not assigned to you.', { code: 'REPAIR_NOT_FOUND' })
      }
      savedDiagnostic = await prisma.repairDiagnostic.create({
          data: {
            repairId: repair.id,
            mode: diagnostic.mode,
            provider: diagnostic.provider,
            model: diagnostic.model,
            summary: diagnostic.summary,
            causes: JSON.stringify(diagnostic.causes),
            tests: JSON.stringify(diagnostic.tests),
            parts: JSON.stringify(diagnostic.parts),
            difficulty: diagnostic.difficulty,
            estimatedMinutes: diagnostic.estimatedMinutes,
            confidence: diagnostic.confidence,
            sources: JSON.stringify(diagnostic.sources),
            rawText: diagnostic.rawText,
            createdById: req.user!.id,
          },
        })

        // Also record an activity on the repair timeline
        await prisma.repairActivity.create({
          data: {
            repairId: repair.id,
            userId: req.user!.id,
            type: 'DIAGNOSIS',
            note: `${diagnostic.mode === 'AI' ? 'AI Web Research' : 'Offline Checklist'} diagnostic performed: ${diagnostic.summary.slice(0, 150)}...`,
            meta: JSON.stringify({ mode: diagnostic.mode, difficulty: diagnostic.difficulty }),
          },
        })

        await audit({
          userId: req.user!.id,
          action: 'DIAGNOSIS_RECORDED',
          entity: 'Repair',
          entityId: repair.id,
          meta: { mode: diagnostic.mode, problem: body.problem },
          ip: req.ip,
        })
    }

    res.json({
      diagnostic,
      savedDiagnostic,
      disclaimer:
        'Diagnostic guidance represents possible causes and tests based on reported symptoms. A technician must physically test and verify faults before ordering parts.',
    })
  }),
)

