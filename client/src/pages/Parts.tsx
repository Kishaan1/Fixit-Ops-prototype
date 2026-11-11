import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Edit3,
  ExternalLink,
  Filter,
  Globe,
  IndianRupee,
  Layers,
  Lightbulb,
  Package,
  PackagePlus,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tag,
  Truck,
  Wrench,
  X,
} from 'lucide-react'
import { api, errorMessage, qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { date, dateTime, money, number, relative } from '../lib/format'
import type { OnlinePartListing, Repair, SparePart, Supplier } from '../lib/types'
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
  cn,
} from '../components/ui'

const QUALITIES = ['ALL', 'OEM', 'Compatible', 'Refurbished', 'Used', 'Aftermarket']
const CATEGORIES = ['ALL', 'Display', 'Battery', 'Charging Port', 'Audio', 'Camera', 'Keyboard', 'Thermal', 'Consumable']

export default function Parts() {
  const { user } = useAuth()
  const { success, error } = useToast()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const initialQuery = searchParams.get('q') || ''
  const isOwner = user?.role === 'OWNER'

  const [activeTab, setActiveTab] = useState<'online' | 'inventory'>('online')
  const [search, setSearch] = useState(initialQuery)
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [sortBy, setSortBy] = useState<'price_asc' | 'price_desc' | 'delivery'>('price_asc')

  // Modals
  const [attachModalOpen, setAttachModalOpen] = useState(false)
  const [selectedPartForAttach, setSelectedPartForAttach] = useState<OnlinePartListing | null>(null)
  const [attachRepairId, setAttachRepairId] = useState('')
  const [attachSellingPrice, setAttachSellingPrice] = useState('')
  const [attachQuantity, setAttachQuantity] = useState('1')

  const [manualPriceModalOpen, setManualPriceModalOpen] = useState(false)
  const [manualProcurement, setManualProcurement] = useState<'online' | 'offline'>('online')
  const [manualForm, setManualForm] = useState({
    name: '',
    category: 'Display',
    brand: '',
    compatibleModels: '',
    quality: 'Compatible',
    supplierName: '',
    sourceUrl: '',
    unitPrice: '',
    unitCost: '',
    shopAddress: '',
    shopPhone: '',
    billNumber: '',
    warranty: '7 Days Testing Warranty',
  })

  // Online parts query
  const onlineParts = useQuery({
    queryKey: ['online-parts', search, selectedCategory],
    queryFn: () =>
      api.get<{
        items: OnlinePartListing[]
        total: number
        disclaimer: string
        providerConfigured: boolean
        externalLinks: { supplierName: string; searchUrl: string; note: string }[]
      }>(
        `/parts/search-online${qs({
          q: search,
          category: selectedCategory === 'ALL' ? '' : selectedCategory,
        })}`,
      ),
  })

  // Active repairs for attaching parts
  const activeRepairs = useQuery({
    queryKey: ['active-repairs-for-part'],
    queryFn: () =>
      api.get<{ items: Repair[] }>('/repairs?pageSize=50&status=DEVICE_RECEIVED,AWAITING_INSPECTION,ESTIMATE_PREPARED,AI_DIAGNOSIS_COMPLETED,REPAIR_IN_PROGRESS'),
    enabled: attachModalOpen,
  })

  // Local inventory query for secondary tab
  const [invPage, setInvPage] = useState(1)
  const [invQuery, setInvQuery] = useState('')
  const localParts = useQuery({
    queryKey: ['parts-local', invPage, invQuery],
    queryFn: () =>
      api.get<{ items: SparePart[]; total: number; page: number; pageSize: number }>(
        `/parts${qs({ page: invPage, pageSize: 20, q: invQuery })}`,
      ),
    enabled: activeTab === 'inventory',
  })

  // 1-Click Import into Shop Inventory Mutation
  const importToInventory = useMutation({
    mutationFn: (listing: OnlinePartListing) =>
      api.post('/parts/import-from-online', {
        name: listing.name,
        category: listing.category,
        brand: listing.brand,
        compatibleModels: listing.compatibleModels.join(', '),
        quality: listing.quality,
        supplierName: listing.supplierName,
        purchasePrice: listing.totalLandedPrice,
        sellingPrice: Math.round(listing.totalLandedPrice * 1.35),
        quantity: 1,
      }),
    onSuccess: (data: any) => {
      success('Part imported', data.message || 'Saved to shop inventory.')
      void queryClient.invalidateQueries({ queryKey: ['online-parts'] })
      void queryClient.invalidateQueries({ queryKey: ['parts-local'] })
      void queryClient.invalidateQueries({ queryKey: ['parts-catalog'] })
    },
    onError: (err) => error('Import failed', errorMessage(err)),
  })

  // Attach online part directly to an active repair ticket
  const attachToRepair = useMutation({
    mutationFn: async () => {
      if (!attachRepairId) throw new Error('Please select an active repair ticket.')
      if (!selectedPartForAttach) throw new Error('No part selected.')

      const unitCost = selectedPartForAttach.totalLandedPrice
      const unitPrice = attachSellingPrice ? Number(attachSellingPrice) : Math.round(unitCost * 1.35)
      const qty = Number(attachQuantity) || 1

      return api.post(`/repairs/${attachRepairId}/parts`, {
        name: selectedPartForAttach.name,
        quality: selectedPartForAttach.quality,
        supplierName: selectedPartForAttach.supplierName,
        sourceUrl: selectedPartForAttach.sourceUrl,
        priceSource: 'VERIFIED_LISTING',
        unitPrice,
        unitCost,
        quantity: qty,
        note: `Discovered online via ${selectedPartForAttach.supplierName}. Landed purchase cost: ${money(unitCost, true)}.`,
      })
    },
    onSuccess: () => {
      success('Part added to repair ticket', 'The customer quotation will use the selling price you entered.')
      setAttachModalOpen(false)
      setSelectedPartForAttach(null)
      setAttachRepairId('')
      setAttachSellingPrice('')
    },
    onError: (err) => error('Could not attach part', errorMessage(err)),
  })

  // Manual part entry mutation (Supports Online with URL and Offline Store without URL)
  const submitManualPart = useMutation({
    mutationFn: async () => {
      if (!manualForm.name.trim()) throw new Error('Please enter the part name.')

      if (manualProcurement === 'online') {
        if (!manualForm.sourceUrl.trim()) {
          throw new Error('Online purchasing requires a product URL link (e.g. https://...).')
        }
        try {
          new URL(manualForm.sourceUrl.trim())
        } catch {
          throw new Error('Please enter a valid URL starting with http:// or https://')
        }
      } else {
        if (!manualForm.supplierName.trim()) {
          throw new Error('Offline store purchasing requires the physical shop or store name.')
        }
      }

      const locationDetails = manualProcurement === 'offline'
        ? [
            manualForm.shopAddress.trim() ? `Shop: ${manualForm.supplierName.trim()} (${manualForm.shopAddress.trim()})` : `Shop: ${manualForm.supplierName.trim()}`,
            manualForm.billNumber.trim() ? `Bill: ${manualForm.billNumber.trim()}` : '',
            manualForm.warranty.trim() ? `Warranty: ${manualForm.warranty.trim()}` : '',
          ].filter(Boolean).join(' · ')
        : `Online: ${manualForm.supplierName.trim() || 'Distributor'}`

      return api.post('/parts', {
        name: manualForm.name.trim(),
        category: manualForm.category,
        brand: manualForm.brand.trim() || undefined,
        compatibleModels: manualForm.compatibleModels.trim() || '',
        quality: manualForm.quality,
        purchasePrice: Number(manualForm.unitCost) || 0,
        sellingPrice: Number(manualForm.unitPrice) || 0,
        quantity: 1,
        minStock: 2,
        location: locationDetails || 'Bench Stock',
      })
    },
    onSuccess: () => {
      success(
        manualProcurement === 'online' ? 'Online Part Recorded' : 'Offline Store Part Recorded',
        'Part successfully saved to shop inventory with complete procurement details.',
      )
      setManualPriceModalOpen(false)
      setManualForm({
        name: '',
        category: 'Display',
        brand: '',
        compatibleModels: '',
        quality: 'Compatible',
        supplierName: '',
        sourceUrl: '',
        unitPrice: '',
        unitCost: '',
        shopAddress: '',
        shopPhone: '',
        billNumber: '',
        warranty: '7 Days Testing Warranty',
      })
      void queryClient.invalidateQueries({ queryKey: ['parts-local'] })
    },
    onError: (err) => error('Error adding part', errorMessage(err)),
  })

  const openAttach = (listing: OnlinePartListing) => {
    setSelectedPartForAttach(listing)
    setAttachSellingPrice(String(Math.round(listing.totalLandedPrice * 1.35)))
    setAttachQuantity('1')
    setAttachModalOpen(true)
  }

  // Filtered & sorted online parts
  const sortedOnlineParts = useMemo(() => {
    const list = [...(onlineParts.data?.items ?? [])]
    if (sortBy === 'price_asc') {
      list.sort((a, b) => a.totalLandedPrice - b.totalLandedPrice)
    } else if (sortBy === 'price_desc') {
      list.sort((a, b) => b.totalLandedPrice - a.totalLandedPrice)
    } else if (sortBy === 'delivery') {
      list.sort((a, b) => a.estimatedDeliveryDays - b.estimatedDeliveryDays)
    }
    return list
  }, [onlineParts.data?.items, sortBy])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Parts & Sourcing"
        title="Parts & Sourcing"
        description="Manage shop inventory and record verified part purchases. Online discovery opens external supplier searches only — FIXIT AI does not fetch or estimate prices, stock or supplier data."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              icon={Plus}
              onClick={() => setManualPriceModalOpen(true)}
            >
              Manual Price Entry
            </Button>
            <Link to="/diagnostics">
              <Button icon={Wrench}>
                AI Diagnostics
              </Button>
            </Link>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-white/10">
        <button
          type="button"
          onClick={() => setActiveTab('online')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition cursor-pointer',
            activeTab === 'online'
              ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          <Compass className="h-4 w-4" /> Online Search &amp; Manual Entry
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('inventory')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition cursor-pointer',
            activeTab === 'inventory'
              ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          <Boxes className="h-4 w-4" /> Shop Local Inventory
        </button>
      </div>

      {activeTab === 'online' ? (
        <div className="space-y-6">
          {/* Search and Filters Bar */}
          <Card>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[260px]">
                  <Search className="absolute top-1/2 left-3 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by device model (e.g. Galaxy A54, iPhone 13, Redmi Note 10 Pro, Inspiron 15) or component..."
                    className="pl-12"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="w-44">
                  <Select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        Category: {c}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              {/* Bottom Quick filters */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-4">
                  <span>No live price provider is connected — nothing below is a quoted price</span>
                </div>

                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  <span>External links only • Verify every listing yourself • Manual entry supported</span>
                </div>
              </div>
            </div>
          </Card>

          {/* No live provider: show honest external search links instead of invented cards */}
          {(onlineParts.data?.externalLinks.length ?? 0) > 0 && (
            <Card>
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      No marketplace API is configured
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      These links open an external search in a new tab. FIXIT AI does not fetch,
                      estimate or verify the prices, stock or supplier shown there.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {onlineParts.data?.externalLinks.map((link) => (
                    <a
                      key={link.supplierName}
                      href={link.searchUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
                    >
                      {link.supplierName}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">
                  When you buy a part, record the supplier, real price and warranty with Manual Price
                  Entry so inventory, quotes and profit use actual costs.
                </p>
              </div>
            </Card>
          )}

          {/* Results Grid */}
          {onlineParts.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-64 rounded-2xl bg-slate-100 dark:bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : sortedOnlineParts.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                icon={PackageSearch}
                title="No spare parts match your query"
                description={`No live supplier prices are available for "${search}". FIXIT AI does not invent listings. Open a search below, verify the part and price yourself, or use Manual Price Entry to record the real purchase cost.`}
                action={
                  <Button
                    variant="outline"
                    icon={Plus}
                    onClick={() => setManualPriceModalOpen(true)}
                  >
                    Enter Manual Part Quote
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sortedOnlineParts.map((listing) => (
                <Card key={listing.id} className="flex flex-col justify-between hover:border-slate-300 transition">
                  <div className="space-y-3">
                    {/* Header Badges */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          tone={
                            listing.quality === 'OEM'
                              ? 'indigo'
                              : listing.quality === 'Compatible'
                                ? 'cyan'
                                : listing.quality === 'Refurbished'
                                  ? 'violet'
                                  : 'slate'
                          }
                        >
                          {listing.quality}
                        </Badge>
                        <Badge tone="slate">{listing.category}</Badge>
                      </div>

                      <Badge
                        tone={
                          listing.availability === 'IN_STOCK'
                            ? 'emerald'
                            : listing.availability === 'LOW_STOCK'
                              ? 'amber'
                              : 'slate'
                        }
                      >
                        {listing.availability.replace('_', ' ')}
                      </Badge>
                    </div>

                    {/* Part Title */}
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-white line-clamp-2 text-sm leading-snug">
                        {listing.name}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Compatible with: <span className="text-slate-700 dark:text-slate-300 font-medium">{listing.compatibleModels.slice(0, 3).join(', ')}</span>
                      </p>
                    </div>

                    {/* Supplier Info */}
                    <div className="rounded-xl bg-slate-50 p-2.5 text-xs dark:bg-white/[0.03] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Supplier:</span>
                        <a
                          href={listing.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400 inline-flex items-center gap-1"
                        >
                          {listing.supplierName} <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <div className="flex items-center justify-between text-slate-500">
                        <span>Delivery Est.:</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {listing.estimatedDeliveryDays} business days ({listing.supplierCountry})
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-500">
                        <span>Warranty:</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">{listing.warranty}</span>
                      </div>
                    </div>

                    {/* Shop Stock Notice if already available in shop */}
                    {listing.inShopInventory && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-2 text-xs text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 flex items-center justify-between">
                        <span className="flex items-center gap-1 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> In Shop Stock:
                        </span>
                        <span className="font-bold">{listing.shopStockQuantity} units in inventory</span>
                      </div>
                    )}
                  </div>

                  {/* Pricing and Action Footer */}
                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/5 space-y-3">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-xs text-slate-400">Base Price:</span>
                        <p className="font-semibold text-slate-800 dark:text-slate-200">
                          {money(listing.listedPrice, true)}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-400">Landed (incl. ship):</span>
                        <p className="text-lg font-bold text-slate-900 dark:text-white">
                          {money(listing.totalLandedPrice, true)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        icon={PackagePlus}
                        onClick={() => importToInventory.mutate(listing)}
                        loading={importToInventory.isPending}
                        title="Import into shop inventory catalog"
                      >
                        To Inventory
                      </Button>
                      <Button
                        size="sm"
                        icon={Wrench}
                        onClick={() => openAttach(listing)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                      >
                        Add to Repair
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Secondary Tab: Local Inventory Management */
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute top-1/2 left-3 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={invQuery}
                  onChange={(e) => setInvQuery(e.target.value)}
                  placeholder="Search internal inventory by SKU, name, or compatible model..."
                  className="pl-12"
                />
              </div>
              <Link to="/inventory">
                <Button variant="outline" icon={Boxes}>
                  Full Inventory Console
                </Button>
              </Link>
            </div>
          </Card>

          <Card padded={false}>
            {localParts.isLoading ? (
              <SkeletonRows rows={5} />
            ) : localParts.data?.items.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No local spare parts found"
                description="Record a part you sourced online, or add a newly arrived spare part to inventory."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.02]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">SKU & Part</th>
                      <th className="px-4 py-3 font-semibold">Quality</th>
                      <th className="px-4 py-3 font-semibold">Compatibility</th>
                      <th className="px-4 py-3 text-right font-semibold">Stock</th>
                      {isOwner ? (
                        <th className="px-4 py-3 text-right font-semibold">Cost</th>
                      ) : null}
                      <th className="px-4 py-3 text-right font-semibold">Retail Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {localParts.data?.items.map((part) => (
                      <tr key={part.id}>
                        <td className="px-5 py-3">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{part.name}</p>
                          <p className="font-mono text-xs text-slate-400">{part.sku}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone="indigo">{part.quality}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                          {part.compatibleModels || 'All models'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge tone={part.quantity <= part.minStock ? 'amber' : 'emerald'}>
                            {part.quantity} in stock
                          </Badge>
                        </td>
                        {isOwner ? (
                          <td className="px-4 py-3 text-right text-slate-500">
                            {money(part.purchasePrice, true)}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-white">
                          {money(part.sellingPrice, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Attach Part to Active Repair Modal */}
      {selectedPartForAttach && (
        <Modal
          open={attachModalOpen}
          onClose={() => setAttachModalOpen(false)}
          title="Add Part to Repair Ticket"
          description={`Attaching ${selectedPartForAttach.name} to a repair ticket.`}
          footer={
            <div className="flex w-full items-center justify-between">
              <Button variant="ghost" onClick={() => setAttachModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => attachToRepair.mutate()}
                loading={attachToRepair.isPending}
                disabled={!attachRepairId}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
              >
                Add to Quotation
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3.5 text-xs dark:bg-white/[0.03] space-y-1.5 border border-slate-200/80 dark:border-white/10">
              <div className="flex justify-between gap-3">
                <span className="shrink-0 text-slate-500">Supplier:</span>
                <span className="min-w-0 break-words text-right font-semibold text-slate-800 dark:text-slate-200">
                  {selectedPartForAttach.supplierName} ({selectedPartForAttach.quality})
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="shrink-0 text-slate-500">Recorded Landed Cost:</span>
                <span className="min-w-0 break-words text-right font-bold text-slate-900 dark:text-white">
                  {money(selectedPartForAttach.totalLandedPrice, true)}
                </span>
              </div>
            </div>

            <Field label="Select target repair ticket" required>
              <Select
                value={attachRepairId}
                onChange={(e) => setAttachRepairId(e.target.value)}
              >
                <option value="">-- Choose active repair ticket --</option>
                {activeRepairs.data?.items.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} · {r.device.brand} {r.device.model} ({r.customer.name})
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity" required>
                <Input
                  type="number"
                  min="1"
                  value={attachQuantity}
                  onChange={(e) => setAttachQuantity(e.target.value)}
                />
              </Field>

              <Field label="Selling price to customer (₹)" required hint="Includes markup & taxes.">
                <Input
                  type="number"
                  value={attachSellingPrice}
                  onChange={(e) => setAttachSellingPrice(e.target.value)}
                />
              </Field>
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>
                The part cost and customer price you enter here are recorded on the repair. Profit is
                calculated server-side from those figures, and the customer report shows only the price
                they pay.
              </span>
            </p>
          </div>
        </Modal>
      )}

      {/* Manual Price Entry Modal (Online vs Offline) */}
      <Modal
        open={manualPriceModalOpen}
        onClose={() => setManualPriceModalOpen(false)}
        title="Add Custom Spare Part"
        description="Record a spare part purchased online or from a local offline store into inventory."
        size="lg"
        footer={
          <div className="flex w-full items-center justify-between">
            <Button variant="ghost" onClick={() => setManualPriceModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => submitManualPart.mutate()}
              loading={submitManualPart.isPending}
              disabled={!manualForm.name.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
            >
              Save Spare Part
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Procurement Mode Selector */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setManualProcurement('online')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer',
                manualProcurement === 'online'
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400',
              )}
            >
              <Globe className="h-3.5 w-3.5 text-indigo-500" />
              Online Purchasing (URL Required)
            </button>
            <button
              type="button"
              onClick={() => setManualProcurement('offline')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer',
                manualProcurement === 'offline'
                  ? 'border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-300'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400',
              )}
            >
              <Store className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Offline Store Purchasing (No URL Needed)
            </button>
          </div>

          {manualProcurement === 'online' ? (
            <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-xs text-indigo-900 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Globe className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <span>
                <strong>Online Purchasing:</strong> Requires a product URL link (e.g. https://...) for source verification and customer transparency.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <Store className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Offline Store Purchasing:</strong> For parts purchased physically from local market stores or electronics wholesale markets. <em>No URL link needed.</em>
              </span>
            </div>
          )}

          <Field label="Part title" required>
            <Input
              value={manualForm.name}
              onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
              placeholder="e.g. Realme 8 Pro Super AMOLED Display Assembly"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" required>
              <Select
                value={manualForm.category}
                onChange={(e) => setManualForm({ ...manualForm, category: e.target.value })}
              >
                {CATEGORIES.filter((c) => c !== 'ALL').map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Quality grade">
              <Select
                value={manualForm.quality}
                onChange={(e) => setManualForm({ ...manualForm, quality: e.target.value })}
              >
                {QUALITIES.filter((q) => q !== 'ALL').map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Compatible device models">
            <Input
              value={manualForm.compatibleModels}
              onChange={(e) => setManualForm({ ...manualForm, compatibleModels: e.target.value })}
              placeholder="e.g. Realme 8 Pro, RMX3081"
            />
          </Field>

          {manualProcurement === 'online' ? (
            /* Online Purchasing Fields: Requires URL Link */
            <div className="space-y-3">
              <Field label="Online supplier / platform name">
                <Input
                  value={manualForm.supplierName}
                  onChange={(e) => setManualForm({ ...manualForm, supplierName: e.target.value })}
                  placeholder="e.g. Local parts market, iFixit, Amazon, supplier invoice"
                />
              </Field>

              <Field
                label="Product URL link (Required for online purchasing)"
                required
                hint="Must start with https:// or http://"
              >
                <div className="relative">
                  <Globe className="absolute top-1/2 left-3 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={manualForm.sourceUrl}
                    onChange={(e) => setManualForm({ ...manualForm, sourceUrl: e.target.value })}
                    placeholder="https://www.mobilessentrix.com/item/..."
                    className="pl-12"
                  />
                </div>
              </Field>
            </div>
          ) : (
            /* Offline Store Fields: Requires Shop Name, NO URL */
            <div className="space-y-3">
              <Field label="Local shop / store name (Required)" required>
                <div className="relative">
                  <Building2 className="absolute top-1/2 left-3 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={manualForm.supplierName}
                    onChange={(e) => setManualForm({ ...manualForm, supplierName: e.target.value })}
                    placeholder="e.g. City Mobile Spare Hub / National Electronics"
                    className="pl-12"
                  />
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Shop address / market location">
                  <Input
                    value={manualForm.shopAddress}
                    onChange={(e) => setManualForm({ ...manualForm, shopAddress: e.target.value })}
                    placeholder="e.g. Shop 14, Electronics Market / Nehru Place"
                  />
                </Field>
                <Field label="Bill / Receipt / Cash memo #">
                  <Input
                    value={manualForm.billNumber}
                    onChange={(e) => setManualForm({ ...manualForm, billNumber: e.target.value })}
                    placeholder="e.g. INV-9821 / Cash Slip #42"
                  />
                </Field>
              </div>

              <Field label="Warranty / Return terms">
                <Input
                  value={manualForm.warranty}
                  onChange={(e) => setManualForm({ ...manualForm, warranty: e.target.value })}
                  placeholder="e.g. 7 Days Testing Warranty"
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Purchase / Cost price (₹)" required hint="Price paid">
              <Input
                type="number"
                value={manualForm.unitCost}
                onChange={(e) => setManualForm({ ...manualForm, unitCost: e.target.value })}
                placeholder="Actual purchase cost"
              />
            </Field>

            <Field label="Customer selling price (₹)" required hint="Price billed">
              <Input
                type="number"
                value={manualForm.unitPrice}
                onChange={(e) => setManualForm({ ...manualForm, unitPrice: e.target.value })}
                placeholder="Price quoted to customer"
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}
