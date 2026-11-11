import { Prisma } from '@prisma/client'
import {
  PART_QUALITIES,
  PRICE_SOURCES,
  PRIORITIES,
  REPAIR_STATUSES,
} from '../lib/constants'

export type ScalarType = 'String' | 'Int' | 'Float' | 'Boolean' | 'DateTime'

export type ScalarField = {
  name: string
  header: string
  type: ScalarType
  required: boolean
  unique: boolean
  id: boolean
  updatedAt: boolean
  hasDefault: boolean
  default: unknown
}

export type ModelSpec = {
  model: string
  kind: 'master' | 'monthly'
  tab: string
  suffix: string
  monthField?: string
  recordType?: string
  fields: ScalarField[]
  idHeader: string
}

export type TabSpec = {
  key: string
  kind: 'master' | 'monthly'
  tab: string
  suffix: string
  headers: string[]
  types: ScalarType[]
  validations: Record<string, string[]>
  models: string[]
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const MASTER_TABS: Record<string, string> = {
  User: 'Users',
  Technician: 'Technicians',
  Customer: 'Customers',
  Device: 'Devices',
  SparePart: 'Spare Parts',
  Supplier: 'Suppliers',
  Shop: 'Settings',
  Session: 'Sessions',
  Notification: 'Notifications',
  AuditLog: 'Audit Log',
  AccountActivityLog: 'Account Activity',
  PasswordResetRequest: 'Password Reset Requests',
  EmailVerificationToken: 'Password Reset Tokens',
  RepairReport: 'Reports',
}

const MONTHLY_MODELS: Record<
  string,
  { suffix: string; monthField: string; recordType?: string }
> = {
  Repair: { suffix: '', monthField: 'createdAt' },
  RepairPart: { suffix: 'Parts', monthField: 'createdAt', recordType: 'PART' },
  InventoryTransaction: { suffix: 'Parts', monthField: 'createdAt', recordType: 'INVENTORY' },
  Payment: { suffix: 'Payments', monthField: 'paidAt', recordType: 'PAYMENT' },
  Expense: { suffix: 'Payments', monthField: 'incurredAt', recordType: 'EXPENSE' },
  TechnicianIncentive: { suffix: 'Payments', monthField: 'createdAt', recordType: 'INCENTIVE' },
  RepairActivity: { suffix: 'Activity', monthField: 'createdAt', recordType: 'ACTIVITY' },
  RepairDiagnostic: { suffix: 'Activity', monthField: 'createdAt', recordType: 'DIAGNOSTIC' },
  RepairImage: { suffix: 'Activity', monthField: 'createdAt', recordType: 'IMAGE' },
  Quotation: { suffix: 'Activity', monthField: 'createdAt', recordType: 'QUOTATION' },
  WarrantyRecord: { suffix: 'Activity', monthField: 'createdAt', recordType: 'WARRANTY' },
  CustomerFeedback: { suffix: 'Activity', monthField: 'createdAt', recordType: 'FEEDBACK' },
}

const MODEL_LABELS: Record<string, string> = {
  User: 'User Record',
  Technician: 'Technician',
  Customer: 'Customer',
  Device: 'Device',
  SparePart: 'Spare Part',
  Supplier: 'Supplier',
  Shop: 'Shop',
  Session: 'Session',
  Notification: 'Notification',
  AuditLog: 'Audit Log',
  AccountActivityLog: 'Activity Log',
  PasswordResetRequest: 'Reset Request',
  EmailVerificationToken: 'Reset Token',
  Repair: 'Repair',
  RepairPart: 'Part Usage',
  InventoryTransaction: 'Inventory',
  Payment: 'Payment',
  Expense: 'Expense',
  TechnicianIncentive: 'Incentive',
  RepairActivity: 'Activity',
  RepairDiagnostic: 'Diagnostic',
  RepairImage: 'Image',
  Quotation: 'Quotation',
  WarrantyRecord: 'Warranty',
  CustomerFeedback: 'Feedback',
  RepairReport: 'Report',
}

const HEADER_OVERRIDES: Record<string, Record<string, string>> = {
  User: {
    id: 'User Record ID',
    userId: 'Login User ID',
    passwordHash: 'Password Hash',
    profileImageUrl: 'Profile Image URL',
    emailVerified: 'Email Verified',
    accountStatus: 'Account Status',
    mustChangePassword: 'Must Change Password',
    joiningDate: 'Joining Date',
    lastLogin: 'Last Login',
  },
  Technician: {
    id: 'Technician ID',
    userId: 'User Record ID',
    incentiveRate: 'Incentive Rate',
  },
  Customer: { id: 'Customer ID', createdById: 'Created By ID' },
  Device: {
    id: 'Device ID',
    customerId: 'Customer ID',
    imei: 'IMEI',
    serialNumber: 'Serial Number',
    imagePath: 'Device Image',
    createdById: 'Created By ID',
  },
  SparePart: {
    id: 'Part ID',
    sku: 'SKU',
    supplierId: 'Supplier ID',
    purchasePrice: 'Purchase Price',
    sellingPrice: 'Selling Price',
    compatibleModels: 'Compatible Models',
    minStock: 'Minimum Stock',
  },
  Supplier: { id: 'Supplier ID', website: 'Website' },
  Shop: {
    id: 'Shop ID',
    legalName: 'Legal Name',
    gstin: 'GSTIN',
    logoPath: 'Logo Path',
    taxRate: 'Tax Rate',
    ownerApprovalThreshold: 'Owner Approval Threshold',
    reportBaseUrl: 'Report Base URL',
    lowStockAlerts: 'Low Stock Alerts',
  },
  Session: { id: 'Session ID', userId: 'User Record ID', userAgent: 'User Agent', ip: 'IP Address' },
  Notification: { userId: 'User Record ID', link: 'Link', read: 'Read' },
  AuditLog: {
    id: 'Audit ID',
    userId: 'User Record ID',
    entityId: 'Entity ID',
    ip: 'IP Address',
  },
  AccountActivityLog: {
    id: 'Activity Log ID',
    userId: 'User Record ID',
    activityType: 'Activity Type',
    activityDescription: 'Description',
    ip: 'IP Address',
    timestamp: 'Timestamp',
  },
  PasswordResetRequest: {
    id: 'Reset Request ID',
    userId: 'User Record ID',
    requestStatus: 'Request Status',
    resetTokenHash: 'Reset Token Hash',
    expiresAt: 'Expires At',
    completedAt: 'Completed At',
  },
  EmailVerificationToken: {
    id: 'Reset Token ID',
    userId: 'User Record ID',
    tokenHash: 'Token Hash',
    expiresAt: 'Expires At',
    verifiedAt: 'Verified At',
  },
  Repair: {
    id: 'Repair ID',
    customerId: 'Customer ID',
    deviceId: 'Device ID',
    technicianId: 'Technician ID',
    createdById: 'Created By ID',
    internalNotes: 'Internal Notes',
    confirmedFault: 'Confirmed Fault',
    repairProcedure: 'Repair Procedure',
    testingResults: 'Testing Results',
    finalCondition: 'Final Condition',
    warrantyDays: 'Warranty Days',
    warrantyTerms: 'Warranty Terms',
    estimatedCompletion: 'Estimated Completion',
    completedAt: 'Completed At',
    deliveredAt: 'Delivered At',
    cancelledAt: 'Cancelled At',
    reportToken: 'Report Token',
    reportPublishedAt: 'Report Published At',
    isDemo: 'Is Demo',
  },
  RepairPart: {
    id: 'Part Usage ID',
    repairId: 'Repair ID',
    sparePartId: 'Spare Part ID',
    supplierName: 'Supplier Name',
    sourceUrl: 'Source URL',
    priceSource: 'Price Source',
    lastCheckedAt: 'Last Checked At',
    unitPrice: 'Unit Price',
    unitCost: 'Unit Cost',
    isEstimated: 'Is Estimated',
    addedById: 'Added By ID',
  },
  InventoryTransaction: {
    id: 'Inventory ID',
    partId: 'Part ID',
    type: 'Movement Type',
    unitCost: 'Unit Cost',
    repairId: 'Repair ID',
    userId: 'User ID',
  },
  Payment: {
    id: 'Payment ID',
    repairId: 'Repair ID',
    paidAt: 'Paid At',
    recordedById: 'Recorded By ID',
  },
  Expense: {
    id: 'Expense ID',
    repairId: 'Repair ID',
    incurredAt: 'Incurred At',
    createdById: 'Created By ID',
  },
  TechnicianIncentive: {
    id: 'Incentive ID',
    technicianId: 'Technician ID',
    repairId: 'Repair ID',
    type: 'Incentive Type',
  },
  RepairActivity: {
    id: 'Activity ID',
    repairId: 'Repair ID',
    userId: 'User ID',
    type: 'Activity Type',
    note: 'Note',
    meta: 'Meta JSON',
  },
  RepairDiagnostic: {
    id: 'Diagnostic ID',
    repairId: 'Repair ID',
    mode: 'Diagnostic Mode',
    summary: 'Summary',
    causes: 'Causes JSON',
    tests: 'Tests JSON',
    parts: 'Parts JSON',
    difficulty: 'Difficulty',
    estimatedMinutes: 'Estimated Minutes',
    confidence: 'Confidence',
    sources: 'Sources JSON',
    rawText: 'Raw Text',
    createdById: 'Created By ID',
  },
  RepairImage: {
    id: 'Image ID',
    repairId: 'Repair ID',
    imagePath: 'Image Path',
    kind: 'Image Kind',
    caption: 'Caption',
    uploadedById: 'Uploaded By ID',
  },
  Quotation: {
    id: 'Quotation ID',
    repairId: 'Repair ID',
    version: 'Quote Version',
    status: 'Quote Status',
    partsTotal: 'Parts Total',
    labourCharge: 'Labour Charge',
    otherExpenses: 'Other Expenses',
    taxRate: 'Tax Rate',
    taxAmount: 'Tax Amount',
    customerTotal: 'Customer Total',
    estimatedPartsCost: 'Estimated Parts Cost',
    actualPartsCost: 'Actual Parts Cost',
    otherCost: 'Other Cost',
    technicianIncentive: 'Technician Incentive',
    netProfit: 'Net Profit',
    customerDecision: 'Customer Decision',
    decidedAt: 'Decided At',
    createdById: 'Created By ID',
    approvedById: 'Approved By ID',
    approvedAt: 'Approved At',
  },
  WarrantyRecord: {
    id: 'Warranty ID',
    repairId: 'Repair ID',
    days: 'Warranty Days',
    startDate: 'Start Date',
    endDate: 'End Date',
  },
  CustomerFeedback: { id: 'Feedback ID', repairId: 'Repair ID' },
  RepairReport: {
    id: 'Report ID',
    repairId: 'Repair ID',
    token: 'Report Token',
    snapshot: 'Snapshot JSON',
    publishedAt: 'Published At',
    createdById: 'Created By ID',
  },
}

function titleCase(input: string) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\bId\b/g, 'ID')
    .replace(/\bUrl\b/g, 'URL')
    .replace(/\bIp\b/g, 'IP')
    .replace(/\bSku\b/g, 'SKU')
    .replace(/\bImei\b/g, 'IMEI')
    .replace(/\bGstin\b/g, 'GSTIN')
    .replace(/\bJson\b/g, 'JSON')
    .replace(/^./, (c) => c.toUpperCase())
}

