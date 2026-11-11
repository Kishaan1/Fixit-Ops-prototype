import { existsSync } from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { config } from '../env'
import { requireAuth } from '../lib/auth'
import { asyncRoute, HttpError, param } from '../lib/http'
import { isLegacyImageFilename } from '../lib/images'
import { gateway, sheetsConfigured } from '../sheets/runtime'
import { monthKeyForDate } from '../sheets/schema'

const allowed: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!allowed[file.mimetype]) {
      cb(new HttpError(400, 'Upload a JPG, PNG, WEBP or HEIC image.'))
      return
    }
    cb(null, true)
  },
})

export const uploadsRouter = Router()

uploadsRouter.post(
  '/',
  requireAuth,
  upload.single('image'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose an image to upload.')
    if (!sheetsConfigured()) {
      throw new HttpError(
        503,
        'Google Drive is not connected yet, so the image was not stored. Ask the owner to configure the Sheets gateway.',
        { code: 'SHEETS_NOT_CONFIGURED' },
      )
    }

    const file = req.file
    const result = await gateway.uploadImage({
      base64: file.buffer.toString('base64'),
      mimeType: file.mimetype,
      filename: file.originalname || 'image',
      monthKey: monthKeyForDate(new Date()),
    })

    res.status(201).json({
      filename: result.fileId,
      fileId: result.fileId,
      originalName: file.originalname,
      url: `/api/uploads/${result.fileId}`,
      webViewLink: result.url,
      size: result.size,
      storage: 'google-drive',
      monthKey: result.monthKey,
    })
  }),
)

uploadsRouter.get(
  '/:filename',
  asyncRoute(async (req, res) => {
    const filename = path.basename(param(req, 'filename'))

    // Legacy local uploads are still served until the migration has copied
    // them into Drive. New uploads never use local disk.
    if (isLegacyImageFilename(filename)) {
      const local = path.join(config.uploadDir, filename)
      if (!existsSync(local)) throw new HttpError(404, 'Image not found.')
      res.setHeader('cache-control', 'public, max-age=86400')
      res.sendFile(local)
      return
    }

    if (!sheetsConfigured()) throw new HttpError(503, 'Google Drive is not connected.')
    try {
      const image = await gateway.getImage(filename)
      const buffer = Buffer.from(image.base64, 'base64')
      res.setHeader('content-type', image.mimeType || 'image/jpeg')
      res.setHeader('content-length', String(buffer.byteLength))
      res.setHeader('cache-control', 'private, max-age=86400')
      res.send(buffer)
    } catch {
      throw new HttpError(404, 'Image not found.')
    }
  }),
)
