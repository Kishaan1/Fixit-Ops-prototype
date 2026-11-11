import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { config } from '../env'
import {
  SheetsGateway,
  SheetsGatewayError,
  type GatewayTable,
  type GatewayWriteOp,
} from './gateway'
import {
  MODEL_SPECS,
  TAB_SPECS,
  modelSpec,
  monthKeyForDate,
  parseIst,
  tabSpecForModel,
  type ScalarField,
  type TabSpec,
} from './schema'

export const gateway = new SheetsGateway(
  config.sheetsGatewayUrl,
  config.sheetsGatewaySecret,
)

export function sheetsConfigured() {
  return gateway.configured
}

export type SheetMeta = {
  tab: string
  row: number
  month: string
}

export type SheetRecord = Record<string, unknown> & { __sheetMeta?: SheetMeta }

export type Ctx = {
  requestId: string
  ops: GatewayWriteOp[]
  overlay: Map<string, Map<string, SheetRecord | null>>
  flushing?: Promise<void>
}

const storage = new AsyncLocalStorage<Ctx>()

export function createSheetsContext(): Ctx {
  return {
    requestId: `req-${Date.now()}-${randomUUID()}`,
    ops: [],
    overlay: new Map(),
  }
}

export function runWithSheetsContext<T>(ctx: Ctx, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function getSheetsContext(): Ctx | undefined {
  return storage.getStore()
}

export function overlayFor(model: string) {
  return getSheetsContext()?.overlay.get(model)
}

export function stageWrite(
  model: string,
  op: GatewayWriteOp,
  row: SheetRecord | null,
) {
  const ctx = getSheetsContext()
  if (!ctx) {
    throw new Error('A Google Sheets write was attempted outside a request context.')
  }
  ctx.ops.push(op)
  let map = ctx.overlay.get(model)
  if (!map) {
    map = new Map()
    ctx.overlay.set(model, map)
  }
  map.set(op.id, row)
}

export function discardSheetsContext() {
  const ctx = getSheetsContext()
  if (!ctx) return
  ctx.ops = []
  ctx.overlay.clear()
  ctx.flushing = undefined
}

// A very large request (batch import, migration, seed) is split so no single
// Apps Script invocation can exceed its execution limit.
const WRITE_CHUNK_SIZE = 60

export async function flushSheetsContext(ctx: Ctx) {
  if (!ctx.ops.length) return
  if (ctx.flushing) return ctx.flushing
  ctx.flushing = (async () => {
    // A write can be the first gateway call after a restart. Make sure the
    // hidden schema exists before any monthly tab is resolved or created.
    await ensureSheetsSchema()
    const ops = ctx.ops.slice()
    for (let offset = 0; offset < ops.length; offset += WRITE_CHUNK_SIZE) {
      const chunk = ops.slice(offset, offset + WRITE_CHUNK_SIZE)
      const chunkId = `${ctx.requestId}:${Math.floor(offset / WRITE_CHUNK_SIZE)}`
      await gateway.writeBatch(chunk, chunkId)
      invalidateSheetsCache()
    }
    ctx.ops = []
    ctx.overlay.clear()
    invalidateSheetsCache()
  })()
  try {
    await ctx.flushing
  } finally {
    ctx.flushing = undefined
  }
}

/**
 * Runs a unit of work in its own Sheets context and flushes it before
 * returning. Used by scripts, seed and migration where no Express request
 * context exists.
 */
export async function runWithSheetsWrite<T>(fn: () => Promise<T>): Promise<T> {
  const existing = getSheetsContext()
  if (existing) return fn()
  const ctx = createSheetsContext()
  return runWithSheetsContext(ctx, async () => {
    const result = await fn()
    await flushSheetsContext(ctx)
    return result
  })
}

const cache = new Map<string, { rows: Array<Record<string, unknown>>; at: number }>()
// Deduplicates simultaneous reads of the same tab (a dashboard load fires
// several API calls at once) so one request does not exhaust the Apps Script
// quota with identical reads.
const pendingReads = new Map<string, Promise<Array<Record<string, unknown>>>>()
const CACHE_TTL_MS = 4_000

export function invalidateSheetsCache() {
  cache.clear()
}

let ensurePromise: Promise<unknown> | null = null

export function ensureSheetsSchema() {
  if (ensurePromise) return ensurePromise
  ensurePromise = (async () => {
    const masters = Object.values(TAB_SPECS)
      .filter((tab) => tab.kind === 'master')
      .map((tab) => ({
        tab: tab.tab,
        headers: tab.headers,
        types: tab.types,
        validations: tab.validations,
      }))
    const monthly = Object.values(TAB_SPECS)
      .filter((tab) => tab.kind === 'monthly')
      .map((tab) => ({
        suffix: tab.suffix,
        headers: tab.headers,
        types: tab.types,
        validations: tab.validations,
      }))
    return gateway.ensureSchema({ masters, monthly })
  })().catch((err) => {
    ensurePromise = null
    throw err
  })
  return ensurePromise
}

export async function readTabRows(tab: TabSpec): Promise<Array<Record<string, unknown>>> {
  const cached = cache.get(tab.key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows

  const inFlight = pendingReads.get(tab.key)
  if (inFlight) return inFlight

  const promise = (async () => {
    await ensureSheetsSchema()
    const table: GatewayTable =
      tab.kind === 'master'
        ? { key: tab.key, kind: 'master', tab: tab.tab }
        : { key: tab.key, kind: 'monthly', suffix: tab.suffix }
    const response = await gateway.readTables([table])
    // Defensive copy: callers may sort/filter the array.
    const rows = (response.tables[tab.key] ?? []).slice()
    cache.set(tab.key, { rows, at: Date.now() })
    return rows
  })()

  pendingReads.set(tab.key, promise)
  try {
    return await promise
  } finally {
    pendingReads.delete(tab.key)
  }
}

function cellToValue(field: ScalarField, raw: unknown) {
  const empty = raw === '' || raw === null || raw === undefined
  if (field.type === 'DateTime') {
    if (empty) return null
    return parseIst(raw)
  }
  if (field.type === 'Int' || field.type === 'Float') {
    if (empty) return field.required ? 0 : null
    const n = Number(raw)
    if (!Number.isFinite(n)) return field.required ? 0 : null
    return field.type === 'Int' ? Math.trunc(n) : n
  }
  if (field.type === 'Boolean') {
    if (empty) return field.required ? false : null
    return raw === true || raw === 1 || raw === 'true' || raw === 'TRUE' || raw === '1'
  }
  if (empty) return field.required ? '' : null
  return String(raw)
}

function rowToRecord(model: string, row: Record<string, unknown>): SheetRecord {
  const spec = modelSpec(model)
  const record: SheetRecord = {}
  for (const field of spec.fields) {
    record[field.name] = cellToValue(field, row[field.header])
  }
  const meta: SheetMeta = {
    tab: String(row.__tab ?? ''),
    row: Number(row.__row ?? 0),
    month: String(row.__month ?? ''),
  }
  Object.defineProperty(record, '__sheetMeta', {
    value: meta,
    enumerable: false,
    configurable: true,
    writable: true,
  })
  return record
}

export function rowMonthKey(model: string, data: Record<string, unknown>) {
  const spec = modelSpec(model)
  const field = spec.monthField ? data[spec.monthField] : null
  const date = field instanceof Date ? field : field ? new Date(String(field)) : new Date()
  return monthKeyForDate(Number.isNaN(date.getTime()) ? new Date() : date)
}

export async function loadModelRecords(model: string): Promise<SheetRecord[]> {
  const spec = modelSpec(model)
  const tab = tabSpecForModel(model)
  const rawRows = await readTabRows(tab)
  const records: SheetRecord[] = []

  for (const row of rawRows) {
    if (spec.recordType && String(row['Record Type'] ?? '') !== spec.recordType) continue
    // Shared tabs may contain rows from another record type. When a model has
    // no discriminator, the tab only holds that model.
    if (!spec.recordType && tab.models.length > 1) continue
    records.push(rowToRecord(model, row))
  }

  const overlay = overlayFor(model)
  if (overlay && overlay.size) {
    const merged = new Map<string, SheetRecord>()
    for (const record of records) merged.set(String(record.id), record)
    for (const [id, record] of overlay) {
      if (record === null) merged.delete(id)
      else merged.set(id, record)
    }
    return [...merged.values()]
  }

  return records
}

export function sheetsWriteError(err: unknown) {
  if (err instanceof SheetsGatewayError) return err
  return new SheetsGatewayError(
    err instanceof Error ? err.message : 'Google Sheets write failed.',
    'SHEETS_WRITE_FAILED',
    false,
  )
}

export function sheetsStatus() {
  return {
    configured: gateway.configured,
    publicTabModels: Object.fromEntries(
      Object.values(MODEL_SPECS).map((spec) => [spec.model, spec.kind === 'master' ? spec.tab : spec.suffix || 'Main']),
    ),
  }
}
