import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { api, errorMessage, qs } from '../lib/api'
import { useToast } from '../lib/toast'
import { date, money, number } from '../lib/format'
import type { CustomerListItem } from '../lib/types'
import {
  Avatar,
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
  SkeletonRows,
  Textarea,
} from '../components/ui'

const emptyForm = { name: '', phone: '', email: '', address: '', notes: '' }

export default function Customers() {
  const { success, error } = useToast()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)

  const customers = useQuery({
    queryKey: ['customers', page, query],
    queryFn: () =>
      api.get<{ items: CustomerListItem[]; total: number; page: number; pageSize: number }>(
        `/customers${qs({ page, pageSize: 20, q: query })}`,
      ),
  })

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ customer: { id: string; name: string } }>('/customers', body),
    onSuccess: (result) => {
      success('Customer added', `${result.customer.name} is ready for a repair.`)
      setOpen(false)
      setForm(emptyForm)
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const submit = () => {
    setFormError(null)
    if (form.name.trim().length < 2) {
      setFormError('Enter the customer name.')
      return
    }
    if (form.phone.trim().length < 7) {
      setFormError('Enter a valid phone number.')
      return
    }
    create.mutate({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Relationships"
        title="Customers"
        description="Every customer, their devices and their service history in one place. Recognise repeat visitors and keep contact details accurate."
        actions={
          <Button icon={UserPlus} onClick={() => setOpen(true)}>
            Add customer
          </Button>
        }
      />

      <Card padded={false}>
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
              placeholder="Search by name, phone or email…"
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

        {customers.isLoading ? (
          <SkeletonRows rows={6} />
        ) : customers.isError ? (
          <ErrorState
            message="The customer list could not be loaded."
            onRetry={() => customers.refetch()}
          />
        ) : !customers.data?.items.length ? (
          <EmptyState
            icon={Users}
            title={query ? 'No customers match this search' : 'No customers yet'}
            description={
              query
                ? 'Try a different name, phone number or email.'
                : 'Add your first customer, or create one automatically during repair intake.'
            }
            action={
              query ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setQuery('')
                  }}
                >
                  Clear search
                </Button>
              ) : (
                <Button icon={UserPlus} onClick={() => setOpen(true)}>
                  Add customer
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="border-t border-slate-200/80 px-4 py-2 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {number(customers.data.total)}
              </span>{' '}
              customer{customers.data.total === 1 ? '' : 's'}
              {query ? ' matching your search' : ''}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-y border-slate-200/80 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold">Contact</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Visits</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Lifetime spend</th>
                    <th className="px-4 py-2.5 font-semibold">Last service</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {customers.data.items.map((customer) => (
                    <tr
                      key={customer.id}
                      className="transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3.5">
                        <Link to={`/customers/${customer.id}`} className="flex items-center gap-3">
                          <Avatar name={customer.name} />
                          <span>
                            <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                              {customer.name}
                              {customer.isDemo ? <Badge tone="amber">Demo</Badge> : null}
                              {customer.returning ? <Badge tone="emerald">Returning</Badge> : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                              {customer.deviceCount} device{customer.deviceCount === 1 ? '' : 's'} on file
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                          <Phone className="h-3 w-3 text-slate-400" /> {customer.phone}
                        </p>
                        {customer.email ? (
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <Mail className="h-3 w-3 text-slate-400" /> {customer.email}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <p className="font-semibold text-slate-800 dark:text-slate-200">
                          {customer.visits}
                        </p>
                        <p className="text-[11px] text-slate-400">{customer.completed} completed</p>
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-slate-800 dark:text-slate-200">
                        {money(customer.totalSpent)}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                        {date(customer.lastServiceDate)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link to={`/customers/${customer.id}`}>
                          <ChevronRight className="ml-auto h-4 w-4 text-slate-300 dark:text-slate-600" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 lg:hidden dark:divide-white/5">
              {customers.data.items.map((customer) => (
                <Link
                  key={customer.id}
                  to={`/customers/${customer.id}`}
                  className="block px-4 py-4 transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={customer.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {customer.name}
                        </p>
                        {customer.returning ? <Badge tone="emerald">Returning</Badge> : null}
                        {customer.isDemo ? <Badge tone="amber">Demo</Badge> : null}
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <Phone className="h-3 w-3" /> {customer.phone}
                      </p>
                      {customer.address ? (
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
                          <MapPin className="h-3 w-3 shrink-0" /> {customer.address}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span>{customer.visits} visits</span>
                        <span>{money(customer.totalSpent)} lifetime</span>
                        <span>Last {date(customer.lastServiceDate)}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            <Pagination
              page={customers.data.page}
              pageSize={customers.data.pageSize}
              total={customers.data.total}
              onPage={setPage}
            />
          </>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a customer"
        description="Phone numbers are unique, so returning customers stay linked to their history."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button icon={Plus} loading={create.isPending} onClick={submit}>
              Add customer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. Ananya Sharma"
              />
            </Field>
            <Field label="Phone" required>
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="10-digit mobile"
                inputMode="tel"
              />
            </Field>
          </div>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="Optional"
            />
          </Field>
          <Field label="Address">
            <Input
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
              placeholder="Optional"
            />
          </Field>
          <Field label="Notes" hint="Preferences, warranty reminders or anything the team should know.">
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Optional"
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
