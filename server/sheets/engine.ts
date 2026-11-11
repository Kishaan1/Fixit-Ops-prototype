import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  MODEL_SPECS,
  modelSpec,
  parseIst,
  tabSpecForModel,
  type ScalarField,
} from './schema'
import {
  loadModelRecords,
  rowMonthKey,
  stageWrite,
  type SheetMeta,
  type SheetRecord,
} from './runtime'
import type { GatewayWriteOp } from './gateway'

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class SheetsRecordError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'SheetsRecordError'
    this.code = code
  }
}

function conflict(message: string) {
  return new SheetsRecordError('P2002', message)
}

function notFound(message: string) {
  return new SheetsRecordError('P2025', message)
}

/* ------------------------------------------------------------------ */
/* DMMF metadata                                                       */
/* ------------------------------------------------------------------ */

type FieldMeta = {
  name: string
  type: string
  kind: 'scalar' | 'object'
  isList: boolean
  isRequired: boolean
  isId: boolean
  isUnique: boolean
  isUpdatedAt: boolean
  hasDefaultValue: boolean
  default: unknown
  relationFromFields: string[]
  relationToFields: string[]
  relationName: string | null
  relationOnDelete?: string
}

type ModelMeta = {
  name: string
  fields: FieldMeta[]
  fieldMap: Record<string, FieldMeta>
  scalars: FieldMeta[]
  relations: FieldMeta[]
  idField: FieldMeta
  uniqueFields: string[][]
}

const MODELS: Record<string, ModelMeta> = {}

for (const model of Prisma.dmmf.datamodel.models) {
  const fields: FieldMeta[] = model.fields.map((field) => ({
    name: field.name,
    type: field.type,
    kind: field.kind === 'object' ? 'object' : 'scalar',
    isList: Boolean(field.isList),
    isRequired: Boolean(field.isRequired),
    isId: Boolean(field.isId),
    isUnique: Boolean(field.isUnique),
    isUpdatedAt: Boolean(field.isUpdatedAt),
    hasDefaultValue: Boolean(field.hasDefaultValue),
    default: field.default,
    relationFromFields: [...((field.relationFromFields as unknown as string[]) ?? [])],
    relationToFields: [...((field.relationToFields as unknown as string[]) ?? [])],
    relationName: field.relationName ?? null,
    relationOnDelete: field.relationOnDelete ? String(field.relationOnDelete) : undefined,
  }))
  const idField = fields.find((f) => f.isId)
  if (!idField) continue
  MODELS[model.name] = {
    name: model.name,
    fields,
    fieldMap: Object.fromEntries(fields.map((f) => [f.name, f])),
    scalars: fields.filter((f) => f.kind === 'scalar'),
    relations: fields.filter((f) => f.kind === 'object'),
    idField,
    uniqueFields: ((model.uniqueFields as unknown as string[][]) ?? []).map((group) => [
      ...(group ?? []),
    ]),
  }
}

export const MODEL_NAMES = Object.keys(MODELS)

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (isDate(value)) return value
  // Spreadsheet timestamps use DD-MM-YYYY HH:mm:ss in IST; `new Date` cannot
  // parse that reliably, so use the same parser as the read path.
  const ist = parseIst(String(value))
  if (ist) return ist
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function sameValue(a: unknown, b: unknown) {
  if (a === b) return true
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  if (isDate(a) || isDate(b)) {
    const da = toDate(a)
    const db = toDate(b)
    return da !== null && db !== null && da.getTime() === db.getTime()
  }
  return String(a) === String(b)
}

function isEmpty(value: unknown) {
  return value === null || value === undefined || value === ''
}

