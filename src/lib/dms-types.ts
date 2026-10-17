// Shared types for DMS frontend

export type Role = 'MEGA_ADMIN' | 'DISTRIBUTOR' | 'SALESMAN'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  phone?: string | null
  region?: string | null
  // Subscription state (DISTRIBUTOR) — Mega Admin console se control hota hai
  isActive?: boolean
  subscriptionExpiry?: string | null
  profile?: {
    id: string
    businessName: string
    city: string
    region: string
    tier: string
    creditLimit: number
  } | null
}

export interface DashboardData {
  kpis: {
    todaySales: number
    todayOrders: number
    monthSales: number
    activeOutlets: number
    pendingOrders: number
    pendingReturns: number
    pendingClaims: number
    stockValue: number
    lowStockItems: number
    salesmenOnField: number
  }
  salesTrend: { date: string; sales: number; orders: number }[]
  topProducts: { name: string; qty: number; value: number }[]
  channelMix: { channel: string; value: number }[]
  distributorPerf: { name: string; orders: number; sales: number; collection: number }[]
  lowStock: { product: string; warehouse: string; qty: number; unitsPerCarton: number }[]
  pjpToday: { salesman: string; total: number; completed: number; status: string }[]
}

/** Task 57: OrderItem.schemeStack Json row — booking par freeze hui har scheme ki
 * apni contribution (amount = money schemes ka Rs, freeQtyGiven = BxGy ke free pcs).
 * Purani bookings par rows in fields ke baghair ho saktin hain (optional). */
export interface SchemeStackRow {
  id: string
  name?: string
  type: string // BUY_X_GET_Y | PERCENT_DISCOUNT | FLAT_DISCOUNT
  value: number
  buyQty: number
  freeQty: number
  amount?: number
  freeQtyGiven?: number
}

export interface OrderItemDTO {
  id: string
  productId: string
  productName: string
  sku: string
  unitsPerCarton?: number
  boxesPerCarton?: number
  pcsPerBox?: number
  consumerPrice?: number | null
  qty: number // PIECES
  freeQty: number // PIECES
  rate: number // per PIECE
  discount: number
  lineTotal: number
  schemeName?: string | null
  /** Task 56/57: booking par freeze hua poora scheme stack (per-scheme amounts Task 57) */
  schemeStack?: SchemeStackRow[] | null
  /** Task 45: booking waqt ke GST + Trade Order snapshots */
  tradeOfferAmt?: number
  gstRate?: number | null
  gstAmt?: number
  /** Task 52: manual discount ka is line ka hissa (Pass On = discount + manualShare) */
  manualShare?: number
}

export interface OrderDTO {
  id: string
  orderNo: string
  outletName: string
  outletCode: string
  channel: string
  salesmanName?: string | null
  distributorName: string
  status: string
  subtotal: number
  schemeDiscount: number
  /** Manual order-level discount (order booking par % ya flat Rs) */
  manualDiscount?: number
  manualDiscType?: string | null
  manualDiscValue?: number | null
  total: number
  /** Task 45: GST + Trade Order totals — grand payable = total − TO + GST + advTax */
  tradeOfferTotal?: number
  gstTotal?: number
  payable?: number
  /** Advance Tax snapshot — booking waqt shop ke filer status se (bill par add) */
  filerStatus?: string | null
  advanceTaxRate?: number | null
  advanceTax?: number
  orderDate: string
  itemCount: number
  /** Salesflo-style "Quantity in Cases" — Σ(qty pcs / units-per-carton), 4dp */
  totalCases?: number
  /** Σ scheme free pcs (display) */
  totalFreePcs?: number
  /** Task 82: out-of-route order (unplanned button se bana) + GPS evidence */
  unplanned?: boolean
  orderLat?: number | null
  orderLng?: number | null
  items?: OrderItemDTO[]
}

export interface CompanyDTO {
  id: string
  name: string
  shortCode: string | null
  productCount?: number
  salesmanCount?: number
}

// Task 53: per-tenant product categories (naya category banane ka option)
export interface CategoryDTO {
  id: string
  name: string
  productCount?: number
}

// ---- Procurement: companies + purchase invoices + payable ledger ----
export interface CompanyFullDTO extends CompanyDTO {
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  logo: string | null
  invoiceCount?: number
  balance: number
  purchaseTotal?: number
}

