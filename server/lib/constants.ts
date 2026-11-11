export const REPAIR_STATUSES = [
  'NEW_REQUEST',
  'DEVICE_RECEIVED',
  'AI_DIAGNOSIS_COMPLETED',
  'AWAITING_INSPECTION',
  'ESTIMATE_PREPARED',
  'AWAITING_OWNER_APPROVAL',
  'AWAITING_CUSTOMER_APPROVAL',
  'PARTS_ORDERED',
  'REPAIR_IN_PROGRESS',
  'QUALITY_CHECK',
  'COMPLETED',
  'READY_FOR_PICKUP',
  'DELIVERED',
  'CANCELLED',
] as const

export type RepairStatus = (typeof REPAIR_STATUSES)[number]

export const STATUS_LABELS: Record<RepairStatus, string> = {
  NEW_REQUEST: 'New Request',
  DEVICE_RECEIVED: 'Device Received',
  AI_DIAGNOSIS_COMPLETED: 'AI Diagnosis Completed',
  AWAITING_INSPECTION: 'Awaiting Technician Inspection',
  ESTIMATE_PREPARED: 'Estimate Prepared',
  AWAITING_OWNER_APPROVAL: 'Awaiting Owner Approval',
  AWAITING_CUSTOMER_APPROVAL: 'Awaiting Customer Approval',
  PARTS_ORDERED: 'Parts Ordered',
  REPAIR_IN_PROGRESS: 'Repair In Progress',
  QUALITY_CHECK: 'Testing & Quality Check',
  COMPLETED: 'Repair Completed',
  READY_FOR_PICKUP: 'Ready for Pickup',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

export const STATUS_TONES: Record<RepairStatus, string> = {
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
  DELIVERED: 'green',
  CANCELLED: 'red',
}

const FLOW: Record<RepairStatus, RepairStatus[]> = {
  NEW_REQUEST: ['DEVICE_RECEIVED', 'CANCELLED'],
  DEVICE_RECEIVED: ['AI_DIAGNOSIS_COMPLETED', 'AWAITING_INSPECTION', 'CANCELLED'],
  AI_DIAGNOSIS_COMPLETED: ['AWAITING_INSPECTION', 'ESTIMATE_PREPARED', 'CANCELLED'],
  AWAITING_INSPECTION: ['ESTIMATE_PREPARED', 'CANCELLED'],
  ESTIMATE_PREPARED: ['AWAITING_OWNER_APPROVAL', 'AWAITING_CUSTOMER_APPROVAL', 'CANCELLED'],
  AWAITING_OWNER_APPROVAL: ['AWAITING_CUSTOMER_APPROVAL', 'ESTIMATE_PREPARED', 'CANCELLED'],
  AWAITING_CUSTOMER_APPROVAL: ['PARTS_ORDERED', 'REPAIR_IN_PROGRESS', 'ESTIMATE_PREPARED', 'CANCELLED'],
  PARTS_ORDERED: ['REPAIR_IN_PROGRESS', 'CANCELLED'],
  REPAIR_IN_PROGRESS: ['QUALITY_CHECK', 'CANCELLED'],
  QUALITY_CHECK: ['COMPLETED', 'REPAIR_IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['READY_FOR_PICKUP', 'DELIVERED'],
  READY_FOR_PICKUP: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
}

export function isRepairStatus(v: unknown): v is RepairStatus {
  return typeof v === 'string' && (REPAIR_STATUSES as readonly string[]).includes(v)
}

export function canTransition(from: string, to: string, role: string) {
  if (from === to) return false
  if (!isRepairStatus(from) || !isRepairStatus(to)) return false
  // Owners may correct mistakes in the lifecycle; every change is still audited.
  if (role === 'OWNER') return true
  return FLOW[from].includes(to)
}

export function nextStatuses(from: string, role: string): RepairStatus[] {
  if (role === 'OWNER') return REPAIR_STATUSES.filter((s) => s !== from)
  return isRepairStatus(from) ? FLOW[from] : []
}

export const TERMINAL_STATUSES = ['DELIVERED', 'CANCELLED']
export const ACTIVE_STATUSES = REPAIR_STATUSES.filter(
  (s) => s !== 'DELIVERED' && s !== 'CANCELLED' && s !== 'COMPLETED',
)
export const REPORTABLE_STATUSES: string[] = ['COMPLETED', 'READY_FOR_PICKUP', 'DELIVERED']

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

export const DEVICE_CATEGORIES = ['Smartphone', 'Laptop', 'Tablet', 'Keypad Phone', 'Other'] as const
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number]

export const PART_QUALITIES = ['OEM', 'Compatible', 'Refurbished', 'Used', 'Aftermarket'] as const
export type PartQuality = (typeof PART_QUALITIES)[number]

export const PRICE_SOURCES = ['INVENTORY', 'MANUAL', 'VERIFIED_LISTING', 'OFFLINE_STORE', 'ESTIMATE'] as const
export type PriceSource = (typeof PRICE_SOURCES)[number]

export const QUOTE_STATUSES = ['DRAFT', 'PENDING_OWNER', 'APPROVED', 'REJECTED'] as const