function coerce(field: FieldMeta, value: unknown) {
  if (value === null || value === undefined) return null
  if (field.type === 'DateTime') {
    return toDate(value)
  }
  if (field.type === 'Int') {
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  if (field.type === 'Float') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (field.type === 'Boolean') {
    return value === true || value === 1 || value === 'true' || value === 'TRUE'
  }
  return String(value)
}

function generateId() {
  const time = Date.now().toString(36)
  return `c${time}${randomUUID().replace(/-/g, '').slice(0, 18)}`
}

function deterministicId(model: string, field: string, value: unknown) {
  return `c${createHash('sha256').update(`${model}:${field}:${String(value)}`).digest('hex').slice(0, 24)}`
}

function metaOf(record: SheetRecord): SheetMeta | undefined {
  return record.__sheetMeta
}

function applyMeta(record: SheetRecord, meta: SheetMeta | undefined) {
  if (meta) {
    Object.defineProperty(record, '__sheetMeta', {
      value: { ...meta },
      enumerable: false,
      configurable: true,
      writable: true,
    })
  }
  return record
}

/* ------------------------------------------------------------------ */
/* Loader                                                              */
/* ------------------------------------------------------------------ */

type Loader = {
  get: (model: string) => Promise<SheetRecord[]>
  clear: () => void
}

function createLoader(): Loader {
  const cache = new Map<string, Promise<SheetRecord[]>>()
  return {
    get(model: string) {
      let promise = cache.get(model)
      if (!promise) {
        promise = loadModelRecords(model)
        cache.set(model, promise)
      }
      return promise
    },
    clear() {
      cache.clear()
    },
  }
}

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

function matchScalar(value: unknown, filter: unknown): boolean {
  if (filter === null) return value === null || value === undefined
  if (filter instanceof Date) return sameValue(value, filter)
  if (typeof filter !== 'object') return sameValue(value, filter)
  const f = filter as Record<string, unknown>
  if ('equals' in f) return sameValue(value, f.equals)
  if ('in' in f) {
    const list = Array.isArray(f.in) ? f.in : []
    return list.some((item) => sameValue(value, item))
  }
  if ('notIn' in f) {
    const list = Array.isArray(f.notIn) ? f.notIn : []
    return !list.some((item) => sameValue(value, item))
  }
  if ('not' in f) {
    const not = f.not
    if (not && typeof not === 'object' && !(not instanceof Date)) return !matchScalar(value, not)
    return !sameValue(value, not)
  }
  if ('lt' in f || 'lte' in f || 'gt' in f || 'gte' in f) {
    if (value === null || value === undefined) return false
    const left = isDate(value) || f.lt instanceof Date || f.lte instanceof Date || f.gt instanceof Date || f.gte instanceof Date
      ? toDate(value)
      : Number(value)
    const compare = (other: unknown) => {
      if (left === null) return NaN
      if (left instanceof Date) {
        const d = toDate(other)
        return d === null ? NaN : left.getTime() - d.getTime()
      }
      const n = Number(other)
      return Number.isFinite(n) ? Number(left) - n : NaN
    }
    if ('lt' in f && !(compare(f.lt) < 0)) return false
    if ('lte' in f && !(compare(f.lte) <= 0)) return false
    if ('gt' in f && !(compare(f.gt) > 0)) return false
    if ('gte' in f && !(compare(f.gte) >= 0)) return false
    return true
  }
  if ('contains' in f || 'startsWith' in f || 'endsWith' in f) {
    if (value === null || value === undefined) return false
    const haystack = String(value).toLowerCase()
    if ('contains' in f) return haystack.includes(String(f.contains).toLowerCase())
    if ('startsWith' in f) return haystack.startsWith(String(f.startsWith).toLowerCase())
    if ('endsWith' in f) return haystack.endsWith(String(f.endsWith).toLowerCase())
  }
  return true
}

function inverseRelation(sourceModel: string, field: FieldMeta): FieldMeta | null {
  const target = MODELS[field.type]
  if (!target) return null
  return (
    target.relations.find(
      (r) =>
        r.type === sourceModel &&
        r.relationName === field.relationName &&
        r.relationFromFields.length > 0,
    ) ?? null
  )
}

async function relationRows(
  model: string,
  record: SheetRecord,
  field: FieldMeta,
  loader: Loader,
): Promise<SheetRecord[]> {
  const targets = await loader.get(field.type)
  if (field.relationFromFields.length) {
    const values = field.relationFromFields.map((f) => record[f])
    if (values.some((v) => v === null || v === undefined)) return []
    return targets.filter((target) =>
      field.relationToFields.every((to, i) => sameValue(target[to], values[i])),
    )
  }
  const inverse = inverseRelation(model, field)
  if (!inverse) return []
  const values = inverse.relationToFields.map((f) => record[f])
  if (values.some((v) => v === null || v === undefined)) return []
  return targets.filter((target) =>
    inverse.relationFromFields.every((from, i) => sameValue(target[from], values[i])),
  )
}

async function matchesRelation(
  model: string,
  record: SheetRecord,
  field: FieldMeta,
  condition: unknown,
  loader: Loader,
): Promise<boolean> {
  const rows = await relationRows(model, record, field, loader)
  if (field.isList) {
    const cond = (condition ?? {}) as Record<string, unknown>
    if ('some' in cond) {
      for (const row of rows) {
        if (await matchesWhere(field.type, row, cond.some, loader)) return true
      }
      return false
    }
    if ('none' in cond) {
      for (const row of rows) {
        if (await matchesWhere(field.type, row, cond.none, loader)) return false
      }
      return true
    }
    if ('every' in cond) {
      for (const row of rows) {
        if (!(await matchesWhere(field.type, row, cond.every, loader))) return false
      }
      return true
    }
    // A bare object on a to-many relation behaves like "some".
    for (const row of rows) {
      if (await matchesWhere(field.type, row, condition, loader)) return true
    }
    return false
  }

  const cond = (condition ?? {}) as Record<string, unknown>
  if ('is' in cond) {
    if (cond.is === null) return rows.length === 0
    return rows.length > 0 && (await matchesWhere(field.type, rows[0], cond.is, loader))
  }
  if ('isNot' in cond) {
    if (cond.isNot === null) return rows.length > 0
    return rows.length === 0 || !(await matchesWhere(field.type, rows[0], cond.isNot, loader))
  }
  return rows.length > 0 && (await matchesWhere(field.type, rows[0], condition, loader))
}

async function matchesWhere(
  model: string,
  record: SheetRecord,
  where: unknown,
  loader: Loader,
): Promise<boolean> {
  if (!where || typeof where !== 'object') return true
  const meta = MODELS[model]
  if (!meta) return true
  const condition = where as Record<string, unknown>

  for (const [key, value] of Object.entries(condition)) {
    if (value === undefined) continue
    if (key === 'AND') {
      const list = Array.isArray(value) ? value : [value]
      for (const entry of list) {
        if (!(await matchesWhere(model, record, entry, loader))) return false
      }
      continue
    }
    if (key === 'OR') {
      const list = Array.isArray(value) ? value : [value]
      if (!list.length) return false
      let any = false
      for (const entry of list) {
        if (await matchesWhere(model, record, entry, loader)) {
          any = true
          break
        }
      }
      if (!any) return false
      continue
    }
    if (key === 'NOT') {
      const list = Array.isArray(value) ? value : [value]
      for (const entry of list) {
        if (await matchesWhere(model, record, entry, loader)) return false
      }
      continue
    }
    const field = meta.fieldMap[key]
    if (!field) continue
    if (field.kind === 'object') {
      if (!(await matchesRelation(model, record, field, value, loader))) return false
    } else if (!matchScalar(record[key], value)) {
      return false
    }
  }
  return true
}

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

function directionOf(value: unknown) {
  if (value === 'desc' || value === -1) return -1
  if (value && typeof value === 'object' && (value as { sort?: string }).sort === 'desc') return -1
  return 1
}

async function orderValue(
  model: string,
  record: SheetRecord,
  key: string,
  loader: Loader,
): Promise<unknown> {
  const meta = MODELS[model]
  const field = meta.fieldMap[key]
  if (!field) return null
  if (field.kind === 'scalar') return record[key]
  const rows = await relationRows(model, record, field, loader)
  return rows[0]?.id ?? null
}

async function sortRecords(
  model: string,
  records: SheetRecord[],
  orderBy: unknown,
  loader: Loader,
): Promise<SheetRecord[]> {
  if (!orderBy) return records
  const list = Array.isArray(orderBy) ? orderBy : [orderBy]
  const criteria: Array<{ key: string; direction: number }> = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      criteria.push({ key, direction: directionOf(value) })
    }
  }
  if (!criteria.length) return records
  const decorated = await Promise.all(
    records.map(async (record, index) => ({
      record,
      index,
      keys: await Promise.all(criteria.map((c) => orderValue(model, record, c.key, loader))),
    })),
  )
  decorated.sort((a, b) => {
    for (let i = 0; i < criteria.length; i += 1) {
      const av = a.keys[i]
      const bv = b.keys[i]
      const aEmpty = av === null || av === undefined || av === ''
      const bEmpty = bv === null || bv === undefined || bv === ''
      if (aEmpty && bEmpty) continue
      if (aEmpty) return 1
      if (bEmpty) return -1
      let diff = 0
      if (isDate(av) || isDate(bv)) {
        diff = (toDate(av)?.getTime() ?? 0) - (toDate(bv)?.getTime() ?? 0)
      } else if (typeof av === 'number' && typeof bv === 'number') {
        diff = av - bv
      } else {
        diff = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      }
      if (diff !== 0) return diff * criteria[i].direction
    }
    return a.index - b.index
  })
  return decorated.map((d) => d.record)
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

