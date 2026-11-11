export type DateRange = { from: Date; to: Date; period: string }

// The shop operates in India. Month/day boundaries must follow IST even when
// the server runs in UTC or another timezone.
const TIMEZONE = 'Asia/Kolkata'

function partsOf(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  }
}

function istInstant(year: number, month: number, day: number, endOfDay = false) {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return new Date(
    `${year}-${mm}-${dd}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`,
  )
}

function parseBound(value: string, endOfDay: boolean) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    return istInstant(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), endOfDay)
  }
  return new Date(value)
}

/** Bounds of one calendar month in IST, from 00:00:00 on day 1 to 23:59:59.999 on the last day. */
export function monthBounds(monthKey: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    from: istInstant(year, month, 1),
    to: istInstant(year, month, lastDay, true),
  }
}

/** Shift a YYYY-MM key by a number of months, keeping it timezone-free. */
export function shiftMonthKey(monthKey: string, delta: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!match) return monthKey
  const total = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta
  const year = Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

export function parseDateRange(query: Record<string, unknown>): DateRange {
  const period = String(query.period ?? 'month')
  const now = new Date()
  const today = partsOf(now)

  // An explicit YYYY-MM is the owner selecting a historical month. It takes
  // precedence over period so previous months can be viewed read-only without
  // changing any worksheet.
  const requestedMonth = typeof query.month === 'string' ? query.month.trim() : ''
  const monthRange = requestedMonth ? monthBounds(requestedMonth) : null
  if (monthRange) {
    return { from: monthRange.from, to: monthRange.to, period: 'month' }
  }

  const to = query.to ? parseBound(String(query.to), true) : now
  let from: Date

  if (query.from) {
    from = parseBound(String(query.from), false)
  } else {
    switch (period) {
      case 'today':
      case 'day':
        from = istInstant(today.year, today.month, today.day)
        break
      case 'week':
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        from = istInstant(today.year, 1, 1)
        break
      case 'all':
        from = istInstant(2000, 1, 1)
        break
      case 'month':
      default:
        from = istInstant(today.year, today.month, 1)
        break
    }
  }

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    from = istInstant(today.year, today.month, 1)
    return { from, to: now, period: 'month' }
  }
  if (from > to) {
    const tmp = from
    from = to
    return { from, to: tmp, period }
  }
  return { from, to, period }
}

export function dayKey(d: Date) {
  const p = partsOf(d)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function monthKey(d: Date) {
  return dayKey(d).slice(0, 7)
}

/** Month key for a number of months before the current IST month. */
export function monthKeyMonthsAgo(offset: number, base = new Date()) {
  const p = partsOf(base)
  const total = p.year * 12 + (p.month - 1) - offset
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Start of the current IST month, used for rolling daily buckets. */
export function startOfIstDay(d: Date) {
  const p = partsOf(d)
  return istInstant(p.year, p.month, p.day)
}

export function daysBetween(a: Date, b: Date) {
  return Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}
