import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Image as ImageIcon,
  Loader2,
  Trash2,
  User,
  Video,
  X,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { Button } from './ui'
import { ImageDropzone, IMAGE_FORMATS_LABEL, MAX_IMAGE_MB } from './ImageDropzone'

interface AvatarUploadProps {
  currentUrl?: string | null
  name?: string
  onChange: (url: string | null) => void
  label?: string
}

export function AvatarUpload({
  currentUrl,
  name = 'User',
  onChange,
  label = 'Profile Photo',
}: AvatarUploadProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const localPreviewRef = useRef<string | null>(null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const clearLocalPreview = () => {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current)
      localPreviewRef.current = null
    }
    setLocalPreview(null)
  }

  useEffect(() => {
    return () => {
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current)
    }
  }, [])

  const uploadFile = async (file: File) => {
    setError(null)
    clearLocalPreview()
    const localUrl = URL.createObjectURL(file)
    localPreviewRef.current = localUrl
    setLocalPreview(localUrl)
    setUploading(true)

    try {
      const res = await api.upload<{ url: string }>('/uploads', file)
      onChange(res.url)
    } catch (err) {
      setError(errorMessage(err) || 'Failed to upload photo.')
      clearLocalPreview()
    } finally {
      setUploading(false)
      clearLocalPreview()
    }
  }

  const startCamera = async () => {
    setError(null)
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
      })
      setStream(nextStream)
      setCameraActive(true)
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = nextStream
          videoRef.current.play()
        }
      }, 100)
    } catch (err) {
      setError('Unable to access webcam: ' + errorMessage(err))
    }
  }

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
    setCameraActive(false)
  }

  const capturePhoto = async () => {
    if (!videoRef.current) return
    setError(null)
    try {
      const video = videoRef.current
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 480
      canvas.height = video.videoHeight || 480
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not capture photo')
      context.drawImage(video, 0, 0, canvas.width, canvas.height)

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      )
      if (!blob) throw new Error('Could not capture photo')
      stopCamera()
      await uploadFile(new File([blob], 'webcam-avatar.jpg', { type: 'image/jpeg' }))
    } catch (err) {
      setError(errorMessage(err) || 'Failed to capture photo from webcam.')
    }
  }

  const removePhoto = () => {
    clearLocalPreview()
    setError(null)
    onChange(null)
  }

  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'U'

  const displayUrl = localPreview || currentUrl || null

  return (
    <div className="space-y-3">
      {label ? (
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</label>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <ImageDropzone
          onFile={uploadFile}
          onError={setError}
          disabled={uploading}
          showError={false}
          ariaLabel="Profile photo upload. Drag and drop an image here, or click to browse."
          className="relative flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 dark:border-white/20 dark:bg-white/[0.03] sm:h-36 sm:w-36"
        >
          {displayUrl ? (
            <img
              src={displayUrl}
              alt={name}
              className="absolute inset-0 h-full w-full object-cover"
              onError={(event) => {
                ;(event.target as HTMLElement).style.opacity = '0'
              }}
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-3 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400">
                <ImageIcon className="h-5 w-5" />
              </span>
              <span className="text-xs font-semibold leading-snug text-slate-700 dark:text-slate-200">
                Drag &amp; Drop Image Here
              </span>
              <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                Or <span className="font-semibold text-indigo-600 underline dark:text-indigo-400">Browse Files</span>
              </span>
            </div>
          )}

          {uploading ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-slate-950/55 text-white backdrop-blur-[1px]">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-[11px] font-semibold">Uploading…</span>
            </div>
          ) : null}

          {displayUrl && !uploading ? (
            <>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-950/65 py-1 text-center text-[10px] font-semibold text-white opacity-0 transition group-hover/dropzone:opacity-100">
                Drop or click to replace
              </div>
              <button
                type="button"
                data-dropzone-ignore
                onClick={(event) => {
                  event.stopPropagation()
                  removePhoto()
                }}
                title="Remove photo"
                aria-label="Remove profile photo"
                className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-white shadow-md transition hover:bg-rose-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}

          {!displayUrl && !uploading ? (
            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/85 text-[10px] font-bold text-slate-600 shadow-sm dark:bg-slate-900/80 dark:text-slate-300">
              {initials}
            </span>
          ) : null}
        </ImageDropzone>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || cameraActive}
              onClick={startCamera}
              className="text-xs"
            >
              <Camera className="h-3.5 w-3.5" />
              Use Camera
            </Button>
            {displayUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                onClick={removePhoto}
                className="text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <User className="h-3.5 w-3.5" />
                Your initials are shown until you add a photo.
              </span>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Drop an image directly inside the box, or click it to choose a file. Images are cropped to fit
            the profile frame.
          </p>
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {IMAGE_FORMATS_LABEL} · Maximum {MAX_IMAGE_MB} MB
          </p>
        </div>
      </div>

      {error ? (
        <p className="text-xs font-medium leading-snug text-rose-600 dark:text-rose-400">{error}</p>
      ) : null}

      {cameraActive ? (
        <div className="mt-3 space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-500/20 dark:bg-indigo-950/20">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-900 dark:text-indigo-200">
              <Video className="h-4 w-4 animate-pulse text-indigo-600 dark:text-indigo-400" /> Live Camera
              Preview
            </span>
            <button
              type="button"
              onClick={stopCamera}
              className="rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white"
              aria-label="Stop camera"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative mx-auto h-48 w-48 overflow-hidden rounded-xl bg-black shadow-inner">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          </div>

          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Button size="sm" onClick={capturePhoto} loading={uploading}>
              <Camera className="h-3.5 w-3.5" /> Snap &amp; Use Photo
            </Button>
            <Button variant="outline" size="sm" onClick={stopCamera}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