function projectScalars(record: SheetRecord, model: string) {
  const meta = MODELS[model]
  const out: Record<string, unknown> = {}
  for (const field of meta.scalars) out[field.name] = record[field.name]
  return out
}

async function projectRecord(
  model: string,
  record: SheetRecord,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<Record<string, unknown>> {
  const meta = MODELS[model]
  const select = args.select as Record<string, unknown> | undefined
  const include = args.include as Record<string, unknown> | undefined

  if (select) {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(select)) {
      if (value === false || value === undefined) continue
      if (key === '_count') {
        out._count = await resolveCount(model, record, value, loader)
        continue
      }
      const field = meta.fieldMap[key]
      if (!field) continue
      if (field.kind === 'scalar') {
        out[key] = record[key]
        continue
      }
      out[key] = await resolveRelation(model, record, field, value === true ? {} : value, loader)
    }
    return out
  }

  const out = projectScalars(record, model)
  if (include) {
    for (const [key, value] of Object.entries(include)) {
      if (value === false || value === undefined) continue
      if (key === '_count') {
        out._count = await resolveCount(model, record, value, loader)
        continue
      }
      const field = meta.fieldMap[key]
      if (!field || field.kind !== 'object') continue
      out[key] = await resolveRelation(model, record, field, value === true ? {} : value, loader)
    }
  }
  return out
}

