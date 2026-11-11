/**
 * Spare-parts discovery without a marketplace contract.
 *
 * FIXIT AI does not have credentials for a live price API, so this module must
 * never invent a price, stock level, supplier or "last checked" timestamp.
 * It only builds external search links for the technician to verify by hand,
 * or an empty list that the UI can replace with manual entry.
 */
export interface ExternalPartSearchLink {
  supplierName: string
  searchUrl: string
  note: string
}

export interface OnlinePartListing {
  id: string
  name: string
  category: string
  brand: string
  compatibleModels: string[]
  quality: string
  supplierName: string
  supplierWebsite: string
  supplierCountry: string
  listedPrice: number
  shippingCharge: number
  totalLandedPrice: number
  currency: string
  availability: string
  warranty: string
  sourceUrl: string
  isVerified: boolean
  lastCheckedAt: string
  estimatedDeliveryDays: number
  inShopInventory?: boolean
  shopStockQuantity?: number
  shopSellingPrice?: number
}

export function buildExternalPartSearchLinks(params: {
  query?: string
  brand?: string
  model?: string
  category?: string
}): ExternalPartSearchLink[] {
  const terms = [params.brand, params.model, params.category, params.query]
    .map((value) => (value || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!terms) return []

  const encoded = encodeURIComponent(terms)
  const note = 'Opens an external search. FIXIT AI does not fetch or verify these prices.'

  return [
    {
      supplierName: 'Google Shopping',
      searchUrl: `https://www.google.com/search?tbm=shop&q=${encoded}`,
      note,
    },
    {
      supplierName: 'iFixit',
      searchUrl: `https://www.ifixit.com/Search?query=${encoded}`,
      note,
    },
    {
      supplierName: 'eBay',
      searchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encoded}`,
      note,
    },
    {
      supplierName: 'Amazon India',
      searchUrl: `https://www.amazon.in/s?k=${encoded}`,
      note,
    },
    {
      supplierName: 'IndiaMART',
      searchUrl: `https://dir.indiamart.com/search.mp?ss=${encoded}`,
      note,
    },
  ]
}