export function headerFor(model: string, field: string) {
  const override = HEADER_OVERRIDES[model]?.[field]
  if (override) return override
  if (field === 'id') return `${MODEL_LABELS[model] ?? model} ID`
  return titleCase(field)
}

function scalarType(field: { type: string }): ScalarType {
  if (field.type === 'DateTime') return 'DateTime'
  if (field.type === 'Int') return 'Int'
  if (field.type === 'Float') return 'Float'
  if (field.type === 'Boolean') return 'Boolean'
  return 'String'
}

function buildModelSpecs() {
  const dmmfModels = Prisma.dmmf.datamodel.models
  const specs: Record<string, ModelSpec> = {}

  for (const model of dmmfModels) {
    const monthly = MONTHLY_MODELS[model.name]
    const masterTab = MASTER_TABS[model.name]
    if (!monthly && !masterTab) continue

    const fields: ScalarField[] = model.fields
      .filter((field) => field.kind === 'scalar')
      .map((field) => ({
        name: field.name,
        header: headerFor(model.name, field.name),
        type: scalarType(field),
        required: Boolean(field.isRequired),
        unique: Boolean(field.isUnique || field.isId),
        id: Boolean(field.isId),
        updatedAt: Boolean(field.isUpdatedAt),
        hasDefault: Boolean(field.hasDefaultValue),
        default: field.default,
      }))

    specs[model.name] = {
      model: model.name,
      kind: monthly ? 'monthly' : 'master',
      tab: monthly ? '' : masterTab,
      suffix: monthly?.suffix ?? '',
      monthField: monthly?.monthField,
      recordType: monthly?.recordType,
      fields,
      idHeader: fields.find((f) => f.id)?.header ?? 'ID',
    }
  }
  return specs
}