export interface PurchaseItemDTO {
  id: string
  productId: string
  sku: string
  productName: string
  batchNo: string
  expDate: string | null
  cartons: number
  unitsPerCarton: number
  units: number
  purchasePrice: number
  lineTotal: number
  /** Task 43: per-item % discount (invoice ka Pass On) snapshot */
  discountPct: number
  discountAmt: number
  /** Task 44: real invoice tax chain snapshot */
  netAmount: number
  gstRate: number
  salesTax: number
  furtherTaxPct: number
  furtherTax: number
  totalTax: number
  tradeOfferAmt: number
  advanceTax: number
  amountInclusive: number
}

export interface PurchaseInvoiceDTO {
  id: string
  invoiceNo: string
  supplierInvoiceNo: string | null
  companyId: string
  companyName: string
  companyShortCode: string | null
  companyLogo: string | null
  date: string
  subtotal: number
  discount: number
  /** Task 43: bill-level % discount record (0 = flat Rs mode) */
  discountPct: number
  /** Task 44: real company invoice (Mondelez style) tax mechanism */
  taxTotal: number
  advanceTaxPct: number
  advanceTaxTotal: number
  tradeOfferTotal: number
  total: number
  paidAmount: number
  status: string
  notes: string | null
  items: PurchaseItemDTO[]
}

export interface CompanyLedgerEntryDTO {
  id: string
  date: string
  type: string
  description: string
  refNo: string | null
  invoiceNo: string | null
  debit: number
  credit: number
  balance: number
}

export interface CompanyLedgerDTO {
  company: {
    id: string
    name: string
    shortCode: string | null
    logo: string | null
    address: string | null
    phone: string | null
  }
  totals: { debit: number; credit: number; balance: number }
  entries: CompanyLedgerEntryDTO[]
}

export interface CompaniesData {
  companies: CompanyFullDTO[]
  totals: { payable: number; purchaseTotal: number; count: number }
}

export interface ProductDTO {
  id: string
  sku: string
  name: string
  brand: string
  company: CompanyDTO | null
  category: string
  unitsPerCarton: number
  boxesPerCarton: number
  pcsPerBox: number
  purchasePrice: number | null
  tradePrice: number
  consumerPrice: number | null
  // Task 37: per-product GST — bill isi rate se print hota hai (false = is product par GST nahi)
  gstEnabled: boolean
  gstRate: number
  stock: number // PIECES base
  available: number // Task 26: ATP pcs = stock − CONFIRMED (unprocessed) bills ki booked qty — booking limit
}

export interface OutletDTO {
  id: string
  code: string
  name: string
  ownerName: string | null
  phone: string | null
  address: string | null
  city: string
  channel: string
  lat: number | null
  lng: number | null
  creditDays: number
  /** Filer / Non-Filer advance tax */
  ntn: string | null
  /** Shop owner ka CNIC — bill print par shop ke apne NTN/CNIC */
  cnic: string | null
  filerStatus: string
  /** Visit schedule — "MON,WED,SAT" | empty = roz visit */
  visitDays: string
  distributorName: string
  /** Task 68: assigned route booker — null = unassigned (order booking mein kisi booker ki list mein nahi) */
  salesmanId: string | null
  salesmanName: string | null
  totalOrders: number
  totalValue: number
}

export interface SchemeDTO {
  id: string
  name: string
  description: string | null
  type: string
  channel: string | null
  productId: string | null
  productName: string | null
  /** Task 55: category-wide scheme target (null = category filter off) */
  categoryId?: string | null
  categoryName?: string | null
  /** Task 55: outlet tax-status scope — null = all outlets | FILER | NON_FILER */
  filerScope?: string | null
  value: number
  buyQty: number
  freeQty: number
  startDate: string
  endDate: string | null
  isActive: boolean
}

export interface StockBatchDTO {
  id: string
  batchNo: string
  qty: number
  expDate: string | null
  mfgDate: string | null
  receivedAt: string
}

export interface StockRowDTO {
  productId: string
  productName: string
  sku: string
  brand: string
  company: string | null
  category: string
  totalQty: number // PIECES
  unitsPerCarton: number
  boxesPerCarton: number
  pcsPerBox: number
  tradePrice: number
  value: number
  batches: StockBatchDTO[]
  nearestExpiry: string | null
  nearExpiryQty: number
}

export interface WarehouseDTO {
  id: string
  name: string
  city: string
  isPrimary: boolean
  distributorName: string
  totalQty: number
  totalValue: number
  rows: StockRowDTO[]
}

