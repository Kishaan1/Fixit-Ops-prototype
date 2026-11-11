import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Phone,
  Printer,
  ShieldCheck,
  Sparkles,
  Star,
  Wrench,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useToast } from '../lib/toast'
import { date, dateTime, humanize, money } from '../lib/format'
import type { PublicReport as PublicReportType } from '../lib/types'
import { Badge, Button, Card, ErrorState, Field, Textarea } from '../components/ui'

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.title ?? record.name ?? record.label ?? '')
  }
  return ''
}

function sourceLabel(value: unknown): { title: string; url?: string } {
  if (typeof value === 'string') return { title: value }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return {
      title: String(record.title ?? record.name ?? record.label ?? 'Reference'),
      url: typeof record.url === 'string' ? record.url : undefined,
    }
  }
  return { title: 'Reference' }
}

export default function PublicReport() {
  const { token = '' } = useParams()
  const { success, error } = useToast()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const report = useQuery({
    queryKey: ['public-report', token],
    queryFn: () => api.get<PublicReportType>(`/public/reports/${token}`),
    enabled: Boolean(token),
    retry: false,
  })

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('print') === '1' && report.data) {
      const timer = window.setTimeout(() => window.print(), 400)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [report.data])

  const feedback = useMutation({
    mutationFn: () =>
      api.post(`/public/reports/${token}/feedback`, { rating, comment: comment.trim() }),
    onSuccess: () => {
      setSubmitted(true)
      success('Thank you', 'Your feedback helps the shop improve.')
      void report.refetch()
    },
    onError: (err) => error('Could not send feedback', errorMessage(err)),
  })

  if (report.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <span className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-500" /> Opening your service report…
        </span>
      </div>
    )
  }

  if (report.isError || !report.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <Card className="w-full max-w-md">
          <ErrorState
            message={
              report.error
                ? errorMessage(report.error)
                : 'This report link is invalid or has been replaced. Ask the shop for a fresh QR code.'
            }
          />
        </Card>
      </div>
    )
  }

  const { snapshot, feedback: existingFeedback } = report.data
  const { shop, repair, customer, device, diagnosis, parts, charges, payments } = snapshot
  const balance = Math.max(0, charges.customerTotal - charges.paidTotal)
  const showFeedback = existingFeedback ?? (submitted ? { rating, comment, createdAt: new Date().toISOString() } : null)

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4">
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5" /> Private link — share only with the customer.
        </p>
        <Button size="sm" variant="outline" icon={Printer} onClick={() => window.print()}>
          Print / save as PDF
        </Button>
      </div>

      <main className="print-page mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <header className="border-b border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-6 text-white sm:px-8 print:bg-white print:text-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300 print:text-indigo-600">
                Service report
              </p>
              <h1 className="mt-1 break-words text-2xl font-bold tracking-tight">{shop.name}</h1>
              <div className="mt-2 space-y-1 text-xs text-slate-300 print:text-slate-600">
                {shop.address ? (
                  <p className="flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {shop.address}
                  </p>
                ) : null}
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  {shop.phone ? (
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3" /> {shop.phone}
                    </span>
                  ) : null}
                  {shop.email ? <span>{shop.email}</span> : null}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-3.5 text-right">
              <div className="hidden sm:block rounded-xl bg-white p-1.5 shadow-md print:block print:border print:border-slate-300">
                <img
                  src={`/api/public/reports/${token}/qr?size=160`}
                  alt="QR verification code"
                  className="h-16 w-16"
                />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-slate-400 print:text-slate-500">
                  Repair code
                </p>
                <p className="break-all font-mono text-lg font-bold">{repair.code}</p>
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold print:bg-slate-100 print:text-slate-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                  {repair.statusLabel}
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="space-y-6 px-6 py-6 sm:px-8">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Customer</p>
              <p className="mt-1 font-semibold text-slate-900">{customer.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">Contact details are held privately by the shop.</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Device</p>
              <p className="mt-1 font-semibold text-slate-900">
                {device.brand} {device.model}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {device.category}
                {repair.technicianName ? ` · handled by ${repair.technicianName}` : ''}
              </p>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {[
              ['Received', date(repair.createdAt)],
              ['Completed', repair.completedAt ? date(repair.completedAt) : 'In progress'],
              ['Delivered', repair.deliveredAt ? date(repair.deliveredAt) : 'Not yet'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3.5 py-3">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <Clock className="h-3 w-3" /> {label}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-800">{value}</p>
              </div>
            ))}
          </section>

          <section>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Wrench className="h-4 w-4 text-indigo-500" /> Reported problem
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{repair.problem}</p>
            {repair.confirmedFault ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Confirmed fault
                </p>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{repair.confirmedFault}</p>
              </div>
            ) : null}
            {repair.repairProcedure ? (
              <div className="mt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Work performed
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                  {repair.repairProcedure}
                </p>
              </div>
            ) : null}
            {repair.testingResults ? (
              <div className="mt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Testing results
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                  {repair.testingResults}
                </p>
              </div>
            ) : null}
          </section>

          {diagnosis.length ? (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Sparkles className="h-4 w-4 text-violet-500" /> Diagnostic notes
              </h2>
              <div className="mt-2 space-y-2">
                {diagnosis.map((entry, index) => {
                  const sources = entry.sources.map(sourceLabel).filter((source) => source.title)
                  return (
                    <div key={`${entry.createdAt}-${index}`} className="rounded-xl border border-slate-200 p-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={entry.mode === 'AI' ? 'violet' : 'slate'}>
                          {entry.mode === 'AI' ? 'AI-assisted' : 'Manual checklist'}
                        </Badge>
                        {entry.confidence !== null ? (
                          <span className="text-[11px] text-slate-400">{entry.confidence}% confidence</span>
                        ) : null}
                        <span className="text-[11px] text-slate-400">{date(entry.createdAt)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                        {entry.summary}
                      </p>
                      {entry.causes.length ? (
                        <ul className="mt-2 space-y-1 text-xs text-slate-500">
                          {entry.causes.map((cause, causeIndex) => (
                            <li key={causeIndex} className="flex gap-1.5">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                              {asText(cause)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {sources.length ? (
                        <p className="mt-2 text-[11px] text-slate-400">
                          References:{' '}
                          {sources.map((source, sourceIndex) => (
                            <span key={sourceIndex}>
                              {source.url ? (
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="text-indigo-600 hover:underline"
                                >
                                  {source.title}
                                </a>
                              ) : (
                                source.title
                              )}
                              {sourceIndex < sources.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                AI-assisted notes are suggestions reviewed by the technician. They are not a guarantee of
                future performance.
              </p>
            </section>
          ) : null}

          <section>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <BadgeCheck className="h-4 w-4 text-emerald-500" /> Parts replaced
            </h2>
            {parts.length ? (
              <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3.5 py-2 font-semibold">Part</th>
                      <th className="px-3.5 py-2 font-semibold">Quality</th>
                      <th className="px-3.5 py-2 text-center font-semibold">Qty</th>
                      <th className="px-3.5 py-2 text-right font-semibold">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parts.map((part, index) => (
                      <tr key={`${part.name}-${index}`}>
                        <td className="break-words px-3.5 py-2.5 text-slate-700">{part.name}</td>
                        <td className="break-words px-3.5 py-2.5 text-xs text-slate-500">{part.quality}</td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-center text-slate-600">{part.quantity}</td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-medium text-slate-800">
                          {money(part.unitPrice * part.quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No parts were replaced on this repair.</p>
            )}
          </section>

          <section>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CheckCircle2 className="h-4 w-4 text-indigo-500" /> Charges
            </h2>
            <div className="mt-2 rounded-xl border border-slate-200">
              <div className="space-y-1.5 px-3.5 py-3 text-sm">
                <Row label="Parts" value={money(charges.partsTotal)} />
                <Row label="Labour" value={money(charges.labourCharge)} />
                {charges.otherExpenses ? <Row label="Other charges" value={money(charges.otherExpenses)} /> : null}
                {charges.discount ? <Row label="Discount" value={`−${money(charges.discount)}`} /> : null}
                {charges.taxAmount ? <Row label="Tax" value={money(charges.taxAmount)} /> : null}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
                  <span>Total</span>
                  <span>{money(charges.customerTotal)}</span>
                </div>
                <Row label="Paid" value={money(charges.paidTotal)} />
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span className={balance > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                    {balance > 0 ? 'Balance due' : 'Fully paid'}
                  </span>
                  <span className={balance > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                    {money(balance)}
                  </span>
                </div>
              </div>
              {payments.length ? (
                <div className="border-t border-slate-200 px-3.5 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Payments</p>
                  <div className="mt-1 space-y-1">
                    {payments.map((payment, index) => (
                      <div key={index} className="flex items-center justify-between text-xs text-slate-500">
                        <span>
                          {humanize(payment.method)} · {date(payment.paidAt)}
                        </span>
                        <span className="font-medium text-slate-700">{money(payment.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {repair.warranty ? (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <ShieldCheck className="h-4 w-4" /> Warranty
              </h2>
              <p className="mt-1.5 text-sm text-emerald-900">
                {repair.warranty.days} days, valid until {date(repair.warranty.endDate)}.
              </p>
              {repair.warranty.terms ? (
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-emerald-800/80">
                  {repair.warranty.terms}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="no-print border-t border-slate-200 pt-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Star className="h-4 w-4 text-amber-500" /> How did we do?
            </h2>
            {showFeedback ? (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex items-center gap-1 text-amber-500">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star
                      key={index}
                      className={`h-4 w-4 ${index < showFeedback.rating ? 'fill-current' : 'text-slate-300'}`}
                    />
                  ))}
                  <span className="ml-1 text-xs font-medium text-slate-600">
                    {showFeedback.rating}/5
                  </span>
                </div>
                {showFeedback.comment ? (
                  <p className="mt-2 text-sm text-slate-600">{showFeedback.comment}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-slate-400">
                  Recorded {dateTime(showFeedback.createdAt)}. You can update your feedback below.
                </p>
              </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    className="rounded-md p-0.5 transition hover:scale-110"
                    aria-label={`${value} star${value === 1 ? '' : 's'}`}
                  >
                    <Star
                      className={`h-7 w-7 ${
                        value <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                      }`}
                    />
                  </button>
                ))}
                <span className="ml-2 text-xs text-slate-500">
                  {rating ? `${rating} of 5` : 'Tap to rate'}
                </span>
              </div>
              <Field label="Comments (optional)" className="mt-3">
                <Textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Tell the shop what went well or what could be better."
                  maxLength={800}
                />
              </Field>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  Feedback is shared with the shop only.
                </p>
                <Button
                  icon={Star}
                  loading={feedback.isPending}
                  disabled={rating === 0}
                  onClick={() => feedback.mutate()}
                >
                  Send feedback
                </Button>
              </div>
            </div>
          </section>

          <footer className="border-t border-slate-200 pt-4 text-center text-[10px] leading-relaxed text-slate-400">
            <p>
              This report was generated by FIXIT AI on {dateTime(snapshot.generatedAt)}. It reflects the
              repair record at that time; live status may have changed since.
            </p>
            <p className="mt-1">
              Internal costs, margins, customer contact details and device identifiers are never included in
              this public report.
            </p>
          </footer>
        </div>
      </main>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-600">
      <span>{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  )
}
