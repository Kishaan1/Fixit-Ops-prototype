import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  IndianRupee,
  Plus,
  Receipt,
  Save,
  Settings as SettingsIcon,
  Store,
  Trash2,
} from 'lucide-react'
import { api, errorMessage, qs } from '../lib/api'
import { useToast } from '../lib/toast'
import { date, dateTime, money, number } from '../lib/format'
import type { DateRange, Shop } from '../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SectionTitle,
  Select,
  SkeletonRows,
  StatCard,
  Tabs,
  Textarea,
} from '../components/ui'

const PERIODS = [
  ['month', 'This month'],
  ['week', 'Last 7 days'],
  ['year', 'This year'],
  ['all', 'All time'],
]

const EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Salaries',
  'Tools & equipment',
  'Transport',
  'Marketing',
  'Consumables',
  'Other',
]

interface SettingsResponse {
  shop: Shop
  storage?: {
    type: string
    configured: boolean
    timezone: string
  }
  counts: {
    repairs: number
    demoRepairs: number
    customers: number
    demoCustomers: number
    parts: number
    demoParts: number
    users: number
    lowStock: number
  }
}

interface ExpenseItem {
  id: string
  category: string
  amount: number
  note: string | null
  incurredAt: string
  isDemo: boolean
  repair: { code: string } | null
  createdBy: { name: string } | null
}

interface AuditItem {
  id: string
  action: string
  entity: string
  entityId: string | null
  meta: string | null
  ip: string | null
  createdAt: string
  user: { name: string; role: string } | null
}