export const MODEL_SPECS = buildModelSpecs()

const MODEL_VALIDATIONS: Record<string, Record<string, string[]>> = {
  User: {
    Role: ['OWNER', 'TECHNICIAN'],
    'Account Status': ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
  },
  Repair: {
    Status: [...REPAIR_STATUSES],
    Priority: [...PRIORITIES],
  },
  RepairPart: {
    Quality: [...PART_QUALITIES],
    'Price Source': [...PRICE_SOURCES],
  },
  SparePart: { Quality: [...PART_QUALITIES] },
  InventoryTransaction: { 'Movement Type': ['IN', 'OUT', 'ADJUST'] },
  Payment: { Method: ['CASH', 'UPI', 'CARD', 'BANK', 'OTHER'] },
  TechnicianIncentive: { 'Incentive Type': ['PER_REPAIR', 'MONTHLY', 'ADJUSTMENT'] },
  Quotation: {
    'Quote Status': ['DRAFT', 'PENDING_OWNER', 'APPROVED', 'REJECTED'],
    'Customer Decision': ['PENDING', 'ACCEPTED', 'REJECTED'],
  },
  RepairImage: { 'Image Kind': ['BEFORE', 'AFTER', 'EVIDENCE'] },
  RepairActivity: {
    'Activity Type': ['STATUS', 'NOTE', 'PART', 'QUOTE', 'PAYMENT', 'DIAGNOSIS', 'REPORT', 'WARRANTY', 'ASSIGNMENT'],
  },
}

