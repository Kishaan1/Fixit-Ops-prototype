import { round2 } from './http'

export type QuotePartsInput = {
  unitPrice: number
  unitCost: number
  quantity: number
}

export function computeQuote(input: {
  parts: QuotePartsInput[]
  labourCharge: number
  otherExpenses: number
  otherCost?: number
  taxRate: number
  discount: number
  technicianRate?: number
}) {
  const partsTotal = round2(
    input.parts.reduce((sum, p) => sum + Math.max(0, p.unitPrice) * Math.max(0, p.quantity), 0),
  )
  const actualPartsCost = round2(
    input.parts.reduce((sum, p) => sum + Math.max(0, p.unitCost) * Math.max(0, p.quantity), 0),
  )
  const labourCharge = round2(Math.max(0, input.labourCharge))
  const otherExpenses = round2(Math.max(0, input.otherExpenses))
  const otherCost = round2(Math.max(0, input.otherCost ?? 0))
  const discount = round2(Math.max(0, input.discount))
  const taxRate = round2(Math.max(0, input.taxRate))
  const technicianRate = round2(Math.max(0, input.technicianRate ?? 0))

  const taxable = round2(Math.max(0, partsTotal + labourCharge + otherExpenses - discount))
  const taxAmount = round2((taxable * taxRate) / 100)
  const customerTotal = round2(taxable + taxAmount)
  const technicianIncentive = round2((labourCharge * technicianRate) / 100)
  const netProfit = round2(customerTotal - taxAmount - actualPartsCost - otherCost - technicianIncentive)

  return {
    partsTotal,
    actualPartsCost,
    estimatedPartsCost: actualPartsCost,
    labourCharge,
    otherExpenses,
    otherCost,
    discount,
    taxRate,
    taxAmount,
    customerTotal,
    technicianIncentive,
    netProfit,
  }
}

export function sumPayments(payments: { amount: number }[]) {
  return round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0))
}
