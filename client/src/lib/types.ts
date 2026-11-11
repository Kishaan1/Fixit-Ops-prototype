export type Role = 'OWNER' | 'TECHNICIAN'

export interface User {
  id: string
  userId?: string | null
  email: string
  name: string
  role: Role
  phone: string | null
  profileImageUrl?: string | null
  designation?: string | null
  accountStatus?: string
  emailVerified?: boolean
  mustChangePassword?: boolean
  joiningDate?: string | null
  lastLogin?: string | null
  technicianId: string | null
}

export interface Technician {
  id: string
  userId: string
  userDbId?: string
  name: string
  email: string
  phone: string | null
  specialization: string | null
  incentiveRate: number
  active: boolean
  accountStatus?: string
  designation?: string | null
  profileImageUrl?: string | null
  emailVerified?: boolean
  mustChangePassword?: boolean
  joiningDate?: string
  lastLogin?: string | null
  createdAt: string
}

export interface PasswordResetRequestItem {
  id: string
  userId: string
  requestDate: string
  requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED'
  approvedBy: string | null
  temporaryPassword?: string | null
  expiresAt: string
  completedAt: string | null
  notes: string | null
  user: {
    id: string
    userId: string | null
    name: string
    email: string
    phone: string | null
    profileImageUrl: string | null
    designation: string | null
    accountStatus: string
    technician: { id: string; specialization: string | null } | null
  }
}

export interface AccountActivityItem {
  id: string
  activityType: string
  activityDescription: string
  timestamp: string
  ip: string | null
}

export interface UserProfileResponse {
  profile: {
    id: string
    userId: string | null
    email: string
    name: string
    role: Role
    phone: string | null
    profileImageUrl: string | null
    designation: string | null
    accountStatus: string
    emailVerified: boolean
    mustChangePassword: boolean
    joiningDate: string | null
    lastLogin: string | null
    createdAt: string
    technicianId: string | null
    specialization: string | null
    incentiveRate: number | null
    stats: {
      totalAssigned: number
      completedCount: number
      totalIncentives: number
    } | null
    activityLogs: AccountActivityItem[]
  }
}

export interface TechnicianPerformance extends Technician {
  assigned: number
  completed: number
  pending: number
  cancelled: number
  revenue: number
  partsCost: number
  otherCost: number
  labour: number
  grossProfit: number
  incentives: number
  netContribution: number
  avgCompletionDays: number | null
  feedbackCount: number
  avgRating: number | null
  repeatRepairs: number
  qualityChecks: number
}

export interface TechnicianDetailPerformance {
  technician: Technician
  summary: {
    assigned: number
    completed: number
    revenue: number
    partsCost: number
    otherCost: number
    grossProfit: number
    incentives: number
    netContribution: number
    avgRating: number | null
    feedbackCount: number
  }
  repairs: Array<{
    id: string
    code: string
    customer: string
    device: string
    status: string
    createdAt: string
    completedAt: string | null
    revenue: number
    partsCost: number
    quoteTotal: number
    rating: number | null
  }>
  range: DateRange
}

export interface CustomerListItem {
  id: string
  name: string
  phone: string
  email: string | null
  address: string | null
  notes: string | null
  isDemo: boolean
  deviceCount: number
  createdAt: string
  visits: number
  completed: number
  totalSpent: number
  lastServiceDate: string | null
  returning: boolean
}

export interface CustomerDetail {
  customer: {
    id: string
    name: string
    phone: string
    email: string | null
    address: string | null
    notes: string | null
    isDemo: boolean
    createdAt: string
  }
  summary: {
    visits: number
    completed: number
    totalSpent: number
    lastServiceDate: string | null
    returning: boolean
    devices: Device[]
  }
  repairs: Array<{
    id: string
    code: string
    status: string
    problem: string
    createdAt: string
    completedAt: string | null
    device: Device
    technicianName: string | null
    paymentTotal: number
    quoteTotal: number
    parts: Array<{ name: string; quantity: number; unitPrice: number }>
  }>
  scoped: boolean
  scopeNote: string | null
}

export interface Device {
  id?: string
  customerId?: string
  category: string
  brand: string
  model: string
  imei: string | null
  serialNumber: string | null
  color: string | null
  accessories: string | null
  conditionNotes: string | null
  imagePath: string | null
}

export interface RepairListItem {
  id: string
  code: string
  status: string
  priority: string
  createdAt: string
  completedAt: string | null
  problem: string
  customer: { id: string; name: string; phone: string }
  device: { category: string; brand: string; model: string }
  technician: { id: string; name: string } | null
  quoteTotal: number
  quoteStatus: string | null
  paidTotal: number
  partsCount: number
  rating: number | null
}

export interface Diagnostic {
  id: string
  repairId: string
  mode: string
  provider: string | null
  model: string | null
  summary: string
  causes: string
  tests: string
  parts: string
  difficulty: string | null
  estimatedMinutes: number | null
  confidence: number | null
  sources: string
  rawText: string | null
  createdAt: string
}