function buildTabSpecs() {
  const tabs: Record<string, TabSpec> = {}

  const ensureTab = (key: string, kind: 'master' | 'monthly', tab: string, suffix: string) => {
    if (!tabs[key]) {
      tabs[key] = { key, kind, tab, suffix, headers: [], types: [], validations: {}, models: [] }
    }
    return tabs[key]
  }

  for (const spec of Object.values(MODEL_SPECS)) {
    const key =
      spec.kind === 'master'
        ? `master:${spec.tab}`
        : `monthly:${spec.suffix === '' ? 'Repairs' : spec.suffix}`
    const tabSpec = ensureTab(
      key,
      spec.kind,
      spec.tab,
      spec.suffix,
    )
    tabSpec.models.push(spec.model)

    // Virtual monthly tabs share one worksheet, so they need a discriminator.
    if (spec.kind === 'monthly' && spec.recordType) {
      if (!tabSpec.headers.includes('Record Type')) {
        tabSpec.headers.push('Record Type')
        tabSpec.types.push('String')
      }
    }

    for (const field of spec.fields) {
      let index = tabSpec.headers.indexOf(field.header)
      if (index < 0) {
        tabSpec.headers.push(field.header)
        tabSpec.types.push(field.type)
        index = tabSpec.headers.length - 1
      } else if (tabSpec.types[index] !== field.type) {
        // Numeric fields are safe to widen to Float; anything else must be text.
        if (tabSpec.types[index] === 'Int' && field.type === 'Float') {
          tabSpec.types[index] = 'Float'
        } else if (tabSpec.types[index] !== 'DateTime') {
          tabSpec.types[index] = 'String'
        }
      }
    }

    const validations = MODEL_VALIDATIONS[spec.model]
    if (validations) {
      for (const [header, values] of Object.entries(validations)) {
        if (tabSpec.headers.includes(header)) tabSpec.validations[header] = values
      }
    }
  }

  return tabs
}

export const TAB_SPECS = buildTabSpecs()

export function modelSpec(model: string): ModelSpec {
  const spec = MODEL_SPECS[model]
  if (!spec) throw new Error(`No Google Sheets mapping exists for model ${model}.`)
  return spec
}

export function tabSpecForModel(model: string): TabSpec {
  const spec = modelSpec(model)
  const key =
    spec.kind === 'master'
      ? `master:${spec.tab}`
      : `monthly:${spec.suffix === '' ? 'Repairs' : spec.suffix}`
  const tab = TAB_SPECS[key]
  if (!tab) throw new Error(`No Google Sheets tab mapping exists for ${model}.`)
  return tab
}

export function monthKeyForDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const year = parts.find((p) => p.type === 'year')?.value ?? String(date.getUTCFullYear())
  const month = parts.find((p) => p.type === 'month')?.value ?? String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function monthTabName(monthKey: string, suffix: string) {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) throw new Error(`Invalid month key: ${monthKey}`)
  return `${MONTHS[month - 1]} ${year}${suffix ? ` - ${suffix}` : ''}`
}

export function formatIst(value: Date | string | null | undefined) {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`
}

export function parseIst(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  const text = String(value).trim()
  if (!text) return null
  const match = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text)
  if (match) {
    const [, dd, mm, yyyy, hh, mi, ss] = match
    return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+05:30`)
  }
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
