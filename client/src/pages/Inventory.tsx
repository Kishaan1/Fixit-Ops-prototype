import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Boxes,
  ClipboardList,
  PackageSearch,
  Search,
  TrendingUp,
  X,
} from 'lucide-react'
import { api, errorMessage, qs } from '../lib/api'
import { useToast } from '../lib/toast'
import { dateTime, money, number } from '../lib/format'
import type { InventoryTransaction, SparePart } from '../lib/types'
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
  Select,
  SkeletonRows,
  StatCard,
  Tabs,
  Textarea,
} from '../components/ui'

const emptyStock = { type: 'IN', quantity: '1', unitCost: '', note: '' }

export default function Inventory() {
  const { success, error } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('stock')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [selected, setSelected] = useState<SparePart | null>(null)
  const [stockForm, setStockForm] = useState(emptyStock)
  const [formError, setFormError] = useState<string | null>(null)
  const [txPage, setTxPage] = useState(1)

  const parts = useQuery({
    queryKey: ['inventory', 'parts', page, query, lowOnly],
    queryFn: () =>
      api.get<{ items: SparePart[]; total: number; page: number; pageSize: number }>(
        `/parts${qs({ page, pageSize: 20, q: query, lowStock: lowOnly })}`,
      ),
  })

  const summary = useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: () =>
      api.get<{
        totalParts: number
        totalUnits: number
        lowStock: number
        outOfStock: number
        stockValueCost: number
        stockValueRetail: number
      }>('/parts/summary'),
  })

  const transactions = useQuery({
    queryKey: ['inventory', 'transactions', txPage],
    queryFn: () =>
      api.get<{ items: InventoryTransaction[]; total: number; page: number; pageSize: number }>(
        `/parts/transactions${qs({ page: txPage, pageSize: 20 })}`,
      ),
  })

  const adjust = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.post(`/parts/${id}/stock`, body),
    onSuccess: () => {
      success('Stock updated', 'The movement was recorded with your name and timestamp.')
      setSelected(null)
      setStockForm(emptyStock)
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['parts'] })
      void queryClient.invalidateQueries({ queryKey: ['overview'] })
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const openStock = (part: SparePart) => {
    setSelected(part)
    setStockForm({ type: 'IN', quantity: '1', unitCost: String(part.purchasePrice), note: '' })
    setFormError(null)
  }

  const submitStock = () => {
    if (!selected) return
    setFormError(null)
    const quantity = Number(stockForm.quantity)
    if (!Number.isFinite(quantity) || quantity < 1) {
      setFormError('Enter a quantity of at least 1.')
      return
    }
    if (stockForm.type === 'OUT' && quantity > selected.quantity) {
      setFormError(`Only ${selected.quantity} unit(s) are available.`)
      return
    }
    adjust.mutate({
      id: selected.id,
      body: {
        type: stockForm.type,
        quantity,
        unitCost: stockForm.unitCost ? Number(stockForm.unitCost) : undefined,
        note: stockForm.note.trim(),
      },
    })
  }

  const movementTone = (type: string) =>
    type === 'IN' ? 'emerald' : type === 'OUT' ? 'red' : 'amber'

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Stock control"
        title="Inventory"
        description="Every stock movement is written to an auditable ledger. Adjustments require a reason so shrinkage and receiving errors stay visible."
        actions={
          <Button
            variant="outline"
            icon={AlertTriangle}
            onClick={() => {
              setTab('stock')
              setLowOnly((value) => !value)
            }}
          >
            {lowOnly ? 'Show all stock' : 'Show low stock'}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Parts tracked"
          value={number(summary.data?.totalParts ?? 0)}
          hint={`${number(summary.data?.totalUnits ?? 0)} units total`}
          icon={PackageSearch}
          tone="indigo"
        />
        <StatCard
          label="Low stock"
          value={number(summary.data?.lowStock ?? 0)}
          hint={`${summary.data?.outOfStock ?? 0} out of stock`}
          icon={AlertTriangle}
          tone="amber"
        />
        <StatCard
          label="Value at cost"
          value={money(summary.data?.stockValueCost ?? 0)}
          hint="What the stock cost you"
          icon={Boxes}
          tone="violet"
        />
        <StatCard
          label="Retail value"
          value={money(summary.data?.stockValueRetail ?? 0)}
          hint="If sold at listed prices"
          icon={TrendingUp}
          tone="emerald"
        />
      </div>

      <Card padded={false}>
        <div className="px-4 pt-3">
          <Tabs
            tabs={[
              { id: 'stock', label: 'Stock levels', count: parts.data?.total },
              { id: 'ledger', label: 'Movement ledger', count: transactions.data?.total },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'stock' ? (
          <>
            <form
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
              onSubmit={(event) => {
                event.preventDefault()
                setPage(1)
                setQuery(search.trim())
              }}
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search parts by name, SKU or model…"
                  className="pl-12"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      setQuery('')
                      setPage(1)
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>

            {parts.isLoading ? (
              <SkeletonRows rows={6} />
            ) : parts.isError ? (
              <ErrorState message="Stock levels could not be loaded." onRetry={() => parts.refetch()} />
            ) : !parts.data?.items.length ? (
              <EmptyState
                icon={Boxes}
                title={lowOnly ? 'No parts are low on stock' : 'No stock recorded'}
                description={
                  lowOnly
                    ? 'Every tracked part is at or above its minimum level.'
                    : 'Add parts from the spare parts catalogue to start tracking stock.'
                }
                action={
                  lowOnly ? (
                    <Button variant="outline" onClick={() => setLowOnly(false)}>
                      Show all stock
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <thead className="border-y border-slate-200/80 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Part</th>
                        <th className="px-4 py-2.5 text-center font-semibold">On hand</th>
                        <th className="px-4 py-2.5 text-center font-semibold">Minimum</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Cost / unit</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Stock value</th>
                        <th className="px-4 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {parts.data.items.map((part) => (
                        <tr key={part.id} className="transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                          <td className="px-4 py-3.5">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{part.name}</p>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              {part.sku} · {part.category}
                              {part.location ? ` · ${part.location}` : ''}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-center font-semibold text-slate-800 dark:text-slate-200">
                            {part.quantity}
                          </td>
                          <td className="px-4 py-3.5 text-center text-slate-600 dark:text-slate-300">
                            {part.minStock}
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-700 dark:text-slate-300">
                            {money(part.purchasePrice)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-medium text-slate-800 dark:text-slate-200">
                            {money(part.purchasePrice * part.quantity)}
                          </td>
                          <td className="px-4 py-3.5">
                            {part.quantity === 0 ? (
                              <Badge tone="red">Out of stock</Badge>
                            ) : part.quantity <= part.minStock ? (
                              <Badge tone="amber">Low stock</Badge>
                            ) : (
                              <Badge tone="emerald">Healthy</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              icon={ArrowDownToLine}
                              onClick={() => openStock(part)}
                            >
                              Adjust
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={parts.data.page}
                  pageSize={parts.data.pageSize}
                  total={parts.data.total}
                  onPage={setPage}
                />
              </>
            )}
          </>
        ) : (
          <>
            {transactions.isLoading ? (
              <SkeletonRows rows={8} />
            ) : transactions.isError ? (
              <ErrorState
                message="The stock ledger could not be loaded."
                onRetry={() => transactions.refetch()}
              />
            ) : !transactions.data?.items.length ? (
              <EmptyState
                icon={ClipboardList}
                title="No stock movements yet"
                description="Stock-in, stock-out and manual adjustments will appear here."
              />
            ) : (
              <>
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {transactions.data.items.map((tx) => (
                    <div key={tx.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-6">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300">
                        {tx.type === 'IN' ? (
                          <ArrowDownToLine className="h-4 w-4 text-emerald-500" />
                        ) : tx.type === 'OUT' ? (
                          <ArrowUpFromLine className="h-4 w-4 text-rose-500" />
                        ) : (
                          <ArrowLeftRight className="h-4 w-4 text-amber-500" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-800 dark:text-slate-200">{tx.part.name}</p>
                          <Badge tone={movementTone(tx.type)}>{tx.type}</Badge>
                          <span
                            className={
                              tx.quantity >= 0
                                ? 'text-xs font-semibold text-emerald-600 dark:text-emerald-400'
                                : 'text-xs font-semibold text-rose-600 dark:text-rose-400'
                            }
                          >
                            {tx.quantity > 0 ? '+' : ''}
                            {tx.quantity}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {tx.note || 'Stock movement'} · {tx.part.sku}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {tx.user?.name ?? 'System'} · {dateTime(tx.createdAt)}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                        {money(tx.unitCost)}/unit
                      </p>
                    </div>
                  ))}
                </div>
                <Pagination
                  page={transactions.data.page}
                  pageSize={transactions.data.pageSize}
                  total={transactions.data.total}
                  onPage={setTxPage}
                />
              </>
            )}
          </>
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Adjust stock · ${selected.name}` : 'Adjust stock'}
        description={
          selected
            ? `Currently ${selected.quantity} unit(s) on hand · minimum ${selected.minStock}.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button loading={adjust.isPending} onClick={submitStock}>
              Record movement
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'IN', label: 'Stock in', icon: ArrowDownToLine },
              { value: 'OUT', label: 'Stock out', icon: ArrowUpFromLine },
              { value: 'ADJUST', label: 'Set count', icon: ArrowLeftRight },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value as string}
                type="button"
                onClick={() => setStockForm({ ...stockForm, type: value as string })}
                className={
                  stockForm.type === value
                    ? 'flex flex-col items-center gap-1.5 rounded-xl border border-indigo-400 bg-indigo-50 px-3 py-3 text-xs font-semibold text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-300'
                    : 'flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/[0.04]'
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={stockForm.type === 'ADJUST' ? 'Counted quantity' : 'Quantity'}
              required
              hint={stockForm.type === 'OUT' && selected ? `Available: ${selected.quantity}` : undefined}
            >
              <Input
                type="number"
                min={1}
                value={stockForm.quantity}
                onChange={(event) => setStockForm({ ...stockForm, quantity: event.target.value })}
              />
            </Field>
            <Field label="Unit cost" hint="Defaults to the recorded purchase price.">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={stockForm.unitCost}
                onChange={(event) => setStockForm({ ...stockForm, unitCost: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Reason / note" hint="Required context for audit: supplier, invoice number, damage, etc.">
            <Textarea
              value={stockForm.note}
              onChange={(event) => setStockForm({ ...stockForm, note: event.target.value })}
              placeholder="e.g. Received 10 units from supplier invoice #4821"
            />
          </Field>

          {formError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {formError}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