export interface RepairPart {
  id: string
  sparePartId: string | null
  name: string
  quality: string
  supplierName: string | null
  sourceUrl: string | null
  priceSource: string
  lastCheckedAt: string | null
  unitPrice: number
  unitCost: number
  quantity: number
  isEstimated: boolean
  note: string | null
  createdAt: string
  addedBy?: { name: string } | null
}

export interface Quotation {
  id: string
  repairId: string
  version: number
  status: 'DRAFT' | 'PENDING_OWNER' | 'APPROVED' | 'REJECTED'
  partsTotal: number
  labourCharge: number
  otherExpenses: number
  taxRate: number
  taxAmount: number
  discount: number
  customerTotal: number
  estimatedPartsCost: number
  actualPartsCost: number
  otherCost: number
  technicianIncentive: number
  netProfit: number
  notes: string | null
  customerDecision: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  decidedAt: string | null
  createdAt: string
  approvedAt: string | null
  createdBy?: { id: string; name: string } | null
  approvedBy?: { id: string; name: string } | null
}

export interface Payment {
  id: string
  amount: number
  method: string
  reference: string | null
  notes: string | null
  paidAt: string
  recordedBy?: { name: string } | null
}

export interface RepairActivity {
  id: string
  type: string
  note: string
  meta: string | null
  createdAt: string
  user: { id: string; name: string; role: string } | null
}

export interface RepairImage {
  id: string
  repairId: string
  imagePath: string
  kind: 'BEFORE' | 'AFTER' | 'EVIDENCE'
  caption: string | null
  createdAt: string
  uploadedBy?: { id: string; name: string } | null
}

export interface Repair {
  id: string
  code: string
  customerId: string
  deviceId: string
  technicianId: string | null
  status: string
  priority: string
  problem: string
  internalNotes: string | null
  confirmedFault: string | null
  repairProcedure: string | null
  testingResults: string | null
  finalCondition: string | null
  warrantyDays: number
  warrantyTerms: string | null
  estimatedCompletion: string | null
  completedAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  reportToken: string | null
  reportPublishedAt: string | null
  isDemo: boolean
  createdAt: string
  updatedAt: string
  customer: { id: string; name: string; phone: string; email: string | null; address: string | null }
  device: Device
  technician:
    | (Technician & { userId: string; user: { id: string; name: string; email: string } })
    | null
  createdBy?: { id: string; name: string; role: string } | null
  diagnostics: Diagnostic[]
  activities: RepairActivity[]
  parts: RepairPart[]
  quotations: Quotation[]
  payments: Payment[]
  report: { id: string; token: string; publishedAt: string } | null
  warranty: { id: string; days: number; startDate: string; endDate: string; terms: string | null } | null
  feedback: { id: string; rating: number; comment: string | null; createdAt: string } | null
  images: RepairImage[]
}

export interface MoneySummary {
  partsCharged: number
  partsCost: number
  paidTotal: number
  balance: number
  quotedTotal: number
  hasApprovedQuote: boolean
}

export interface RepairDetailResponse {
  repair: Repair
  money: MoneySummary
  allowedStatuses: string[]
}

export interface SparePart {
  id: string
  sku: string
  name: string
  category: string
  brand: string | null
  compatibleModels: string
  quality: string
  supplierId: string | null
  purchasePrice: number
  sellingPrice: number
  quantity: number
  minStock: number
  location: string | null
  isDemo: boolean
  active: boolean
  createdAt: string
  updatedAt: string
  supplier?: Supplier | null
}

export interface Supplier {
  id: string
  name: string
  phone: string | null
  email: string | null
  website: string | null
  notes: string | null
  isDemo: boolean
  createdAt: string
}

export interface InventoryTransaction {
  id: string
  partId: string
  type: string
  quantity: number
  unitCost: number
  repairId: string | null
  note: string | null
  createdAt: string
  part: { id: string; name: string; sku: string }
  user: { name: string } | null
}

export interface NotificationItem {
  id: string
  userId: string | null
  role: string | null
  type: string
  title: string
  body: string | null
  link: string | null
  read: boolean
  createdAt: string
}

export interface ReportListItem {
  id: string
  repairId: string
  token: string
  publishedAt: string
  url: string
  code: string
  status: string
  statusLabel: string
  customer: string
  device: string
  category: string
  technician: string | null
  amount: number
  paid: number
}

export interface DateRange {
  from: string
  to: string
  period: string
}

export interface Shop {
  id: string
  name: string
  legalName: string | null
  phone: string | null
  email: string | null
  address: string | null
  gstin: string | null
  logoPath: string | null
  currency: string
  taxRate: number
  ownerApprovalThreshold: number
  reportBaseUrl: string | null
  lowStockAlerts: boolean
}

export interface MonthSummary {
  month: string
  repairs: number
  completed: number
  pending: number
  cancelled: number
  revenue: number
  expenses: number
  partsCost: number
  overhead: number
  incentives: number
  profit: number
}

