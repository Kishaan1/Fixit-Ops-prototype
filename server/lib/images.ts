/**
 * Images are stored in Google Drive. Sheets holds only the Drive file ID or
 * the URL. Legacy local filenames remain readable so old records keep working
 * until the migration script has copied them to Drive.
 */
export const driveFileIdPattern = /^[A-Za-z0-9_-]{16,140}$/
export const legacyImagePattern = /^[a-f0-9]{32}\.(jpg|jpeg|png|webp|heic|heif)$/i

export function isStoredImageId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return driveFileIdPattern.test(value) || legacyImagePattern.test(value)
}

export function isLegacyImageFilename(value: string) {
  return legacyImagePattern.test(value)
}