export interface InventoryData {
  warehouses: WarehouseDTO[]
  summary: {
    totalQty: number
    totalValue: number
    nearExpiryValue: number
    outOfStock: number
  }
  adjustments: {
    id: string
    productName: string
    warehouseName: string
    type: string
    qty: number
    reason: string
    userName: string | null
    createdAt: string
  }[]
}

export interface PJPPlanDTO {
  id: string
  salesmanId: string
  salesmanName: string
  date: string
  status: string
  visits: {
    id: string
    outletId: string
    outletName: string
    outletCode: string
    channel: string
    area: string | null
    sequence: number
    status: string
    checkInAt: string | null
    checkOutAt: string | null
    checkInLat: number | null
    checkInLng: number | null
    notes: string | null
    lat: number | null
    lng: number | null
  }[]
}

/** Task 82: /api/pjp/today — auto route (manual plan khatam) */
export interface PjpTodayDTO {
  dayCode: string
  fridayOff: boolean
  unplannedEnabled: boolean
  planId: string | null
  visits: PJPPlanDTO['visits']
}

export interface SalesmanPerfDTO {
  id: string
  name: string
  email: string
  phone: string | null
  region: string | null
  parentId?: string | null
  parentName: string | null
  companyId: string | null
  companyName: string | null
  companyShortCode: string | null
  outletsAssigned: number
  monthOrders: number
  monthSales: number
  monthTarget: number
  achievement: number
  pjpCompliance: number
  lastActive: string | null
}

// Order booker ke possible parents (admin create/edit dialog ke liye)
export interface BookerParentDTO {
  id: string
  name: string
  businessName: string | null
  role: string
}

export interface ReturnDTO {
  id: string
  returnNo: string
  outletName: string
  type: string
  status: string
  totalValue: number
  reason: string | null
  createdAt: string
  items: { productName: string; qty: number; rate: number; value: number; unitsPerCarton?: number; pcsPerBox?: number }[]
}

export interface ClaimDTO {
  id: string
  claimNo: string
  distributorName: string
  type: string
  amount: number
  status: string
  approvedBy: string | null
  reason: string | null
  createdAt: string
}

export interface CollectionDTO {
  id: string
  receiptNo: string
  outletName: string
  amount: number
  method: string
  date: string
  collectedByName: string | null
}

export interface HierarchyNode {
  id: string
  name: string
  email: string
  role: string
  region: string | null
  phone?: string | null
  businessName?: string
  city?: string
  creditLimit?: number
  outletsCount?: number
  monthSales?: number
  children: HierarchyNode[]
}

// ============ MEGA ADMIN — DISTRIBUTOR ACCOUNTS (Task 22) ============

export interface MegaDistributorDTO {
  id: string
  name: string
  email: string
  phone: string | null
  region: string | null
  businessName: string | null
  city: string | null
  creditLimit: number | null
  isActive: boolean
  subscriptionStart: string | null
  subscriptionExpiry: string | null
  daysLeft: number | null
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED'
  teamUsers: number
  createdAt: string
}

export interface MegaDistributorsData {
  distributors: MegaDistributorDTO[]
  totals: { total: number; active: number; inactive: number; expired: number; expiringSoon: number }
}

// ============ DELIVERY SUMMARY / SETTLEMENT / LEDGER TYPES ============

export interface SummaryDTO {
  id: string
  summaryNo: string
  salesmanName: string
  distributorName: string
  warehouseName: string
  orderDate: string
  deliveryDate: string
  status: string // UNSETTLED | SETTLED
  billsCount: number
  subtotal: number
  /** Task 80: final payable — unsettled: Σ orderGrandPayable(orders); settled: Σ posted (cash+credit) */
  payable?: number
  settledCash: number
  settledCredit: number
  settledReturns: number
  settledAt: string | null
  settledByName: string | null
}

export interface SummaryOrderItemDTO {
  id: string
  productId: string
  productName: string
  sku: string
  unitsPerCarton: number
  boxesPerCarton: number
  pcsPerBox: number
  consumerPrice: number | null
  qty: number // PIECES
  freeQty: number // PIECES
  rate: number // per PIECE
  discount: number
  lineTotal: number
  schemeName?: string | null
}