export default function SettingsPage() {
  const { success, error } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('shop')
  const [expensePage, setExpensePage] = useState(1)
  const [expensePeriod, setExpensePeriod] = useState('month')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseForm, setExpenseForm] = useState({
    category: 'Rent',
    amount: '',
    note: '',
    incurredAt: '',
  })
  const [expenseError, setExpenseError] = useState<string | null>(null)
  const [auditPage, setAuditPage] = useState(1)
  const [confirmation, setConfirmation] = useState('')
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [shopForm, setShopForm] = useState<Record<string, string | number | boolean> | null>(null)
  const [shopError, setShopError] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/settings'),
  })

  const expenses = useQuery({
    queryKey: ['settings', 'expenses', expensePeriod],
    queryFn: () =>
      api.get<{ items: ExpenseItem[]; total: number; range: DateRange }>(
        `/settings/expenses${qs({ period: expensePeriod })}`,
      ),
    enabled: tab === 'expenses',
  })

  const audit = useQuery({
    queryKey: ['settings', 'audit', auditPage],
    queryFn: () =>
      api.get<{ items: AuditItem[]; total: number; page: number; pageSize: number }>(
        `/settings/audit${qs({ page: auditPage, pageSize: 25 })}`,
      ),
    enabled: tab === 'audit',
  })

  const saveShop = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<{ shop: Shop }>('/settings', body),
    onSuccess: () => {
      success('Shop settings saved', 'New reports will use the updated details.')
      setShopError(null)
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (err) => setShopError(errorMessage(err)),
  })

  const addExpense = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/settings/expenses', body),
    onSuccess: () => {
      success('Expense recorded', 'It now counts toward overhead and profit.')
      setExpenseOpen(false)
      setExpenseForm({ category: 'Rent', amount: '', note: '', incurredAt: '' })
      setExpenseError(null)
      void queryClient.invalidateQueries({ queryKey: ['settings', 'expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['overview'] })
    },
    onError: (err) => setExpenseError(errorMessage(err)),
  })

  const deleteExpense = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/expenses/${id}`),
    onSuccess: () => {
      success('Expense deleted')
      void queryClient.invalidateQueries({ queryKey: ['settings', 'expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['overview'] })
    },
    onError: (err) => error('Could not delete expense', errorMessage(err)),
  })

  const backupSpreadsheet = useMutation({
    mutationFn: () =>
      api.post<{ backup: { fileId: string; name: string; url: string }; message: string }>(
        '/settings/backup',
      ),
    onSuccess: (data) => {
      success('Backup created', `${data.backup.name} was saved to Google Drive.`)
      if (data.backup.url) window.open(data.backup.url, '_blank', 'noopener,noreferrer')
    },
    onError: (err) => error('Could not create a backup', errorMessage(err)),
  })

  const purgeDemo = useMutation({
    mutationFn: () => api.post('/settings/demo/purge', { confirmation }),
    onSuccess: () => {
      success('Demo data removed', 'Your real records were left untouched.')
      setPurgeOpen(false)
      setConfirmation('')
      void queryClient.invalidateQueries()
    },
    onError: (err) => error('Could not purge demo data', errorMessage(err)),
  })

  if (settings.isLoading) return <SkeletonRows rows={8} />
  if (settings.isError)
    return (
      <Card padded={false}>
        <ErrorState message="Settings could not be loaded." onRetry={() => settings.refetch()} />
      </Card>
    )
  if (!settings.data) return null

  const { shop, counts } = settings.data

  const form = shopForm ?? {
    name: shop.name,
    legalName: shop.legalName ?? '',
    phone: shop.phone ?? '',
    email: shop.email ?? '',
    address: shop.address ?? '',
    gstin: shop.gstin ?? '',
    taxRate: shop.taxRate,
    ownerApprovalThreshold: shop.ownerApprovalThreshold,
    lowStockAlerts: shop.lowStockAlerts,
  }

  const setField = (key: string, value: string | number | boolean) =>
    setShopForm({ ...form, [key]: value })

  const submitShop = () => {
    setShopError(null)
    if (String(form.name).trim().length < 2) {
      setShopError('Enter the shop name.')
      return
    }
    saveShop.mutate({
      name: String(form.name).trim(),
      legalName: String(form.legalName).trim(),
      phone: String(form.phone).trim(),
      email: String(form.email).trim(),
      address: String(form.address).trim(),
      gstin: String(form.gstin).trim(),
      taxRate: Number(form.taxRate) || 0,
      ownerApprovalThreshold: Number(form.ownerApprovalThreshold) || 0,
      lowStockAlerts: Boolean(form.lowStockAlerts),
    })
  }

  const submitExpense = () => {
    setExpenseError(null)
    if (!expenseForm.amount || Number(expenseForm.amount) <= 0) {
      setExpenseError('Enter an amount greater than zero.')
      return
    }
    addExpense.mutate({
      category: expenseForm.category,
      amount: Number(expenseForm.amount),
      note: expenseForm.note.trim(),
      ...(expenseForm.incurredAt
        ? { incurredAt: new Date(expenseForm.incurredAt).toISOString() }
        : {}),
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Shop identity, overheads, audit history and demo-data hygiene. Changes here are restricted to the owner and recorded in the audit log."
      />

      <Card padded={false}>
        <div className="px-4 pt-3">
          <Tabs
            tabs={[
              { id: 'shop', label: 'Shop profile' },
              { id: 'expenses', label: 'Expenses' },
              { id: 'audit', label: 'Audit log', count: audit.data?.total },
              { id: 'data', label: 'Data & demo' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'shop' ? (
          <div className="p-5 sm:p-6">
            <SectionTitle
              title="Shop profile"
              description="Used on customer QR reports and printed handovers."
              icon={Store}
            />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Shop name" required>
                <Input value={String(form.name)} onChange={(event) => setField('name', event.target.value)} />
              </Field>
              <Field label="Legal / registered name">
                <Input
                  value={String(form.legalName)}
                  onChange={(event) => setField('legalName', event.target.value)}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Phone">
                <Input value={String(form.phone)} onChange={(event) => setField('phone', event.target.value)} />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={String(form.email)}
                  onChange={(event) => setField('email', event.target.value)}
                />
              </Field>
              <Field label="GSTIN / tax ID">
                <Input
                  value={String(form.gstin)}
                  onChange={(event) => setField('gstin', event.target.value)}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Default tax rate (%)" hint="Applied as normal practice; every quotation still records its own rate.">
                <Input
                  type="number"
                  min={0}
                  max={50}
                  step="0.5"
                  value={Number(form.taxRate)}
                  onChange={(event) => setField('taxRate', event.target.value)}
                />
              </Field>
            </div>
            <Field label="Address" className="mt-4">
              <Textarea
                value={String(form.address)}
                onChange={(event) => setField('address', event.target.value)}
                placeholder="Street, city, state and PIN"
              />
            </Field>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Owner approval threshold"
                hint="Quotes at or above this amount require owner approval before reaching the customer."
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={Number(form.ownerApprovalThreshold)}
                  onChange={(event) => setField('ownerApprovalThreshold', event.target.value)}
                />
              </Field>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-white/10">
                <input
                  type="checkbox"
                  checked={Boolean(form.lowStockAlerts)}
                  onChange={(event) => setField('lowStockAlerts', event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    Low-stock notifications
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Notify the owner when a part reaches its minimum quantity.
                  </span>
                </span>
              </label>
            </div>
            {shopError ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {shopError}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end border-t border-slate-200/80 pt-4 dark:border-white/10">
              <Button icon={Save} loading={saveShop.isPending} onClick={submitShop}>
                Save settings
              </Button>
            </div>
          </div>
        ) : null}

        {tab === 'expenses' ? (
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SectionTitle
                title="Operating expenses"
                description="Rent, utilities and other overheads used in profit calculations."
                icon={Receipt}
              />
              <div className="flex items-center gap-2">
                <Select
                  value={expensePeriod}
                  onChange={(event) => setExpensePeriod(event.target.value)}
                  className="w-36"
                >
                  {PERIODS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Button icon={Plus} onClick={() => setExpenseOpen(true)}>
                  Add expense
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Expenses in period"
                value={money(expenses.data?.total ?? 0)}
                hint={
                  expenses.data
                    ? `${date(expenses.data.range.from)} – ${date(expenses.data.range.to)}`
                    : '—'
                }
                icon={IndianRupee}
                tone="red"
              />
              <StatCard
                label="Entries"
                value={number(expenses.data?.items.length ?? 0)}
                hint="Each entry is audit logged"
                icon={ClipboardList}
                tone="slate"
              />
            </div>

            <div className="mt-5">
              {expenses.isLoading ? (
                <SkeletonRows rows={4} />
              ) : expenses.isError ? (
                <ErrorState message="Expenses could not be loaded." onRetry={() => expenses.refetch()} />
              ) : !expenses.data?.items.length ? (
                <EmptyState
                  icon={Receipt}
                  title="No expenses in this period"
                  description="Add rent, utilities or other overheads so profit is accurate."
                  action={
                    <Button icon={Plus} onClick={() => setExpenseOpen(true)}>
                      Add expense
                    </Button>
                  }
                />
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
                  {expenses.data.items.map((expense) => (
                    <div key={expense.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300">
                        <Receipt className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-800 dark:text-slate-200">{expense.category}</p>
                          {expense.isDemo ? <Badge tone="amber">Demo</Badge> : null}
                          {expense.repair ? (
                            <Badge tone="slate">Repair {expense.repair.code}</Badge>
                          ) : null}
                        </div>
                        {expense.note ? (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{expense.note}</p>
                        ) : null}
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {expense.createdBy?.name ?? 'Unknown'} · {dateTime(expense.incurredAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-rose-600 dark:text-rose-400">
                          −{money(expense.amount)}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Trash2}
                          className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                          onClick={() => deleteExpense.mutate(expense.id)}
                          aria-label={`Delete ${expense.category} expense`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'audit' ? (
          <div className="p-5 sm:p-6">
            <SectionTitle
              title="Audit log"
              description="A read-only trail of sensitive actions: status changes, quotes, payments, stock and settings."
              icon={ClipboardList}
            />
            <div className="mt-4">
              {audit.isLoading ? (
                <SkeletonRows rows={8} />
              ) : audit.isError ? (
                <ErrorState message="Audit history could not be loaded." onRetry={() => audit.refetch()} />
              ) : !audit.data?.items.length ? (
                <EmptyState icon={ClipboardList} title="No audit entries yet" />
              ) : (
                <>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                        <tr>
                          <th className="px-4 py-2.5 font-semibold">When</th>
                          <th className="px-4 py-2.5 font-semibold">User</th>
                          <th className="px-4 py-2.5 font-semibold">Action</th>
                          <th className="px-4 py-2.5 font-semibold">Entity</th>
                          <th className="px-4 py-2.5 font-semibold">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {audit.data.items.map((entry) => (
                          <tr key={entry.id}>
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                              {dateTime(entry.createdAt)}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300">
                              {entry.user ? (
                                <>
                                  <span className="font-medium">{entry.user.name}</span>
                                  <span className="block text-[10px] uppercase tracking-wide text-slate-400">
                                    {entry.user.role}
                                  </span>
                                </>
                              ) : (
                                <span className="text-slate-400">System</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge tone="indigo">{entry.action.replace(/_/g, ' ')}</Badge>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                              {entry.entity}
                            </td>
                            <td className="max-w-80 px-4 py-2.5">
                              <p className="truncate font-mono text-[10px] text-slate-400">
                                {entry.meta ?? entry.entityId ?? '—'}
                              </p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    page={audit.data.page}
                    pageSize={audit.data.pageSize}
                    total={audit.data.total}
                    onPage={setAuditPage}
                  />
                </>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'data' ? (
          <div className="p-5 sm:p-6">
            <SectionTitle
              title="Data & demo records"
              description="Demo rows are clearly marked throughout the app and can be removed once you start entering real work."
              icon={Database}
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Repairs"
                value={number(counts.repairs)}
                hint={`${counts.demoRepairs} demo`}
                icon={SettingsIcon}
                tone="indigo"
              />
              <StatCard
                label="Customers"
                value={number(counts.customers)}
                hint={`${counts.demoCustomers} demo`}
                icon={SettingsIcon}
                tone="violet"
              />
              <StatCard
                label="Parts"
                value={number(counts.parts)}
                hint={`${counts.demoParts} demo`}
                icon={SettingsIcon}
                tone="amber"
              />
              <StatCard
                label="Team accounts"
                value={number(counts.users)}
                hint={`${counts.lowStock} low-stock parts`}
                icon={SettingsIcon}
                tone="emerald"
              />
            </div>

            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> Remove demo data
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-800/80 dark:text-amber-200/80">
                This permanently deletes only records flagged as demo: {counts.demoRepairs} repairs,{' '}
                {counts.demoCustomers} customers and {counts.demoParts} parts, plus their linked devices,
                reports, payments and demo suppliers. Real records are never touched. Export anything you
                need first.
              </p>
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                className="mt-3"
                onClick={() => setPurgeOpen(true)}
              >
                Purge demo data
              </Button>
            </div>

            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                <Database className="h-4 w-4" /> Google Sheets storage
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
                Your live data lives in the owner&apos;s Google Spreadsheet, with automatic monthly tabs.
                Images are kept in Google Drive. Create a full spreadsheet backup any time; the copy is
                saved to the owner&apos;s Drive.
              </p>
              <Button
                variant="secondary"
                size="sm"
                icon={Download}
                className="mt-3"
                loading={backupSpreadsheet.isPending}
                onClick={() => backupSpreadsheet.mutate()}
              >
                Back up spreadsheet
              </Button>
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 p-4 text-xs leading-relaxed text-slate-600 dark:border-white/10 dark:text-slate-400">
              <p className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Data integrity
              </p>
              <ul className="mt-2 space-y-1.5">
                <li>• Financial totals are calculated on the server from recorded payments, parts and expenses.</li>
                <li>• Customer QR reports exclude internal costs, margins, contact details and device identifiers.</li>
                <li>• Sensitive actions are written to the audit log with the acting user and timestamp.</li>
                <li>• AI features are optional; when no provider is configured, manual and offline workflows remain available.</li>
              </ul>
            </div>
          </div>
        ) : null}
      </Card>

      <Modal
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        title="Record an expense"
        description="Operating costs reduce net profit. Use the note field for invoice or reference numbers."
        footer={
          <>
            <Button variant="ghost" onClick={() => setExpenseOpen(false)}>
              Cancel
            </Button>
            <Button icon={Plus} loading={addExpense.isPending} onClick={submitExpense}>
              Add expense
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required>
              <Select
                value={expenseForm.category}
                onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}
              >
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" required>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={expenseForm.amount}
                onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })}
                placeholder="0.00"
              />
            </Field>
          </div>
          <Field label="Date incurred" hint="Defaults to now if left empty.">
            <Input
              type="datetime-local"
              value={expenseForm.incurredAt}
              onChange={(event) => setExpenseForm({ ...expenseForm, incurredAt: event.target.value })}
            />
          </Field>
          <Field label="Note">
            <Textarea
              value={expenseForm.note}
              onChange={(event) => setExpenseForm({ ...expenseForm, note: event.target.value })}
              placeholder="Invoice number, vendor or reason"
            />
          </Field>
          {expenseError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {expenseError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        title="Purge demo data"
        description="This action cannot be undone. Only records flagged as demo are deleted."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPurgeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              loading={purgeDemo.isPending}
              disabled={confirmation !== 'DELETE DEMO DATA'}
              onClick={() => purgeDemo.mutate()}
            >
              Permanently delete
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            Type <span className="font-mono font-bold">DELETE DEMO DATA</span> to confirm.
          </div>
          <Field label="Confirmation">
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="DELETE DEMO DATA"
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
