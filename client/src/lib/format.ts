const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const currencyPrecise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const compact = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function money(value: number | null | undefined, precise = false) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return precise ? '₹0.00' : '₹0'
  }
  return precise ? currencyPrecise.format(Number(value)) : currency.format(Number(value))
}

export function compactMoney(value: number | null | undefined) {
  return `₹${compact.format(Number(value ?? 0))}`
}

export function number(value: number | null | undefined) {
  return new Intl.NumberFormat('en-IN').format(Number(value ?? 0))
}

export function percent(value: number | null | undefined, digits = 0) {
  return `${Number(value ?? 0).toFixed(digits)}%`
}

export function date(value: string | Date | null | undefined, withTime = false) {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d)
}

export function dateTime(value: string | Date | null | undefined) {
  return date(value, true)
}

export function relative(value: string | Date | null | undefined) {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  const diff = Date.now() - d.getTime()
  const minutes = Math.round(diff / 60000)
  if (Math.abs(minutes) < 1) return 'just now'
  if (Math.abs(minutes) < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return `${days}d ago`
  return date(d)
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function humanize(value: string | null | undefined) {
  if (!value) return '—'
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function statusLabel(status: string) {
  return humanize(status)
}

export function toDateInput(value: string | Date | null | undefined) {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  const offset = d.getTimezoneOffset()
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16)
}

export function fromDateInput(value: string) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Recent calendar months in the shop's business timezone (Asia/Kolkata).
 * The first entry is the current month. Used by the owner month picker so a
 * historical month can be opened without changing any spreadsheet row.
 */
export function recentMonthOptions(count = 24) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  const options: Array<{ value: string; label: string }> = []
  for (let offset = 0; offset < count; offset += 1) {
    const total = year * 12 + (month - 1) - offset
    const y = Math.floor(total / 12)
    const m = ((total % 12) + 12) % 12
    const value = `${y}-${String(m + 1).padStart(2, '0')}`
    const label = new Date(Date.UTC(y, m, 1)).toLocaleString('en-IN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    options.push({ value, label })
  }
  return options
}
