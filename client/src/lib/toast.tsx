import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react'
import { cn } from '../components/ui'

type ToastTone = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  title: string
  description?: string
  tone: ToastTone
}

interface ToastContextValue {
  toast: (title: string, options?: { description?: string; tone?: ToastTone }) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const tones: Record<ToastTone, { icon: typeof CheckCircle2; className: string; iconClass: string }> = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-white dark:border-emerald-500/20 dark:bg-[#0d141d]',
    iconClass: 'text-emerald-500',
  },
  error: {
    icon: XCircle,
    className: 'border-rose-200 bg-white dark:border-rose-500/20 dark:bg-[#0d141d]',
    iconClass: 'text-rose-500',
  },
  warning: {
    icon: TriangleAlert,
    className: 'border-amber-200 bg-white dark:border-amber-500/20 dark:bg-[#0d141d]',
    iconClass: 'text-amber-500',
  },
  info: {
    icon: Info,
    className: 'border-indigo-200 bg-white dark:border-indigo-500/20 dark:bg-[#0d141d]',
    iconClass: 'text-indigo-500',
  },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (title: string, options?: { description?: string; tone?: ToastTone }) => {
      const id = ++counter.current
      setToasts((current) => [
        ...current.slice(-4),
        { id, title, description: options?.description, tone: options?.tone ?? 'info' },
      ])
      window.setTimeout(() => dismiss(id), 5200)
    },
    [dismiss],
  )

  const success = useCallback(
    (title: string, description?: string) => toast(title, { description, tone: 'success' }),
    [toast],
  )
  const error = useCallback(
    (title: string, description?: string) => toast(title, { description, tone: 'error' }),
    [toast],
  )

  const value = useMemo(() => ({ toast, success, error }), [toast, success, error])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end">
        {toasts.map((item) => {
          const tone = tones[item.tone]
          const Icon = tone.icon
          return (
            <div
              key={item.id}
              className={cn(
                'toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-4 shadow-lg shadow-slate-900/5',
                tone.className,
              )}
              role="status"
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone.iconClass)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                {item.description ? (
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {item.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
