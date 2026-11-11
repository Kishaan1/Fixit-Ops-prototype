import { Star } from 'lucide-react'
import { cn } from './ui'
import type { BadgeTone } from './ui'

const statusTones: Record<string, BadgeTone> = {
  NEW_REQUEST: 'blue',
  DEVICE_RECEIVED: 'blue',
  AI_DIAGNOSIS_COMPLETED: 'violet',
  AWAITING_INSPECTION: 'violet',
  ESTIMATE_PREPARED: 'amber',
  AWAITING_OWNER_APPROVAL: 'amber',
  AWAITING_CUSTOMER_APPROVAL: 'amber',
  PARTS_ORDERED: 'cyan',
  REPAIR_IN_PROGRESS: 'cyan',
  QUALITY_CHECK: 'violet',
  COMPLETED: 'green',
  READY_FOR_PICKUP: 'green',
  DELIVERED: 'emerald',
  CANCELLED: 'red',
}

const priorityTones: Record<string, BadgeTone> = {
  LOW: 'slate',
  NORMAL: 'blue',
  HIGH: 'amber',
  URGENT: 'red',
}

export const STATUS_LABELS: Record<string, string> = {
  NEW_REQUEST: 'New Request',
  DEVICE_RECEIVED: 'Device Received',
  AI_DIAGNOSIS_COMPLETED: 'AI Diagnosis Completed',
  AWAITING_INSPECTION: 'Awaiting Inspection',
  ESTIMATE_PREPARED: 'Estimate Prepared',
  AWAITING_OWNER_APPROVAL: 'Awaiting Owner Approval',
  AWAITING_CUSTOMER_APPROVAL: 'Awaiting Customer Approval',
  PARTS_ORDERED: 'Parts Ordered',
  REPAIR_IN_PROGRESS: 'Repair In Progress',
  QUALITY_CHECK: 'Quality Check',
  COMPLETED: 'Completed',
  READY_FOR_PICKUP: 'Ready for Pickup',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

export function statusTone(status: string): BadgeTone {
  return statusTones[status] ?? 'slate'
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold',
        toneClass(statusTone(status)),
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        toneClass(priorityTones[priority] ?? 'slate'),
      )}
    >
      {priority}
    </span>
  )
}

export function QuoteStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-slate-400">No quote</span>
  const tone: BadgeTone =
    status === 'APPROVED'
      ? 'emerald'
      : status === 'PENDING_OWNER'
        ? 'amber'
        : status === 'REJECTED'
          ? 'red'
          : 'slate'
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', toneClass(tone))}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export function Rating({ value, count }: { value: number | null | undefined; count?: number }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-slate-400">No ratings</span>
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
      <Star className="h-3.5 w-3.5 fill-current" />
      {value.toFixed(1)}
      {count !== undefined ? (
        <span className="font-normal text-slate-400">({count})</span>
      ) : null}
    </span>
  )
}

function toneClass(tone: BadgeTone) {
  const map: Record<BadgeTone, string> = {
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
  return map[tone]
}