async function resolveRelation(
  model: string,
  record: SheetRecord,
  field: FieldMeta,
  rawArgs: unknown,
  loader: Loader,
): Promise<unknown> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  let rows = await relationRows(model, record, field, loader)

  if (args.where) {
    const filtered: SheetRecord[] = []
    for (const row of rows) {
      if (await matchesWhere(field.type, row, args.where, loader)) filtered.push(row)
    }
    rows = filtered
  }
  if (args.orderBy) rows = await sortRecords(field.type, rows, args.orderBy, loader)
  if (typeof args.skip === 'number') rows = rows.slice(Math.max(0, args.skip))
  if (typeof args.take === 'number') rows = args.take >= 0 ? rows.slice(0, args.take) : rows.slice(args.take)

  if (field.isList) {
    const out: Array<Record<string, unknown>> = []
    for (const row of rows) out.push(await projectRecord(field.type, row, args, loader))
    return out
  }
  const first = rows[0]
  return first ? projectRecord(field.type, first, args, loader) : null
}

async function resolveCount(
  model: string,
  record: SheetRecord,
  rawArgs: unknown,
  loader: Loader,
): Promise<Record<string, number>> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  const selection = (args.select ?? rawArgs) as Record<string, unknown>
  const out: Record<string, number> = {}
  const meta = MODELS[model]
  for (const [key, value] of Object.entries(selection ?? {})) {
    if (!value) continue
    const field = meta.fieldMap[key]
    if (!field || field.kind !== 'object') continue
    let rows = await relationRows(model, record, field, loader)
    const where = value && typeof value === 'object' ? (value as Record<string, unknown>).where : undefined
    if (where) {
      const filtered: SheetRecord[] = []
      for (const row of rows) {
        if (await matchesWhere(field.type, row, where, loader)) filtered.push(row)
      }
      rows = filtered
    }
    out[key] = rows.length
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Write helpers                                                       */
/* ------------------------------------------------------------------ */

function resolveDefault(field: FieldMeta): unknown {
  if (!field.hasDefaultValue) return undefined
  const value = field.default
  if (value && typeof value === 'object') {
    const name = (value as { name?: string }).name
    if (name === 'now') return new Date()
    if (name === 'cuid' || name === 'uuid' || name === 'ulid') return generateId()
    if (name === 'auto') return undefined
    return undefined
  }
  return value
}

function validateRequired(model: string, record: SheetRecord) {
  const meta = MODELS[model]
  for (const field of meta.scalars) {
    if (!field.isRequired) continue
    if (record[field.name] === null || record[field.name] === undefined) {
      throw new SheetsRecordError(
        'P2011',
        `Missing required value for ${model}.${field.name}. The record was not saved.`,
      )
    }
  }
}

async function validateUnique(
  model: string,
  record: SheetRecord,
  ignoreId: string | null,
  loader: Loader,
) {
  const meta = MODELS[model]
  const rows = await loader.get(model)
  const others = rows.filter((row) => !ignoreId || String(row.id) !== ignoreId)

  for (const field of meta.scalars) {
    if (!field.isUnique && !field.isId) continue
    const value = record[field.name]
    if (isEmpty(value)) continue
    if (others.some((row) => sameValue(row[field.name], value))) {
      throw conflict(`A record with this ${field.name} already exists. Duplicate save blocked.`)
    }
  }

  for (const group of meta.uniqueFields) {
    if (!group.length) continue
    const values = group.map((name) => record[name])
    if (values.some(isEmpty)) continue
    const duplicate = others.some((row) => group.every((name, i) => sameValue(row[name], values[i])))
    if (duplicate) {
      throw conflict(
        `A record with this ${group.join(' + ')} combination already exists. Duplicate save blocked.`,
      )
    }
  }
}

function encodeCell(field: ScalarField, value: unknown) {
  if (value === null || value === undefined) return ''
  if (field.type === 'DateTime') {
    const date = toDate(value)
    return date ? date.toISOString() : ''
  }
  if (field.type === 'Int') return Math.trunc(Number(value))
  if (field.type === 'Float') return Number(value)
  if (field.type === 'Boolean') return Boolean(value)
  return String(value)
}

function buildWriteOp(
  model: string,
  record: SheetRecord,
  mode: GatewayWriteOp['mode'],
  options: {
    matchHeader?: string
    matchValue?: unknown
    uniqueChecks?: boolean
  } = {},
): GatewayWriteOp {
  const spec = modelSpec(model)
  const tab = tabSpecForModel(model)
  const data: Record<string, unknown> = {}
  const uniqueChecks: Array<{ header: string; value: string }> = []

  for (const field of spec.fields) {
    data[field.header] = encodeCell(field, record[field.name])
    if (
      options.uniqueChecks &&
      (field.unique || field.id) &&
      !isEmpty(record[field.name]) &&
      field.type !== 'DateTime'
    ) {
      uniqueChecks.push({ header: field.header, value: String(record[field.name]) })
    }
  }
  if (spec.recordType) data['Record Type'] = spec.recordType

  const monthly = spec.kind === 'monthly'
  return {
    mode,
    kind: spec.kind,
    tab: monthly ? undefined : spec.tab,
    suffix: monthly ? spec.suffix : undefined,
    monthKey: monthly ? rowMonthKey(model, record) : undefined,
    id: String(record.id),
    idHeader: spec.idHeader,
    headers: tab.headers,
    types: tab.types,
    validations: tab.validations,
    data,
    matchHeader: options.matchHeader,
    matchValue:
      options.matchValue === undefined || options.matchValue === null
        ? undefined
        : String(options.matchValue),
    uniqueChecks,
  } as GatewayWriteOp
}

function stageRecord(
  model: string,
  record: SheetRecord,
  mode: GatewayWriteOp['mode'],
  options: Parameters<typeof buildWriteOp>[3] = {},
) {
  stageWrite(model, buildWriteOp(model, record, mode, options), record)
}

/**
 * Deletes are staged with a null overlay row so later reads in the same
 * request cannot see a record that is about to disappear.
 */
function stageDelete(model: string, record: SheetRecord) {
  stageWrite(model, buildWriteOp(model, record, 'delete'), null)
}

async function uniqueWhere(
  model: string,
  where: unknown,
): Promise<{ field: FieldMeta; value: unknown } | null> {
  if (!where || typeof where !== 'object') return null
  const meta = MODELS[model]
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object') continue
    const field = meta.fieldMap[key]
    if (field && field.kind === 'scalar' && (field.isUnique || field.isId)) {
      return { field, value }
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

async function findMany(
  model: string,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<Array<Record<string, unknown>>> {
  let rows = await loader.get(model)
  if (args.where) {
    const filtered: SheetRecord[] = []
    for (const row of rows) {
      if (await matchesWhere(model, row, args.where, loader)) filtered.push(row)
    }
    rows = filtered
  }
  if (args.orderBy) rows = await sortRecords(model, rows, args.orderBy, loader)

  if (Array.isArray(args.distinct)) {
    const distinct = args.distinct as string[]
    const seen = new Set<string>()
    rows = rows.filter((row) => {
      const key = distinct.map((name) => String(row[name] ?? '')).join('\u0000')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  if (typeof args.cursor === 'object' && args.cursor) {
    const cursor = args.cursor as Record<string, unknown>
    const index = rows.findIndex((row) =>
      Object.entries(cursor).every(([key, value]) => sameValue(row[key], value)),
    )
    if (index >= 0) rows = rows.slice(index + (args.skip ? 0 : 1))
  }
  if (typeof args.skip === 'number') rows = rows.slice(Math.max(0, args.skip))
  if (typeof args.take === 'number') rows = args.take >= 0 ? rows.slice(0, args.take) : rows.slice(args.take)

  const out: Array<Record<string, unknown>> = []
  for (const row of rows) out.push(await projectRecord(model, row, args, loader))
  return out
}

async function findOne(
  model: string,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<SheetRecord | null> {
  const rows = await loader.get(model)
  for (const row of rows) {
    if (await matchesWhere(model, row, args.where, loader)) return row
  }
  return null
}

function buildCreateRecord(
  model: string,
  data: Record<string, unknown>,
): SheetRecord {
  const meta = MODELS[model]
  const record: SheetRecord = {}
  for (const field of meta.scalars) {
    const provided = data[field.name]
    if (provided !== undefined) {
      record[field.name] = coerce(field, provided)
      continue
    }
    const fallback = resolveDefault(field)
    if (fallback !== undefined) {
      record[field.name] = coerce(field, fallback)
      continue
    }
    if (field.isUpdatedAt) {
      record[field.name] = new Date()
      continue
    }
    if (field.isRequired) {
      throw new SheetsRecordError(
        'P2011',
        `Missing required value for ${model}.${field.name}. The record was not saved.`,
      )
    }
    record[field.name] = null
  }
  if (!record.id) record.id = generateId()
  validateRequired(model, record)
  return record
}

async function createOne(
  model: string,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<Record<string, unknown>> {
  const data = (args.data ?? {}) as Record<string, unknown>
  const meta = MODELS[model]
  for (const field of meta.scalars) {
    if (data[field.name] === undefined) continue
    if (field.isRequired && (data[field.name] === null || data[field.name] === undefined)) {
      throw new SheetsRecordError(
        'P2011',
        `Missing required value for ${model}.${field.name}. The record was not saved.`,
      )
    }
  }

  const record = buildCreateRecord(model, data)
  for (const field of meta.scalars) {
    if (field.isUpdatedAt) record[field.name] = new Date()
  }
  await validateUnique(model, record, null, loader)
  stageRecord(model, record, 'create', { uniqueChecks: true })
  loader.clear()
  await applyNestedCreate(model, record, data, loader)
  return projectRecord(model, record, args, loader)
}

async function applyNestedCreate(
  model: string,
  parent: SheetRecord,
  data: Record<string, unknown>,
  loader: Loader,
) {
  const meta = MODELS[model]
  for (const [key, value] of Object.entries(data)) {
    const field = meta.fieldMap[key]
    if (!field || field.kind !== 'object' || !value || typeof value !== 'object') continue
    const nested = value as Record<string, unknown>
    if (nested.create) {
      if (field.relationFromFields.length) {
        // The foreign key lives on this model (a singular relation). Create
        // the child, then point this record at it.
        const items = Array.isArray(nested.create) ? nested.create : [nested.create]
        const createdIds: unknown[] = []
        for (const item of items) {
          const child = await createOne(field.type, { data: item }, loader)
          createdIds.push(child[field.relationToFields[0]])
        }
        if (createdIds.length && !field.isList) {
          const patch: Record<string, unknown> = {}
          field.relationFromFields.forEach((name, i) => {
            patch[name] = createdIds[i] ?? createdIds[0]
          })
          await updateOne(model, { where: { id: parent.id }, data: patch }, loader)
        }
      } else {
        const inverse = inverseRelation(model, field)
        if (!inverse) continue
        const items = Array.isArray(nested.create) ? nested.create : [nested.create]
        for (const item of items) {
          const childData = { ...((item ?? {}) as Record<string, unknown>) }
          inverse.relationFromFields.forEach((name, i) => {
            childData[name] = parent[inverse.relationToFields[i]]
          })
          await createOne(field.type, { data: childData }, loader)
        }
      }
    }

    if (nested.connect) {
      const items = Array.isArray(nested.connect) ? nested.connect : [nested.connect]
      for (const where of items) {
        const target = await findOne(field.type, { where }, loader)
        if (!target) continue
        if (field.relationFromFields.length) {
          const patch: Record<string, unknown> = {}
          field.relationFromFields.forEach((name, i) => {
            patch[name] = target[field.relationToFields[i]]
          })
          await updateOne(model, { where: { id: parent.id }, data: patch }, loader)
        } else {
          const inverse = inverseRelation(model, field)
          if (!inverse) continue
          const patch: Record<string, unknown> = {}
          inverse.relationFromFields.forEach((name, i) => {
            patch[name] = parent[inverse.relationToFields[i]]
          })
          await updateOne(field.type, { where: { id: target.id }, data: patch }, loader)
        }
      }
    }
  }
}

async function updateOne(
  model: string,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<Record<string, unknown>> {
  const meta = MODELS[model]
  const existing = await findOne(model, { where: args.where }, loader)
  if (!existing) throw notFound('The requested record was not found. It may have been deleted.')

  const data = (args.data ?? {}) as Record<string, unknown>
  const record: SheetRecord = { ...existing }
  applyMeta(record, metaOf(existing))

  for (const field of meta.scalars) {
    if (!(field.name in data)) continue
    const value = data[field.name]
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const op = value as Record<string, unknown>
      if ('increment' in op) {
        record[field.name] = Number(record[field.name] ?? 0) + Number(op.increment)
        continue
      }
      if ('decrement' in op) {
        record[field.name] = Number(record[field.name] ?? 0) - Number(op.decrement)
        continue
      }
      if ('set' in op) {
        record[field.name] = coerce(field, op.set)
        continue
      }
    }
    record[field.name] = coerce(field, value)
  }
  for (const field of meta.scalars) {
    if (field.isUpdatedAt) record[field.name] = new Date()
  }

  validateRequired(model, record)
  await validateUnique(model, record, String(existing.id), loader)
  stageRecord(model, record, 'update', { uniqueChecks: true })
  loader.clear()

  // Nested updates are only needed for the operations used by this app.
  await applyNestedCreate(model, record, data, loader)

  return projectRecord(model, record, args, loader)
}

async function upsertOne(
  model: string,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<Record<string, unknown>> {
  const where = args.where
  const existing = await findOne(model, { where }, loader)
  if (existing) {
    return updateOne(
      model,
      {
        where: { id: existing.id },
        data: args.update,
        select: args.select,
        include: args.include,
      },
      loader,
    )
  }

  const createData = { ...((args.create ?? {}) as Record<string, unknown>) }
  const key = await uniqueWhere(model, where)
  if (key && createData[key.field.name] === undefined) createData[key.field.name] = key.value
  if (!createData.id && key && !key.field.isId) {
    createData.id = deterministicId(model, key.field.name, key.value)
  }
  if (!createData.id && where && typeof where === 'object' && 'id' in where) {
    createData.id = (where as Record<string, unknown>).id
  }

  const record = buildCreateRecord(model, createData)
  const meta = MODELS[model]
  for (const field of meta.scalars) {
    if (field.isUpdatedAt) record[field.name] = new Date()
  }
  await validateUnique(model, record, null, loader)
  stageRecord(model, record, 'upsert', {
    matchHeader: key && !key.field.isId ? goalHeader(model, key.field.name) : undefined,
    matchValue: key && !key.field.isId ? key.value : undefined,
    uniqueChecks: true,
  })
  loader.clear()
  await applyNestedCreate(model, record, createData, loader)
  return projectRecord(model, record, args, loader)
}

function goalHeader(model: string, fieldName: string) {
  const spec = modelSpec(model)
  return spec.fields.find((f) => f.name === fieldName)?.header
}

async function cascadeDelete(
  model: string,
  record: SheetRecord,
  loader: Loader,
  seen: Set<string>,
) {
  const marker = `${model}:${record.id}`
  if (seen.has(marker)) return
  seen.add(marker)

  for (const childModelName of MODEL_NAMES) {
    if (!MODEL_SPECS[childModelName]) continue
    const childMeta = MODELS[childModelName]
    for (const relation of childMeta.relations) {
      if (relation.type !== model || !relation.relationFromFields.length) continue
      const rows = await loader.get(childModelName)
      const matches = rows.filter((row) =>
        relation.relationFromFields.every((fromField, i) =>
          sameValue(row[fromField], record[relation.relationToFields[i]]),
        ),
      )
      if (!matches.length) continue

      if (relation.relationOnDelete === 'Restrict') {
        throw new SheetsRecordError(
          'P2003',
          `Cannot delete this ${model} because ${childModelName} records still reference it.`,
        )
      }
      if (relation.relationOnDelete === 'SetNull') {
        for (const match of matches) {
          const patch: Record<string, unknown> = {}
          for (const fromField of relation.relationFromFields) patch[fromField] = null
          await updateOne(childModelName, { where: { id: match.id }, data: patch }, loader)
        }
        continue
      }
      // Cascade (and Prisma's SQLite default, which is a restrictive FK).
      for (const match of matches) {
        await cascadeDelete(childModelName, match, loader, seen)
        stageDelete(childModelName, match)
      }
    }
  }
}

async function deleteOne(
  model: string,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<Record<string, unknown>> {
  const existing = await findOne(model, { where: args.where }, loader)
  if (!existing) throw notFound('The requested record was not found.')
  const projected = await projectRecord(model, existing, args, loader)
  await cascadeDelete(model, existing, loader, new Set())
  stageDelete(model, existing)
  loader.clear()
  return projected
}

async function updateMany(
  model: string,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<{ count: number }> {
  const rows = await loader.get(model)
  let count = 0
  for (const row of rows) {
    if (!(await matchesWhere(model, row, args.where, loader))) continue
    await updateOne(model, { where: { id: row.id }, data: args.data }, loader)
    count += 1
  }
  return { count }
}

async function deleteMany(
  model: string,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<{ count: number }> {
  const rows = await loader.get(model)
  const targets: SheetRecord[] = []
  for (const row of rows) {
    if (await matchesWhere(model, row, args.where, loader)) targets.push(row)
  }
  for (const row of targets) {
    await cascadeDelete(model, row, loader, new Set())
    stageDelete(model, row)
  }
  loader.clear()
  return { count: targets.length }
}

async function groupBy(
  model: string,
  args: Record<string, unknown>,
  loader: Loader,
): Promise<Array<Record<string, unknown>>> {
  let rows = await loader.get(model)
  if (args.where) {
    const filtered: SheetRecord[] = []
    for (const row of rows) {
      if (await matchesWhere(model, row, args.where, loader)) filtered.push(row)
    }
    rows = filtered
  }
  const by = Array.isArray(args.by) ? (args.by as string[]) : []
  const groups = new Map<string, SheetRecord[]>()
  for (const row of rows) {
    const key = by.map((name) => String(row[name] ?? '')).join('\u0000')
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  const out: Array<Record<string, unknown>> = []
  for (const list of groups.values()) {
    const entry: Record<string, unknown> = {}
    for (const name of by) entry[name] = list[0]?.[name] ?? null
    const countArg = args._count as Record<string, unknown> | undefined
    if (countArg) {
      const counts: Record<string, number> = {}
      for (const [key, value] of Object.entries(countArg)) {
        if (!value) continue
        counts[key === '_all' ? '_all' : key] = list.length
      }
      entry._count = counts
    }
    out.push(entry)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

type Snapshot = {
  ops: GatewayWriteOp[]
  overlay: Map<string, Map<string, SheetRecord | null>>
}

export function createSheetsClient() {
  const client: Record<string, unknown> = {}

  for (const model of MODEL_NAMES) {
    if (!MODEL_SPECS[model]) continue
    const delegate = {
      findMany: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        return findMany(model, args, loader)
      },
      findFirst: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        const rows = await findMany(model, { ...args, take: 1 }, loader)
        return rows[0] ?? null
      },
      findUnique: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        const row = await findOne(model, args, loader)
        return row ? projectRecord(model, row, args, loader) : null
      },
      findUniqueOrThrow: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        const row = await findOne(model, args, loader)
        if (!row) throw notFound('The requested record was not found.')
        return projectRecord(model, row, args, loader)
      },
      findFirstOrThrow: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        const row = await findOne(model, args, loader)
        if (!row) throw notFound('The requested record was not found.')
        return projectRecord(model, row, args, loader)
      },
      create: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        return createOne(model, args, loader)
      },
      createMany: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        const items = (args.data ?? []) as Array<Record<string, unknown>>
        let count = 0
        for (const item of items) {
          try {
            await createOne(model, { data: item }, loader)
            count += 1
          } catch (err) {
            if (args.skipDuplicates && err instanceof SheetsRecordError && err.code === 'P2002') continue
            throw err
          }
        }
        return { count }
      },
      update: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        return updateOne(model, args, loader)
      },
      updateMany: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        return updateMany(model, args, loader)
      },
      upsert: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        return upsertOne(model, args, loader)
      },
      delete: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        return deleteOne(model, args, loader)
      },
      deleteMany: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        return deleteMany(model, args, loader)
      },
      count: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        const rows = await loader.get(model)
        if (!args.where) return rows.length
        let count = 0
        for (const row of rows) {
          if (await matchesWhere(model, row, args.where, loader)) count += 1
        }
        return count
      },
      groupBy: async (args: Record<string, unknown> = {}) => {
        const loader = createLoader()
        return groupBy(model, args, loader)
      },
    }
    client[model[0].toLowerCase() + model.slice(1)] = delegate
  }

  // A transaction is a staged unit: writes are buffered and flushed once by
  // the request context. If the callback throws, the staged state is restored.
  const transaction = async (input: unknown) => {
    const { getSheetsContext } = await import('./runtime')
    const ctx = getSheetsContext()
    const snapshot: Snapshot | null = ctx
      ? {
          ops: ctx.ops.slice(),
          overlay: new Map(
            [...ctx.overlay.entries()].map(([key, value]) => [key, new Map(value)]),
          ),
        }
      : null
    try {
      if (typeof input === 'function') return await (input as (tx: unknown) => Promise<unknown>)(client)
      if (Array.isArray(input)) {
        const results: unknown[] = []
        for (const item of input) results.push(await item)
        return results
      }
      throw new Error('Unsupported transaction input.')
    } catch (err) {
      if (ctx && snapshot) {
        ctx.ops = snapshot.ops
        ctx.overlay = snapshot.overlay
      }
      throw err
    }
  }

  client.$transaction = transaction
  client.$connect = async () => undefined
  client.$disconnect = async () => undefined
  client.$queryRaw = async () => [{ ok: 1 }]
  client.$executeRaw = async () => 1

  return client
}

export type SheetsClient = ReturnType<typeof createSheetsClient>
