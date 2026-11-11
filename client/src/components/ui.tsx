import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Loader2, SearchX, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

/* ------------------------------ spinner ------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('spinner h-4 w-4 animate-spin', className)} aria-hidden="true" />
}

/* ------------------------------ button ------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'btn bg-primary text-white hover:bg-primary-hover',
  secondary:
    'btn bg-text-secondary text-white hover:bg-text-primary/10',
  outline:
    'btn border-border text-text hover:bg-bg-subtle hover:text-primary',
  ghost:
    'btn hover:bg-bg-subtle hover:text-primary',
  danger:
    'btn bg-rose text-white hover:bg-rose-hover',
  success:
    'btn bg-emerald text-white hover:bg-emerald/90',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: 'btn',
  lg: 'btn-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: LucideIcon
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, icon: Icon, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-2.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner className="shrink-0" /> : Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      {children}
    </button>
  )
})

/* ------------------------------ card ------------------------------ */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return <div className={cn('surface', padded && 'p-5 sm:p-6', className)}>{children}</div>
}

export function SectionTitle({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            <Icon className="h-4.5 w-4.5" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  )
}

/* ------------------------------ badge ------------------------------ */

export type BadgeTone =
  | 'slate'
  | 'indigo'
  | 'blue'
  | 'cyan'
  | 'violet'
  | 'amber'
  | 'green'
  | 'red'
  | 'emerald'

const badgeTones: Record<BadgeTone, string> = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300',
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  cyan: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  green: 'bg-lime-50 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  red: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
}

export function Badge({
  children,
  tone = 'slate',
  className,
  dot = false,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-tight tracking-wide',
        badgeTones[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" /> : null}
      <span className="break-words">{children}</span>
    </span>
  )
}

/* ------------------------------ form ------------------------------ */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label?: string
  htmlFor?: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-1.5 text-rose-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1.5 flex items-start gap-1 text-xs font-medium leading-snug text-rose-600 dark:text-rose-400">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      ) : hint ? (
        <p className="mt-1.5 break-words text-xs leading-snug text-text-secondary dark:text-text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn('field-input', className)} {...props} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn('field-input min-h-24 resize-y', className)} {...props} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn('field-input select-field appearance-none pr-3', className)} {...props}>
        {children}
      </select>
    )
  },
)

/* ------------------------------ modal ------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  const widths = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
      <div className="fade-in fixed inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          'fade-in relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0d141d]',
          widths[size],
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/80 p-5 dark:border-white/10">
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
            {description ? (
              <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 p-4 dark:border-white/10">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  return (
    <Modal
      open={open}
      onClose={() => onOpenChange?.(false)}
      title={title}
      description={description}
      size={size}
    >
      {children}
    </Modal>
  )
}

/* ------------------------------ empty / error / loading ------------------------------ */

export function EmptyState({
  icon: Icon = SearchX,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/[0.06] dark:text-slate-500">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <EmptyState
      icon={AlertCircle}
      title="Something went wrong"
      description={message}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400">
      <Spinner className="h-5 w-5 text-indigo-500" />
      {label}
    </div>
  )
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4">
          <div className="skeleton h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-1/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
          <div className="skeleton h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/* ------------------------------ page header / stat ------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string
  description?: string
  actions?: ReactNode
  eyebrow?: string
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 break-words text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="break-words text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-[28px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl break-words text-sm text-slate-500 dark:text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      ) : null}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'indigo',
  trend,
}: {
  label: string
  value: string
  hint?: string
  icon: LucideIcon
  tone?: BadgeTone
  trend?: { value: string; positive?: boolean }
}) {
  const toneClasses: Record<BadgeTone, string> = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
    cyan: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
    green: 'bg-lime-50 text-lime-600 dark:bg-lime-500/10 dark:text-lime-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
    red: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
  }
  return (
    <div className="surface min-w-0 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-[12px] font-medium uppercase leading-snug tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', toneClasses[tone])}>
          <Icon className="h-4.5 w-4.5" />
        </span>
      </div>
      <p className="mt-3 break-words text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white">
        {value}
      </p>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {trend ? (
          <span
            className={cn(
              'shrink-0 text-xs font-semibold',
              trend.positive === false ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {trend.value}
          </span>
        ) : null}
        {hint ? (
          <p className="min-w-0 break-words text-xs leading-snug text-slate-500 dark:text-slate-400">{hint}</p>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------ tabs ------------------------------ */

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>
  value: string
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-1 border-b border-slate-200 dark:border-white/10', className)}>
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative shrink-0 px-3.5 py-2.5 text-sm font-medium transition',
              active
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            <span className="flex items-center gap-1.5">
              {tab.label}
              {tab.count !== undefined ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    active
                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400',
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </span>
            {active ? (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-indigo-500" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------ avatar ------------------------------ */

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white shadow-sm',
        className,
      )}
      title={name}
    >
      {initials || '?'}
    </span>
  )
}

/* ------------------------------ pagination ------------------------------ */

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
      <p className="whitespace-nowrap">
        Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{from}</span>–
        <span className="font-semibold text-slate-700 dark:text-slate-200">{to}</span> of{' '}
        <span className="font-semibold text-slate-700 dark:text-slate-200">{total}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <span className="whitespace-nowrap px-1">
          Page {page} / {pages}
        </span>
        <Button variant="outline" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>
          Next
        </Button>
      </div>
    </div>
  )
}