export interface SummaryOrderDTO {
  id: string
  orderNo: string
  outletId: string
  outletName: string
  outletCode: string
  channel: string
  address: string | null
  ownerName?: string | null
  total: number
  /** Task 45: GST + Trade Order totals (order-level snapshot) */
  tradeOfferTotal?: number
  gstTotal?: number
  /** Advance Tax snapshot — filer 0.5% / non-filer 2.5% (settings), bill par add */
  filerStatus?: string | null
  advanceTaxRate?: number | null
  advanceTax?: number
  status: string
  orderDate: string
  settled: boolean
  items: SummaryOrderItemDTO[]
  returns?: SummaryOrderReturnDTO[]
}

export interface SummaryOrderReturnItemDTO {
  productId?: string // late-return cap ke liye (pehle sirf naam jata tha)
  productName: string
  qty: number // PIECES
  rate: number // per PIECE
  value: number
  unitsPerCarton?: number
  pcsPerBox?: number
}

export interface SummaryOrderReturnDTO {
  id?: string // Task 64: cancel/undo ke liye (purane cached payloads mein ho sakta nahi)
  returnNo: string
  type: string
  status: string
  totalValue: number
  reason: string | null
  createdAt: string
  items: SummaryOrderReturnItemDTO[]
}

export interface SummaryProductDTO {
  productId: string
  sku: string
  name: string
  brand: string
  unitsPerCarton: number
  boxesPerCarton: number
  pcsPerBox: number
  qty: number // PIECES
  freeQty: number // PIECES
  rate: number // per PIECE
  amount: number
}

export interface SettlementRowDTO {
  id: string
  orderId: string
  outletName: string
  billAmount: number
  returnAmount: number
  advanceTax?: number
  /** Task 45: effective GST/TO (return reversal ke baad) — Task 80: settlement sheet Net Payable isi se */
  gstTotal?: number
  tradeOfferTotal?: number
  cashAmount: number
  creditAmount: number
  status: string
  notes: string | null
}

export interface SummaryDetailDTO extends SummaryDTO {
  salesmanId: string
  notes: string | null
  products: SummaryProductDTO[]
  orders: SummaryOrderDTO[]
  settlements: SettlementRowDTO[]
}

export interface LedgerRowDTO {
  outletId: string
  name: string
  code: string
  city: string
  channel: string
  distributorName: string
  entries: number
  lastEntryAt: string | null
  debit: number
  credit: number
  balance: number
}

export interface LedgerEntryDTO {
  id: string
  date: string
  type: string
  refType: string
  refNo: string
  note: string | null
  debit: number
  credit: number
  balance: number
}

export interface LedgerOutletDTO {
  id: string
  name: string
  code: string
  city: string
  channel: string
  creditDays: number
}

export interface LedgersData {
  ledgers: LedgerRowDTO[]
  totals: { outstanding: number; shopsWithUdhaar: number; totalShops: number }
}

// ============ RECOVERY (order-booker wise udhaar wasooli) ============

export interface RecoveryBookerDTO {
  id: string | null // null = unassigned shops bucket
  name: string
  phone: string | null
  /** Admin-controlled "All Routes" access — ON = booker apni login mein sab shops dekh sakta hai */
  allRoutesOpen: boolean
  routeShops: number
  shopsWithUdhaar: number
  totalOutstanding: number
  recoveredToday: number
  recoveredMonth: number
  recoveredTotal: number
  lastRecoveryAt: string | null
}

export interface RecoveryShopDTO {
  outletId: string
  name: string
  code: string
  city: string
  channel: string
  balance: number
  /** Visit schedule — "MON,WED,SAT" | empty = roz visit */
  visitDays: string
}

export interface RecoveryRowDTO {
  id: string
  recoveryNo: string
  receiptNo: string | null
  date: string
  bookerId: string | null
  bookerName: string
  outletName: string
  outletCode: string
  amount: number
  method: string
  reference: string | null
  note: string | null
  postedByName: string | null
  /** Approval workflow — PENDING | APPROVED | REJECTED */
  status: string
  originalAmount: number | null
  editedAmount: boolean
  reviewNote: string | null
  approvedByName: string | null
  approvedAt: string | null
}

export interface RecoveryData {
  bookers: RecoveryBookerDTO[]
  /** bookerId param ke sath — us bucket ki route shops (balance + visitDays ke sath) */
  shops: RecoveryShopDTO[]
  history: RecoveryRowDTO[]
  /** PENDING recoveries — admin approval ka intezar */
  pending: RecoveryRowDTO[]
  totals: { outstanding: number; recoveredToday: number; recoveredMonth: number; pendingCount: number; pendingAmount: number }
}