export interface Overview {
  range: DateRange
  kpis: {
    revenue: number
    totalExpenses: number
    netProfit: number
    partsCost: number
    overhead: number
    incentives: number
    repairs: number
    completed: number
    cancelled: number
    pending: number
    awaitingPickup: number
    returningCustomers: number
    newCustomers: number
    totalCustomers: number
    retentionRate: number
    activeTechnicians: number
    pendingApprovals: number
    lowStockCount: number
    outstanding: number
    outstandingRepairs: number
    averageTicket: number
  }
  monthlyComparison: {
    current: MonthSummary
    previous: MonthSummary
  }
  charts: {
    daily: Array<{ date: string; revenue: number; repairs: number; completed: number }>
    monthly: Array<{ month: string; revenue: number; cost: number; profit: number }>
    categoryDistribution: Array<{ label: string; count: number }>
    mobileBrands: Array<{ label: string; count: number }>
    laptopBrands: Array<{ label: string; count: number }>
    commonFaults: Array<{ label: string; count: number }>
    mostReplaced: Array<{ name: string; count: number; cost: number }>
    technicianComparison: Array<{
      id: string
      name: string
      assigned: number
      completed: number
      revenue: number
      partsCost: number
      incentives: number
      contribution: number
      avgRating: number | null
      avgCompletionDays: number | null
    }>
    statusDistribution: Array<{ label: string; count: number }>
  }
  inventory: {
    totalParts: number
    totalUnits: number
    lowStock: number
    outOfStock: number
    valueAtCost: number
    valueAtRetail: number
    lowStockItems: Array<{ id: string; name: string; quantity: number; minStock: number }>
  }
  recentRepairs: Array<{
    id: string
    code: string
    customer: string
    device: string
    status: string
    createdAt: string
  }>
}

export interface MyAnalytics {
  range: DateRange
  kpis: {
    assigned: number
    pending: number
    completed: number
    revenue: number
    partsCost: number
    contribution: number
    awaitingPickup: number
    avgRating: number | null
    feedbackCount: number
  }
  recentRepairs: Array<{
    id: string
    code: string
    customer: string
    device: string
    status: string
    createdAt: string
    quoteTotal: number
  }>
  statusDistribution: Array<{ label: string; count: number }>
}

export interface PublicReport {
  snapshot: {
    version: number
    generatedAt: string
    shop: {
      name: string
      phone: string | null
      email: string | null
      address: string | null
      logoPath: string | null
    }
    repair: {
      code: string
      status: string
      statusLabel: string
      createdAt: string
      completedAt: string | null
      deliveredAt: string | null
      problem: string
      confirmedFault: string | null
      repairProcedure: string | null
      testingResults: string | null
      technicianName: string | null
      warranty: { days: number; endDate: string; terms: string | null } | null
    }
    customer: { name: string }
    device: {
      category: string
      brand: string
      model: string
      imei: string | null
      serialNumber: string | null
    }
    diagnosis: Array<{
      mode: string
      summary: string
      causes: unknown[]
      confidence: number | null
      sources: unknown[]
      createdAt: string
    }>
    parts: Array<{ name: string; quality: string; quantity: number; unitPrice: number }>
    charges: {
      partsTotal: number
      labourCharge: number
      otherExpenses: number
      taxAmount: number
      discount: number
      customerTotal: number
      paidTotal: number
    }
    payments: Array<{ amount: number; method: string; paidAt: string }>
  }
  feedback: { rating: number; comment: string | null; createdAt: string } | null
}

export interface AiStatus {
  configured: boolean
  provider: string | null
  model: string | null
  capabilities: {
    deviceIdentification: boolean
    webResearch: boolean
    offlineChecklist: boolean
    manualEntry: boolean
  }
  message: string
}

export interface DiagnosisResult {
  mode: string
  provider: string | null
  model: string | null
  summary: string
  commonFaults?: string[]
  causes: string[]
  tests: string[]
  solutions?: string[]
  parts: Array<string | { name: string; why?: string; priceGuidance?: string }>
  difficulty: string | null
  estimatedMinutes: number | null
  confidence: number | null
  sources: Array<{ title: string; url: string }>
  rawText: string | null
  disclaimer?: string
}

export interface OnlinePartListing {
  id: string
  name: string
  category: string
  brand: string
  compatibleModels: string[]
  quality: 'OEM' | 'Compatible' | 'Refurbished' | 'Used' | 'Aftermarket'
  supplierName: string
  supplierWebsite: string
  supplierCountry: string
  listedPrice: number
  shippingCharge: number
  totalLandedPrice: number
  currency: string
  availability: 'IN_STOCK' | 'LOW_STOCK' | '2_3_DAYS' | 'OUT_OF_STOCK'
  warranty: string
  sourceUrl: string
  isVerified: boolean
  lastCheckedAt: string
  estimatedDeliveryDays: number
  inShopInventory?: boolean
  shopStockQuantity?: number
  shopSellingPrice?: number
}

