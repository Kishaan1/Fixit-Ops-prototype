import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Check,
  FlipHorizontal,
  Image as ImageIcon,
  ImagePlus,
  Lightbulb,
  Loader2,
  RefreshCw,
  Upload,
  Video,
  VideoOff,
  X,
} from 'lucide-react'
import { Button, Modal } from './ui'
import {
  IMAGE_ACCEPT,
  IMAGE_FORMATS_LABEL,
  MAX_IMAGE_MB,
  useImageDrop,
  validateImageFile,
} from './ImageDropzone'

interface CameraCaptureModalProps {
  open: boolean
  onClose: () => void
  onCapture: (file: File) => void
  title?: string
}

export function CameraCaptureModal({
  open,
  onClose,
  onCapture,
  title = 'Capture Device Photo',
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [dropError, setDropError] = useState<string | null>(null)
  const [mode, setMode] = useState<'camera' | 'upload'>('camera')
  const [starting, setStarting] = useState(false)

  // Start / stop camera stream
  useEffect(() => {
    if (!open || mode !== 'camera') {
      stopStream()
      return
    }

    let active = true
    const startCamera = async () => {
      setStarting(true)
      setCameraError(null)
      stopStream()

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported by this browser.')
        }

        const newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })

        if (!active) {
          newStream.getTracks().forEach((track) => track.stop())
          return
        }

        setStream(newStream)
        if (videoRef.current) {
          videoRef.current.srcObject = newStream
          await videoRef.current.play().catch(() => {})
        }
      } catch (err: any) {
        console.warn('Primary camera setup failed, trying basic fallback:', err)
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          })
          if (!active) {
            fallbackStream.getTracks().forEach((t) => t.stop())
            return
          }
          setStream(fallbackStream)
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream
            await videoRef.current.play().catch(() => {})
          }
        } catch (fallbackErr: any) {
          setCameraError(
            err.name === 'NotAllowedError'
              ? 'Camera permission was denied. Please allow camera access in your browser settings or upload a photo instead.'
              : 'Could not connect to camera device. Please upload a photo instead.',
          )
        }
      } finally {
        setStarting(false)
      }
    }

    void startCamera()

    return () => {
      active = false
      stopStream()
    }
  }, [open, facingMode, mode])

  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  const handleClose = () => {
    stopStream()
    if (capturedUrl) URL.revokeObjectURL(capturedUrl)
    setCapturedBlob(null)
    setCapturedUrl(null)
    setCameraError(null)
    setDropError(null)
    onClose()
  }

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
  }

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current

    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // If front camera, mirror image back for natural view
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        setCapturedBlob(blob)
        if (capturedUrl) URL.revokeObjectURL(capturedUrl)
        setCapturedUrl(URL.createObjectURL(blob))
        stopStream()
      },
      'image/jpeg',
      0.92,
    )
  }

  const retake = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl)
    setCapturedBlob(null)
    setCapturedUrl(null)
    // Re-trigger camera
    setMode('camera')
  }

  const confirmCapture = () => {
    if (!capturedBlob) return
    const filename = `device-capture-${Date.now()}.jpg`
    const file = new File([capturedBlob], filename, { type: 'image/jpeg' })
    onCapture(file)
    handleClose()
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const message = validateImageFile(file)
    if (message) {
      setDropError(message)
      return
    }
    setDropError(null)
    onCapture(file)
    handleClose()
  }

  const { dragging, dropProps } = useImageDrop({
    onFile: (file) => {
      setDropError(null)
      onCapture(file)
      handleClose()
    },
    onError: (message) => setDropError(message),
    disabled: !open,
  })

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      description="Capture a clear view of the device front, back, or model label for AI identification and intake inspection."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>

          {capturedBlob ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" icon={RefreshCw} onClick={retake}>
                Retake
              </Button>
              <Button icon={Check} onClick={confirmCapture}>
                Use This Photo
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                icon={Upload}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload from Files
              </Button>
              {mode === 'camera' && !cameraError && (
                <Button
                  icon={Camera}
                  onClick={captureFrame}
                  disabled={starting || !stream}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md shadow-indigo-500/20"
                >
                  Capture Now
                </Button>
              )}
            </div>
          )}
        </div>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={handleFileUpload}
      />
      <canvas ref={canvasRef} className="hidden" />

      <div className="space-y-4">
        {/* Mode selector pills */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              retake()
              setMode('camera')
            }}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition flex items-center justify-center gap-2 ${
              mode === 'camera'
                ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-300'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/[0.04]'
            }`}
          >
            <Video className="h-4 w-4" /> Live Camera
          </button>
          <button
            type="button"
            onClick={() => {
              stopStream()
              setMode('upload')
              fileInputRef.current?.click()
            }}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition flex items-center justify-center gap-2 ${
              mode === 'upload'
                ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-300'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/[0.04]'
            }`}
          >
            <ImageIcon className="h-4 w-4" /> Browse / Upload Image
          </button>
        </div>

        {/* Viewfinder or Captured Preview — also a drag-and-drop target */}
        <div
          {...dropProps}
          className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-950 flex items-center justify-center border shadow-inner transition ${
            dragging
              ? 'border-indigo-400 ring-2 ring-indigo-500 ring-offset-2 ring-offset-transparent'
              : 'border-slate-800'
          }`}
        >
          {capturedUrl ? (
            <div className="relative h-full w-full">
              <img
                src={capturedUrl}
                alt="Captured device"
                className="h-full w-full object-contain"
              />
              <div className="absolute top-3 left-3 rounded-full bg-emerald-500/90 text-white px-3 py-1 text-xs font-semibold flex items-center gap-1 shadow-lg backdrop-blur-sm">
                <Check className="h-3.5 w-3.5" /> Snapshot Captured
              </div>
            </div>
          ) : cameraError ? (
            <div className="p-6 text-center max-w-sm space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <VideoOff className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-slate-200">{cameraError}</p>
              <Button
                size="sm"
                variant="outline"
                icon={Upload}
                onClick={() => fileInputRef.current?.click()}
              >
                Select Image File Instead
              </Button>
            </div>
          ) : starting ? (
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <Loader2 className="h-7 w-7 animate-spin text-indigo-400" />
              <span className="text-xs font-medium">Connecting to camera sensor…</span>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="h-full w-full object-cover"
              />

              {/* Viewfinder overlay grid for inspection */}
              <div className="pointer-events-none absolute inset-0 border border-white/20 rounded-2xl">
                <div className="absolute inset-8 border border-dashed border-white/40 rounded-xl" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/40 text-[11px] font-mono tracking-wider uppercase bg-black/40 px-2 py-0.5 rounded backdrop-blur-xs">
                  Align Device Body / Model Label
                </div>
              </div>

              {/* Top controls: Switch camera */}
              <div className="absolute top-3 right-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleCamera}
                  className="rounded-full bg-black/60 p-2 text-white backdrop-blur-md transition hover:bg-black/80"
                  title="Switch front/rear camera"
                >
                  <FlipHorizontal className="h-4 w-4" />
                </button>
              </div>

              {/* Bottom Quick Trigger */}
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <button
                  type="button"
                  onClick={captureFrame}
                  className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white/80 bg-white shadow-2xl transition hover:scale-105 active:scale-95 cursor-pointer"
                  title="Take photo"
                >
                  <div className="h-10 w-10 rounded-full bg-indigo-600 shadow-inner" />
                </button>
              </div>
            </>
          )}

          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-600/35 p-4 text-center backdrop-blur-[1px]">
              <ImagePlus className="h-8 w-8 text-white" />
              <span className="text-sm font-bold text-white">Drop image here</span>
              <span className="text-[11px] font-medium text-indigo-100">
                {IMAGE_FORMATS_LABEL} · Maximum {MAX_IMAGE_MB} MB
              </span>
            </div>
          ) : null}
        </div>

        {dropError ? (
          <p className="flex items-start gap-1.5 text-xs font-medium leading-snug text-rose-600 dark:text-rose-400">
            <span className="min-w-0 break-words">{dropError}</span>
          </p>
        ) : null}

        <p className="flex items-start justify-center gap-1.5 text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">Tip:</span> Drag an
            image straight into the viewfinder, or ensure adequate bench lighting. If the branding or
            model number is faintly engraved, tilt the device slightly against the light.
          </span>
        </p>
      </div>
    </Modal>
  )
}

