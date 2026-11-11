import {
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { ImagePlus } from 'lucide-react'
import { cn } from './ui'

export const MAX_IMAGE_MB = 8
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
export const IMAGE_FORMATS_LABEL = 'JPG, JPEG, PNG or WEBP'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i

/** Validate an image before it is sent to the server. Returns a human message or null. */
export function validateImageFile(file: File, maxSizeMb = MAX_IMAGE_MB): string | null {
  const typeAllowed = ALLOWED_TYPES.has(file.type) || ALLOWED_EXTENSIONS.test(file.name)
  if (!typeAllowed) {
    return `That file type is not supported. Choose a ${IMAGE_FORMATS_LABEL} image.`
  }
  if (file.size > maxSizeMb * 1024 * 1024) {
    return `That image is too large. The maximum size is ${maxSizeMb} MB.`
  }
  if (file.size === 0) {
    return 'That image file is empty. Choose another file.'
  }
  return null
}

export function useImageDrop({
  onFile,
  onError,
  maxSizeMb = MAX_IMAGE_MB,
  disabled = false,
}: {
  onFile: (file: File) => void | Promise<void>
  onError?: (message: string) => void
  maxSizeMb?: number
  disabled?: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const reset = () => {
    depth.current = 0
    setDragging(false)
  }

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    depth.current += 1
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    if (!dragging) setDragging(true)
  }

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    reset()

    const file = event.dataTransfer?.files?.[0]
    if (!file) {
      onError?.('No image was found in the drop. Try dragging a single image file.')
      return
    }
    const message = validateImageFile(file, maxSizeMb)
    if (message) {
      onError?.(message)
      return
    }
    void onFile(file)
  }

  return {
    dragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}

export function ImageDropzone({
  onFile,
  onError,
  disabled = false,
  className,
  children,
  accept = IMAGE_ACCEPT,
  maxSizeMb = MAX_IMAGE_MB,
  ariaLabel = 'Upload an image. Drag and drop a file here, or click to browse.',
  showError = true,
  overlayLabel = 'Drop image here',
}: {
  onFile: (file: File) => void | Promise<void>
  onError?: (message: string) => void
  disabled?: boolean
  className?: string
  children: ReactNode
  accept?: string
  maxSizeMb?: number
  ariaLabel?: string
  showError?: boolean
  overlayLabel?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const report = (message: string) => {
    setError(message)
    onError?.(message)
  }

  const { dragging, dropProps } = useImageDrop({
    onFile: async (file) => {
      setError(null)
      await onFile(file)
    },
    onError: report,
    maxSizeMb,
    disabled,
  })

  const openPicker = () => {
    if (disabled) return
    inputRef.current?.click()
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const message = validateImageFile(file, maxSizeMb)
    if (message) {
      report(message)
      return
    }
    setError(null)
    void onFile(file)
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-dropzone-ignore]')) return
        openPicker()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openPicker()
        }
      }}
      {...dropProps}
      className={cn(
        'group/dropzone relative cursor-pointer outline-none transition focus-visible:ring-4 focus-visible:ring-indigo-500/20',
        disabled && 'cursor-not-allowed opacity-60',
        dragging && 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-transparent',
        className,
      )}
    >
      {children}

      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 rounded-[inherit] border-2 border-dashed border-indigo-500 bg-indigo-500/15 p-3 text-center backdrop-blur-[1px]">
          <ImagePlus className="h-7 w-7 text-indigo-600 dark:text-indigo-300" />
          <span className="text-xs font-bold text-indigo-700 dark:text-indigo-200">
            {overlayLabel}
          </span>
          <span className="text-[10px] font-medium text-indigo-600/80 dark:text-indigo-300/80">
            Release to upload
          </span>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
      />

      {showError && error ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium leading-snug text-rose-600 dark:text-rose-400">
          <span className="min-w-0 break-words">{error}</span>
        </p>
      ) : null}
    </div>
  )
}
