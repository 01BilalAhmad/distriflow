'use client'

/**
 * Stock Allocation view (Salesflo-style) — orderbooker ke bills aate hi table mein:
 * Store Name | Qty (Cases) | Invoice Value | Change Stock Allocation (+)
 * Har bill expand karke us ke items ka stock EDIT (Ctn/Box/Pcs), ADD (naya product)
 * aur DELETE kiya ja sakta hai — save par scheme/manual discount server par dobara
 * calculate hoti hai (booking wali hi math). Phir bills select karke Process → Summary.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate } from '@/lib/dms-api'
import type { OrderDTO, SalesmanPerfDTO } from '@/lib/dms-types'
import { orderGrandPayable } from '@/lib/dms-order-calc'
import { UnitQtyInputs, fmtQty, packHint } from '@/components/dms/unit-qty'
import { ClipboardList, Loader2, Search, Truck, CalendarDays, Plus, X, Trash2, PackagePlus, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function tomorrowKey(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---- Stock allocation editor ----

interface EditLine {
  productId: string
  productName: string
  sku: string
  upc: number
  boxesPerCarton: number
  pcsPerBox: number
  qtyPcs: number
  rate: number // per pc (existing line = booked snapshot, nayi line = current)
  freeQty: number
  discount: number
  schemeName: string | null
  /** true = bill ki purani line (rate preserve hoga), false = editor mein nayi add hui */
  isExisting: boolean
  /** Task 26: ATP pcs (stock − doosri open bills) — preview se aata hai, over-limit guard */
  availablePcs?: number
}

interface AddProduct {
  id: string
  name: string
  sku: string
  unitsPerCarton: number
  boxesPerCarton: number
  pcsPerBox: number
  tradePrice: number
  available?: number
}

interface PreviewTotals {
  subtotal: number
  schemeDiscount: number
  manualDiscount: number
  total: number
  tradeOfferTotal?: number
  gstTotal?: number
  payable?: number
  advanceTax?: number
  advanceTaxRate?: number | null
  filerStatus?: string | null
}

/** Task 27: process par out-of-stock — API se structured shortage rows (popup isi se bharta hai) */
interface ShortageRow {
  orderId: string
  orderNo: string
  outletName: string
  productId: string
  productName: string
  sku: string
  unitsPerCarton: number
  pcsPerBox: number
  bookedPcs: number
  availPcs: number
  shortPcs: number
}

/** Task 28: Process Anyway ka result — partial load + skipped bills ki report */
interface AnywayResult {
  summaryId: string
  summaryNo: string
  processedCount: number
  skippedBills: { orderNo: string; outletName: string }[]
  shortRows: {
    orderNo: string
    outletName: string
    productName: string
    sku: string
    unitsPerCarton: number
    pcsPerBox: number
    bookedPcs: number
    loadedPcs: number
  }[]
}

interface DetailItemDTO {
  productId: string
  productName: string
  sku: string
  unitsPerCarton: number
  boxesPerCarton: number
  pcsPerBox: number
  qty: number
  freeQty: number
  rate: number
  discount: number
  schemeName: string | null
}

interface OrderDetailDTO {
  orderNo: string
  outlet: { name: string; code: string; channel: string }
  salesmanName: string | null
  subtotal: number
  schemeDiscount: number
  manualDiscount: number
  manualDiscType: string | null
  manualDiscValue: number | null
  total: number
  status: string
  items: DetailItemDTO[]
}

export function UnprocessedBillsView() {
  const user = useDMS((s) => s.user)
  const router = useRouter()
  const setFocusSummary = useDMS((s) => s.setFocusSummary)

  const [orders, setOrders] = useState<OrderDTO[]>([])
  const [salesmen, setSalesmen] = useState<SalesmanPerfDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [booker, setBooker] = useState<string>('ALL')
  const [day, setDay] = useState<string>('') // '' = all days
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [processOpen, setProcessOpen] = useState(false)
  const [dlvDate, setDlvDate] = useState(tomorrowKey())
  const [processing, setProcessing] = useState(false)
  const [shortages, setShortages] = useState<ShortageRow[] | null>(null)
  const [anywayResult, setAnywayResult] = useState<AnywayResult | null>(null)
  const [anywayLoading, setAnywayLoading] = useState(false)

  // ---- Stock allocation editor state ----
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedOrder, setExpandedOrder] = useState<OrderDTO | null>(null)
  // Task 26-b: preview ladder print (cbl-print) jaisa mode-aware — INVOICE_DISCOUNT order par
  // Noms/SalesFlo ladder (Less: Trade Offer GST se pehle), CLAIM par GST pehle (print jaisa).
  const previewModeA = expandedOrder?.taxMode === 'INVOICE_DISCOUNT'
  const [detail, setDetail] = useState<OrderDetailDTO | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [lines, setLines] = useState<EditLine[]>([])
  const [savedSnapshot, setSavedSnapshot] = useState('') // saved lines ka JSON — dirty check
  const [preview, setPreview] = useState<PreviewTotals | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [products, setProducts] = useState<AddProduct[]>([])
  const [addId, setAddId] = useState('')
  const [addQty, setAddQty] = useState(0)
  const previewSeq = useRef(0)

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const [o, f] = await Promise.all([
        api<{ orders: OrderDTO[] }>(`/api/orders?userId=${user.id}&status=CONFIRMED`),
        api<{ salesmen: SalesmanPerfDTO[] }>(`/api/field-force?userId=${user.id}`),
      ])
      setOrders(o.orders)
      setSalesmen(f.salesmen)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [user])

  const bookerName = (id: string | null | undefined) => salesmen.find((s) => s.id === id)?.name ?? null

  const filtered = useMemo(() => orders.filter((o) => {
    if (booker !== 'ALL' && bookerName(booker) && o.salesmanName !== bookerName(booker)) return false
    if (day && dayKey(o.orderDate) !== day) return false
    if (search && !`${o.orderNo} ${o.outletName} ${o.salesmanName ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [orders, booker, day, search, salesmen])

  // Pre-select all filtered bills whenever the filter changes (orderbooker ka din bhar ke bills auto-selected)
  useEffect(() => {
    setSelected(new Set(filtered.map((o) => o.id)))
  }, [booker, day])

  const selectedOrders = filtered.filter((o) => selected.has(o.id))
  // Task 79: totals ab FINAL PAYABLE (Net − TO + GST + AdvTax) — wahi jo bill par charge hota hai
  const selectedTotal = selectedOrders.reduce((s, o) => s + orderGrandPayable(o), 0)
  const allChecked = filtered.length > 0 && selectedOrders.length === filtered.length
  const totalCases = filtered.reduce((s, o) => s + (o.totalCases ?? 0), 0)
  const totalValue = filtered.reduce((s, o) => s + orderGrandPayable(o), 0)

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  function toggleAll() {
    if (allChecked) setSelected(new Set())
    else setSelected(new Set(filtered.map((o) => o.id)))
  }

  // ================= Stock Allocation editor =================

  const linesKey = JSON.stringify(lines)
  const dirty = expandedId != null && linesKey !== savedSnapshot

  async function toggleExpand(o: OrderDTO) {
    if (expandedId === o.id) { // collapse
      setExpandedId(null); setDetail(null); setLines([]); setPreview(null); setExpandedOrder(null)
      return
    }
    setExpandedId(o.id)
    setExpandedOrder(o)
    setDetail(null); setLines([]); setPreview(null); setSavedSnapshot('')
    setDetailLoading(true)
    try {
      const [d, p] = await Promise.all([
        api<{ order: OrderDetailDTO }>(`/api/orders/${o.id}`),
        user ? api<{ products: AddProduct[] }>(`/api/products?userId=${user.id}`) : Promise.resolve({ products: [] }),
      ])
      setDetail(d.order)
      const withIds: EditLine[] = d.order.items.map((it) => ({
        productId: it.productId, productName: it.productName, sku: it.sku,
        upc: it.unitsPerCarton, boxesPerCarton: it.boxesPerCarton, pcsPerBox: it.pcsPerBox,
        qtyPcs: it.qty, rate: it.rate, freeQty: it.freeQty, discount: it.discount, schemeName: it.schemeName,
        isExisting: true,
      }))
      setLines(withIds)
      setSavedSnapshot(JSON.stringify(withIds))
      setProducts(p.products ?? [])
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Detail load failed', variant: 'destructive' })
      setExpandedId(null)
    } finally { setDetailLoading(false) }
  }

  // Debounced preview — qty badalte hi server se EXACT totals (scheme + manual recalc)
  useEffect(() => {
    if (!expandedId || detailLoading || lines.length === 0) { setPreview(null); return }
    const seq = ++previewSeq.current
    const t = setTimeout(async () => {
      try {
        setPreviewing(true)
        const r = await api<{ preview: PreviewTotals & { lines: { productId: string; rate: number; discount: number; freeQty: number; lineTotal: number; availablePcs?: number }[] } }>(
          `/api/orders/${expandedId}`,
          { method: 'PATCH', body: JSON.stringify({ action: 'PREVIEW_ITEMS', items: lines.map((l) => ({ productId: l.productId, qty: l.qtyPcs, ...(l.isExisting ? { rate: l.rate } : {}) })) }) },
        )
        if (seq !== previewSeq.current) return
        setPreview({ subtotal: r.preview.subtotal, schemeDiscount: r.preview.schemeDiscount, manualDiscount: r.preview.manualDiscount, total: r.preview.total, tradeOfferTotal: r.preview.tradeOfferTotal, gstTotal: r.preview.gstTotal, payable: r.preview.payable, advanceTax: r.preview.advanceTax, advanceTaxRate: r.preview.advanceTaxRate, filerStatus: r.preview.filerStatus })
        setLines((prev) => prev.map((l) => {
          const pl = r.preview.lines.find((x) => x.productId === l.productId)
          if (!pl) return l
          const changed = pl.rate !== l.rate || pl.discount !== l.discount || pl.freeQty !== l.freeQty || (pl.availablePcs != null && pl.availablePcs !== l.availablePcs)
          return changed ? { ...l, rate: pl.rate, discount: pl.discount, freeQty: pl.freeQty, availablePcs: pl.availablePcs ?? l.availablePcs } : l
        }))
      } catch { /* preview fail — save par server phir bhi validate karta hai */ } finally {
        if (seq === previewSeq.current) setPreviewing(false)
      }
    }, 450)
    return () => clearTimeout(t)
  }, [expandedId, linesKey])

  function setLineQty(productId: string, qtyPcs: number) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, qtyPcs: Math.max(0, Math.floor(qtyPcs)) } : l)))
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.productId !== productId))
  }

  function addProductLine() {
    const p = products.find((x) => x.id === addId)
    if (!p) { toast({ title: 'Product select karein', variant: 'destructive' }); return }
    if (addQty <= 0) { toast({ title: 'Qty 0 se ziada honi chahiye', variant: 'destructive' }); return }
    if (lines.some((l) => l.productId === p.id)) { toast({ title: 'Ye product pehle se bill mein hai', description: 'Usi line mein qty barha dein' }); return }
    // Task 26: nayi line bhi available stock ke andar ho
    if (p.available != null && addQty > p.available) {
      toast({ title: 'Stock limit crossed', description: `${p.name}: sirf ${fmtQty(p.available, Math.max(1, p.unitsPerCarton), p.pcsPerBox > 0 ? p.pcsPerBox : 0)} available hai`, variant: 'destructive' })
      return
    }
    setLines((prev) => [...prev, {
      productId: p.id, productName: p.name, sku: p.sku,
      upc: p.unitsPerCarton, boxesPerCarton: p.boxesPerCarton, pcsPerBox: p.pcsPerBox,
      qtyPcs: addQty, rate: p.tradePrice / Math.max(1, p.unitsPerCarton),
      freeQty: 0, discount: 0, schemeName: null, isExisting: false,
    }])
    setAddId(''); setAddQty(0)
  }

  async function saveLines() {
    if (!expandedId || lines.length === 0) {
      toast({ title: 'Kam az kam 1 item chahiye', variant: 'destructive' }); return
    }
    // Task 26: STOCK LIMIT — allocation edit bhi available stock ke andar (server bhi block karta hai)
    const overLine = lines.find((l) => l.availablePcs != null && l.qtyPcs > l.availablePcs)
    if (overLine && overLine.availablePcs != null) {
      toast({ title: 'Stock limit crossed', description: `${overLine.productName}: sirf ${fmtQty(overLine.availablePcs, Math.max(1, overLine.upc), overLine.pcsPerBox > 0 ? overLine.pcsPerBox : 0)} available hai — qty kam karein`, variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await api<{ order: { id: string; orderNo: string; subtotal: number; schemeDiscount: number; manualDiscount: number; total: number; itemCount: number; totalCases: number; totalFreePcs: number; tradeOfferTotal: number; gstTotal: number; advanceTax: number; payable: number } }>(
        `/api/orders/${expandedId}`,
        { method: 'PATCH', body: JSON.stringify({ action: 'UPDATE_ITEMS', items: lines.map((l) => ({ productId: l.productId, qty: l.qtyPcs, ...(l.isExisting ? { rate: l.rate } : {}) })) }) },
      )
      const o = r.order
      setOrders((prev) => prev.map((x) => (x.id === expandedId ? {
        ...x, subtotal: o.subtotal, schemeDiscount: o.schemeDiscount, manualDiscount: o.manualDiscount,
        total: o.total, itemCount: o.itemCount, totalCases: o.totalCases, totalFreePcs: o.totalFreePcs,
        tradeOfferTotal: o.tradeOfferTotal, gstTotal: o.gstTotal, advanceTax: o.advanceTax, payable: o.payable,
      } : x)))
      setExpandedOrder((prev) => (prev ? { ...prev, total: o.total, itemCount: o.itemCount, totalCases: o.totalCases, totalFreePcs: o.totalFreePcs, tradeOfferTotal: o.tradeOfferTotal, gstTotal: o.gstTotal, advanceTax: o.advanceTax, payable: o.payable } : prev))
      setSavedSnapshot(linesKey)
      toast({ title: `${o.orderNo} Stock Updated ✓`, description: `Naya total: ${fmtPKR(o.total)} (${o.totalCases?.toFixed(4)} cases)` })
      // fresh detail reload (naye item ids / scheme values)
      const d = await api<{ order: OrderDetailDTO }>(`/api/orders/${expandedId}`)
      setDetail(d.order)
      const withIds = d.order.items.map((it) => ({
        productId: it.productId, productName: it.productName, sku: it.sku,
        upc: it.unitsPerCarton, boxesPerCarton: it.boxesPerCarton, pcsPerBox: it.pcsPerBox,
        qtyPcs: it.qty, rate: it.rate, freeQty: it.freeQty, discount: it.discount, schemeName: it.schemeName,
        isExisting: true,
      }))
      setLines(withIds)
      setSavedSnapshot(JSON.stringify(withIds))
    } catch (e) {
      toast({ title: 'Save Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const addableProducts = products.filter((p) => !lines.some((l) => l.productId === p.id))

  async function processBills() {
    if (selectedOrders.length === 0) return
    const books = new Set(selectedOrders.map((o) => o.salesmanName))
    if (books.size > 1) {
      toast({ title: 'Mixed order bookers', description: 'Ek summary mein sirf ek order booker ki bills process hoti hain — pehle orderbooker select karein', variant: 'destructive' })
      return
    }
    setProcessing(true)
    try {
      const r = await api<{ summary: { id: string; summaryNo: string; billsCount: number; subtotal: number } }>('/api/summaries', {
        method: 'POST',
        body: JSON.stringify({ orderIds: [...selected], deliveryDate: dlvDate ? new Date(dlvDate + 'T12:00:00').toISOString() : undefined }),
      })
      toast({ title: `Summary ${r.summary.summaryNo} Created ✓`, description: `${r.summary.billsCount} bills processed — van loading FEFO basis par ho gayi` })
      setProcessOpen(false)
      setFocusSummary(r.summary.id)
      router.push('/summaries')
    } catch (e) {
      // Task 27: out-of-stock — structured shortages payload se detail popup (kis bill sy kia minus)
      const payload = (e as Error & { payload?: { shortages?: ShortageRow[] } }).payload
      if (payload?.shortages && payload.shortages.length > 0) {
        setProcessOpen(false)
        setShortages(payload.shortages)
      } else {
        toast({ title: 'Process Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
      }
    } finally { setProcessing(false) }
  }

  /** Popup se: jin bills mein stock kami thi unhe selection se nikal do — baaki process ho sake */
  function deselectShortBills() {
    if (!shortages) return
    const shortIds = new Set(shortages.map((s) => s.orderId))
    setSelected((prev) => new Set([...prev].filter((id) => !shortIds.has(id))))
    setShortages(null)
    toast({ title: 'Short bills deselect ho gayin', description: 'Ab Process dobara dabayein — baaki bills jo poore stock mein hain wo ban jayengi' })
  }

  /** Task 28: PROCESS ANYWAY — jitna stock hai utna lag jaye. Jis bill mein kuch bhi na bache wo unprocessed khari rahegi */
  async function processAnywayBills() {
    if (!shortages || anywayLoading) return
    setAnywayLoading(true)
    try {
      const r = await api<{
        summary: { id: string; summaryNo: string; billsCount: number; subtotal: number }
        processAnyway: boolean
        processedCount: number
        skippedBills: { orderNo: string; outletName: string }[]
        shortRows: AnywayResult['shortRows']
      }>('/api/summaries', {
        method: 'POST',
        body: JSON.stringify({ orderIds: [...selected], processAnyway: true, deliveryDate: dlvDate ? new Date(dlvDate + 'T12:00:00').toISOString() : undefined }),
      })
      setShortages(null)
      setProcessOpen(false)
      setAnywayResult({ summaryId: r.summary.id, summaryNo: r.summary.summaryNo, processedCount: r.processedCount, skippedBills: r.skippedBills, shortRows: r.shortRows })
      setSelected(new Set())
      await load() // list refresh — processed bills hat gayin, zero-stock bills khari rahengi
    } catch (e) {
      toast({ title: 'Process Anyway Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setAnywayLoading(false) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><SlidersHorizontal className="h-5 w-5 text-emerald-600" /> Stock Allocation</h2>
          <p className="text-sm text-slate-500">Order booker ke bills — har bill ka stock edit / add / delete karke process karein</p>
        </div>
        {selectedOrders.length > 0 && (
          <Button onClick={() => setProcessOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Truck className="h-4 w-4 mr-1.5" /> Execute {selectedOrders.length} Bill{selectedOrders.length > 1 ? 's' : ''} → Summary
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="grid gap-1">
          <Label className="text-xs text-slate-500">Order Booker</Label>
          <Select value={booker} onValueChange={setBooker}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Sab Order Bookers</SelectItem>
              {salesmen.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-slate-500 flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Booking Day (khali = sab din)</Label>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-slate-500">Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill no, outlet..." className="pl-9" />
          </div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <ClipboardList className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Koi unprocessed bill nahi — sab process ho chuke hain ✓</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/70">
                    <TableHead className="w-10">
                      <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Select all bills" />
                    </TableHead>
                    <TableHead>Bill #</TableHead>
                    <TableHead>Booker / PJP</TableHead>
                    <TableHead>Store Name</TableHead>
                    <TableHead className="text-right">Qty (Cases)</TableHead>
                    {/* Task 79: header bhi 'Total Payable' — amount ab final payable hai (Net + GST + AdvTax) */}
                    <TableHead className="text-right">Total Payable</TableHead>
                    <TableHead className="text-center w-28">Change Stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <StockRow
                      key={o.id}
                      o={o}
                      checked={selected.has(o.id)}
                      onToggle={() => toggle(o.id)}
                      expanded={expandedId === o.id}
                      onExpand={() => toggleExpand(o)}
                      detailLoading={detailLoading && expandedId === o.id}
                      dirty={expandedId === o.id && dirty}
                    />
                  ))}
                  {/* Salesflo-style totals row */}
                  <TableRow className="bg-slate-100/80 font-semibold">
                    <TableCell />
                    <TableCell colSpan={3} className="text-right text-slate-600">Total</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-900">{totalCases.toFixed(4)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-900">{fmtPKR(totalValue)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Expanded stock allocation editor (expand hone par table ke neeche card) ===== */}
      {expandedId && expandedOrder && (
        <Card className="border-emerald-200 shadow-sm ring-1 ring-emerald-100">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900 flex items-center gap-2">
                  <PackagePlus className="h-4 w-4 text-emerald-600" />
                  Change Stock Allocation — <span className="text-emerald-700">{expandedOrder.orderNo}</span>
                  {dirty && <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">Unsaved</Badge>}
                </p>
                <p className="text-xs text-slate-500">{expandedOrder.outletName} • {expandedOrder.salesmanName ?? '—'} • items qty Ctn/Box/Pcs mein edit karein, product add ya delete karein</p>
              </div>
              <Button size="sm" variant="ghost" className="h-8 text-slate-500" onClick={() => toggleExpand(expandedOrder)}>
                <X className="h-4 w-4 mr-1" /> Close
              </Button>
            </div>

            {detailLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : !detail ? null : (
              <>
                <div className="space-y-2">
                  {lines.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                      Sab items delete ho chuke — Save se pehle kam az kam 1 product add karein
                    </div>
                  )}
                  {lines.map((l) => {
                    const gross = Math.round(l.rate * l.qtyPcs * 100) / 100
                    const net = Math.round((gross - l.discount) * 100) / 100
                    return (
                      <div key={l.productId} className="rounded-lg border border-slate-200 bg-white p-2.5">
                        <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                          <div className="min-w-0 lg:w-64">
                            <p className="text-sm font-medium text-slate-800 truncate">{l.productName}</p>
                            <p className="text-[11px] text-slate-400">{l.sku} • {packHint(l.upc, l.boxesPerCarton, l.pcsPerBox)}</p>
                          </div>
                          <div className="flex-1">
                            <UnitQtyInputs pcs={l.qtyPcs} upc={l.upc} pcsPerBox={l.pcsPerBox} onChange={(pcs) => setLineQty(l.productId, pcs)} />
                          </div>
                          <div className="flex items-center gap-3 lg:gap-4 text-xs">
                            <div className="text-right">
                              <p className="text-slate-400">Rate/pc</p>
                              <p className="tabular-nums text-slate-700 font-medium">{l.rate.toFixed(2)}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-slate-400">Scheme</p>
                              <p className={`tabular-nums font-medium ${l.discount > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{l.discount > 0 ? `− ${fmtPKR(l.discount)}` : '—'}</p>
                            </div>
                            {l.freeQty > 0 && (
                              <div className="text-right">
                                <p className="text-slate-400">Free</p>
                                <p className="tabular-nums text-emerald-600 font-medium">{fmtQty(l.freeQty, l.upc, l.pcsPerBox)}</p>
                              </div>
                            )}
                            <div className="text-right min-w-20">
                              <p className="text-slate-400">Line Total</p>
                              <p className="tabular-nums text-slate-900 font-semibold">{fmtPKR(net)}</p>
                            </div>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50" onClick={() => removeLine(l.productId)} aria-label={`Delete ${l.productName}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {/* Task 26: available guard — over-limit par red, warna available info */}
                        {l.availablePcs != null && l.qtyPcs > l.availablePcs ? (
                          <p className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1 mt-1.5">
                            Stock limit: sirf {fmtQty(l.availablePcs, Math.max(1, l.upc), l.pcsPerBox > 0 ? l.pcsPerBox : 0)} available hai (doosri open bills book kar chuki hain)
                          </p>
                        ) : l.availablePcs != null ? (
                          <p className="text-[10px] text-slate-400 mt-1">Available: <span className="font-semibold text-emerald-600">{fmtQty(l.availablePcs, Math.max(1, l.upc), l.pcsPerBox > 0 ? l.pcsPerBox : 0)}</span></p>
                        ) : null}
                        <p className="text-[10px] text-slate-400 mt-1 lg:hidden">{l.qtyPcs} pcs = {fmtQty(l.qtyPcs, l.upc, l.pcsPerBox)} • Gross {fmtPKR(gross)}</p>
                      </div>
                    )
                  })}
                </div>

                {/* Add product */}
                <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/40 p-2.5">
                  <p className="text-xs font-medium text-emerald-700 mb-2 flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Naya Product Add Karein</p>
                  <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                    <Select value={addId || undefined} onValueChange={setAddId}>
                      <SelectTrigger className="lg:w-72 bg-white"><SelectValue placeholder="Product select karein..." /></SelectTrigger>
                      <SelectContent>
                        {addableProducts.map((p) => (
                          <SelectItem key={p.id} value={p.id} disabled={p.available != null && p.available <= 0}>
                            {p.name} ({p.sku}){p.available != null ? (p.available <= 0 ? ' • out of stock' : ` • avail ${fmtQty(p.available, Math.max(1, p.unitsPerCarton), p.pcsPerBox > 0 ? p.pcsPerBox : 0)}`) : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const p = products.find((x) => x.id === addId)
                      if (!p) return <p className="text-xs text-slate-400 flex-1">Product select karne par Ctn/Box/Pcs inputs yahan aayenge</p>
                      return (
                        <>
                          <UnitQtyInputs pcs={addQty} upc={p.unitsPerCarton} pcsPerBox={p.pcsPerBox} onChange={setAddQty} />
                          <p className="text-xs text-slate-500 flex-1 hidden lg:block">{fmtQty(addQty, p.unitsPerCarton, p.pcsPerBox)} • Rate/pc {fmtPKR(p.tradePrice / Math.max(1, p.unitsPerCarton))}</p>
                        </>
                      )
                    })()}
                    <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700" onClick={addProductLine} disabled={!addId || addQty <= 0}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add
                    </Button>
                  </div>
                </div>

                {/* Totals + save */}
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
                  <div className="text-sm space-y-1">
                    {/* Task 108: kaunsa TAX SYSTEM lag raha hai — print wala hi rule, ab naam ke sath */}
                    <p className={`text-[10px] font-bold uppercase tracking-wide ${previewModeA ? 'text-amber-600' : expandedOrder?.taxMode === 'RETAIL_GST' ? 'text-violet-600' : 'text-slate-400'}`}>
                      Tax Mode: {expandedOrder?.taxMode === 'MIXED'
                        ? 'Mixed — har line apni company ke tax rule par'
                        : previewModeA
                          ? 'Invoice Discount — Trade Offer pehle kaata, GST net−TO par (Noms style)'
                          : expandedOrder?.taxMode === 'RETAIL_GST'
                            ? 'Retail GST — GST retail price se, discounts ka asar nahi (Cadbury style)'
                            : 'Claim — GST poore net par, Trade Offer baad me'}
                    </p>
                    <div className="flex justify-between gap-8"><span className="text-slate-500">Subtotal</span><span className="tabular-nums text-slate-800">{preview ? fmtPKR(preview.subtotal) : '…'}</span></div>
                    <div className="flex justify-between gap-8"><span className="text-slate-500">Scheme Discount</span><span className="tabular-nums text-rose-600">{preview ? (preview.schemeDiscount > 0 ? `− ${fmtPKR(preview.schemeDiscount)}` : fmtPKR(0)) : '…'}</span></div>
                    {(preview?.manualDiscount ?? 0) > 0 && (
                      <div className="flex justify-between gap-8"><span className="text-slate-500">Manual Discount</span><span className="tabular-nums text-rose-600">− {fmtPKR(preview!.manualDiscount)}</span></div>
                    )}
                    <div className="flex justify-between gap-8 border-t border-slate-200 pt-1"><span className="font-medium text-slate-700">Net Payable</span><span className="tabular-nums font-bold text-emerald-700">{preview ? fmtPKR(preview.total) : '…'}</span></div>
                    {/* Task 26-b: ladder mode-aware (print jaisa) — INVOICE_DISCOUNT = Noms ladder */}
                    {previewModeA && (preview?.tradeOfferTotal ?? 0) > 0 && (
                      <div className="flex justify-between gap-8"><span className="text-violet-600">Less: Trade Offer (GST se pehle)</span><span className="tabular-nums text-violet-600">− {fmtPKR(preview!.tradeOfferTotal ?? 0)}</span></div>
                    )}
                    {(preview?.gstTotal ?? 0) > 0 && (
                      <div className="flex justify-between gap-8"><span className="text-blue-600">{previewModeA ? 'Sales Tax (GST)' : 'GST (Sales Tax)'}</span><span className="tabular-nums text-blue-600">+ {fmtPKR(preview!.gstTotal ?? 0)}</span></div>
                    )}
                    {(preview?.advanceTax ?? 0) > 0 && (
                      <div className="flex justify-between gap-8"><span className="text-blue-600">Advance Tax ({preview!.filerStatus === 'FILER' ? 'Filer' : 'Non-Filer'}{preview!.advanceTaxRate != null ? ` ${preview!.advanceTaxRate}%` : ''})</span><span className="tabular-nums text-blue-600">+ {fmtPKR(preview!.advanceTax ?? 0)}</span></div>
                    )}
                    {!previewModeA && (preview?.tradeOfferTotal ?? 0) > 0 && (
                      <div className="flex justify-between gap-8"><span className="text-violet-600">Trade Offer</span><span className="tabular-nums text-violet-600">− {fmtPKR(preview!.tradeOfferTotal ?? 0)}</span></div>
                    )}
                    {((preview?.tradeOfferTotal ?? 0) > 0 || (preview?.gstTotal ?? 0) > 0) && (preview?.payable ?? 0) > 0 && (
                      <div className="flex justify-between gap-8 border-t border-slate-200 pt-1"><span className="font-medium text-slate-700">Grand Total Payable</span><span className="tabular-nums font-semibold text-slate-900">{fmtPKR(preview!.payable ?? 0)}</span></div>
                    )}
                    {!(preview?.tradeOfferTotal) && !(preview?.gstTotal) && (preview?.advanceTax ?? 0) > 0 && (
                      <div className="flex justify-between gap-8"><span className="font-medium text-slate-700">Total Payable (incl. Adv Tax)</span><span className="tabular-nums font-semibold text-slate-900">{fmtPKR(Math.round((preview!.total + (preview!.advanceTax ?? 0)) * 100) / 100)}</span></div>
                    )}
                    <p className="text-[11px] text-slate-400">{previewing ? 'Calculating…' : 'Scheme aur discount server par dobara calculate hoti hai (booking wali hi math)'}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="h-9" onClick={() => toggleExpand(expandedOrder)} disabled={saving}>Cancel</Button>
                    <Button className="h-9 bg-emerald-600 hover:bg-emerald-700 min-w-36" onClick={saveLines} disabled={saving || previewing || !dirty || lines.length === 0}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <PackagePlus className="h-4 w-4 mr-1.5" />}
                      Save Changes
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Selection bar */}
      {filtered.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 rounded-lg border border-emerald-100 bg-emerald-50/50 px-4 py-2.5">
          <p className="text-sm text-slate-600">
            <b className="text-emerald-700">{selectedOrders.length}</b> / {filtered.length} bills selected
            {selectedOrders.length > 0 && <> • Total: <b className="text-slate-900">{fmtPKR(selectedTotal)}</b></>}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={toggleAll}>{allChecked ? 'Deselect All' : 'Select All'}</Button>
            <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" disabled={selectedOrders.length === 0} onClick={() => setProcessOpen(true)}>
              <Truck className="h-3.5 w-3.5 mr-1" /> Process
            </Button>
          </div>
        </div>
      )}

      {/* Process dialog */}
      <Dialog open={processOpen} onOpenChange={setProcessOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-emerald-600" /> Execute Invoices → Delivery Summary</DialogTitle>
            <DialogDescription>Selected bills ek summary mein ban jayengi — process se pehle stock check hota hai (kami par detail popup aayega), phir warehouse stock van ke liye FEFO basis par niklega</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="rounded-lg bg-slate-50 border p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Order Booker</span><b className="text-slate-800">{selectedOrders[0]?.salesmanName ?? '—'}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Bills</span><b className="text-slate-800">{selectedOrders.length}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Total Amount</span><b className="text-emerald-700">{fmtPKR(selectedTotal)}</b></div>
            </div>
            <div className="grid gap-1.5">
              <Label className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-emerald-600" /> Delivery Date (agla din — change kar sakte hain)</Label>
              <Input type="date" value={dlvDate} onChange={(e) => setDlvDate(e.target.value)} />
              <p className="text-[11px] text-slate-400">Aaj booking hui to delivery kal hogi — default next day set hai</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={processBills} disabled={processing || selectedOrders.length === 0} className="w-full bg-emerald-600 hover:bg-emerald-700">
              {processing && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Confirm &amp; Process
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Task 27: Out-of-stock popup — kis bill sy kis product ka kitna minus hota ===== */}
      <Dialog open={!!shortages} onOpenChange={(v) => { if (!v) setShortages(null) }}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700"><TriangleAlert className="h-5 w-5 text-red-600" /> Out of Stock — Stock Kami Hai</DialogTitle>
            <DialogDescription>
              Warehouse mein stock kam hai — neeche dekhein kis bill sy kis product ka kitna minus ho raha tha. Aap <b>Process Anyway</b> chun sakte hain (jitna stock hai utna har bill mein lag jayega) ya short bills nikaal kar sirf poori bills process karein:
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-200 bg-red-50/60 overflow-hidden">
            <div className="overflow-auto max-h-[40vh]">
              <Table className="min-w-[460px]">
                <TableHeader>
                  <TableRow className="bg-red-100/60">
                    <TableHead className="text-red-800">Bill #</TableHead>
                    <TableHead className="text-red-800">Store</TableHead>
                    <TableHead className="text-red-800">Product</TableHead>
                    <TableHead className="text-right text-red-800">Bill Mein</TableHead>
                    <TableHead className="text-right text-red-800">Warehouse</TableHead>
                    <TableHead className="text-right text-red-800">Minus</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shortages?.map((s, i) => (
                    <TableRow key={`${s.orderId}-${s.productId}-${i}`} className="bg-white">
                      <TableCell className="font-semibold text-slate-800 whitespace-nowrap">{s.orderNo}</TableCell>
                      <TableCell className="text-slate-600 max-w-[110px] truncate" title={s.outletName}>{s.outletName}</TableCell>
                      <TableCell>
                        <p className="text-sm font-medium text-slate-800 leading-tight">{s.productName}</p>
                        <p className="text-[10px] text-slate-400">{s.sku}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700 whitespace-nowrap">{fmtQty(s.bookedPcs, Math.max(1, s.unitsPerCarton), s.pcsPerBox > 0 ? s.pcsPerBox : 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700 whitespace-nowrap">{fmtQty(s.availPcs, Math.max(1, s.unitsPerCarton), s.pcsPerBox > 0 ? s.pcsPerBox : 0)}</TableCell>
                      <TableCell className="text-right tabular-nums font-bold text-red-600 whitespace-nowrap">− {fmtQty(s.shortPcs, Math.max(1, s.unitsPerCarton), s.pcsPerBox > 0 ? s.pcsPerBox : 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <b>Process Anyway kya karega:</b> Purani bill pehle — har bill ko jitna stock milega utna load ho jayega (partial load), aur jis bill mein <b>kuch bhi nahi bachega</b> wo process nahi hogi — Stock Allocation mein khari rahegi (stock aane par process karein). Ya phir bill ke aage <b>+</b> dabaa kar qty edit karein / short bills deselect karein.
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button onClick={processAnywayBills} disabled={anywayLoading} className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700">
              {anywayLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Truck className="h-4 w-4 mr-1.5" />}
              Process Anyway — Jitna Hai Utna Lag Jaye
            </Button>
            <Button variant="outline" onClick={deselectShortBills} className="w-full sm:w-auto border-red-300 text-red-700 hover:bg-red-50">
              <X className="h-4 w-4 mr-1.5" /> Short Bills Deselect Karein
            </Button>
            <Button variant="outline" onClick={() => setShortages(null)} className="w-full sm:w-auto bg-slate-800 hover:bg-slate-900 text-white border-slate-800">
              Theek Hai
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Task 28: Process Anyway result — kya process hua, kya nahi ===== */}
      <Dialog open={!!anywayResult} onOpenChange={(v) => { if (!v) setAnywayResult(null) }}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700"><Truck className="h-5 w-5 text-emerald-600" /> {anywayResult?.summaryNo} — Process Ho Gaya (Jitna Stock Tha Utna)</DialogTitle>
            <DialogDescription>
              {anywayResult?.processedCount} bill{anywayResult && anywayResult.processedCount !== 1 ? 's' : ''} process ho gayin{anywayResult && anywayResult.skippedBills.length > 0 ? ` — ${anywayResult.skippedBills.length} bill${anywayResult.skippedBills.length > 1 ? 's' : ''} mein kuch bhi load nahi hua, wo Stock Allocation mein khari rahengi` : ''}:
            </DialogDescription>
          </DialogHeader>
          {anywayResult && anywayResult.shortRows.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1.5">Partial load — jitna lag gaya wo load ho gaya:</p>
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 overflow-hidden">
                <div className="overflow-auto max-h-[32vh]">
                  <Table className="min-w-[460px]">
                    <TableHeader>
                      <TableRow className="bg-amber-100/60">
                        <TableHead className="text-amber-800">Bill #</TableHead>
                        <TableHead className="text-amber-800">Store</TableHead>
                        <TableHead className="text-amber-800">Product</TableHead>
                        <TableHead className="text-right text-amber-800">Bill Mein</TableHead>
                        <TableHead className="text-right text-amber-800">Load Hua</TableHead>
                        <TableHead className="text-right text-amber-800">Minus</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {anywayResult.shortRows.map((s, i) => (
                        <TableRow key={`${s.orderNo}-${s.sku}-${i}`} className="bg-white">
                          <TableCell className="font-semibold text-slate-800 whitespace-nowrap">{s.orderNo}</TableCell>
                          <TableCell className="text-slate-600 max-w-[110px] truncate" title={s.outletName}>{s.outletName}</TableCell>
                          <TableCell>
                            <p className="text-sm font-medium text-slate-800 leading-tight">{s.productName}</p>
                            <p className="text-[10px] text-slate-400">{s.sku}</p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-slate-700 whitespace-nowrap">{fmtQty(s.bookedPcs, Math.max(1, s.unitsPerCarton), s.pcsPerBox > 0 ? s.pcsPerBox : 0)}</TableCell>
                          <TableCell className="text-right tabular-nums font-bold text-emerald-600 whitespace-nowrap">{fmtQty(s.loadedPcs, Math.max(1, s.unitsPerCarton), s.pcsPerBox > 0 ? s.pcsPerBox : 0)}</TableCell>
                          <TableCell className="text-right tabular-nums font-bold text-red-600 whitespace-nowrap">− {fmtQty(s.bookedPcs - s.loadedPcs, Math.max(1, s.unitsPerCarton), s.pcsPerBox > 0 ? s.pcsPerBox : 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
          {anywayResult && anywayResult.skippedBills.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-slate-700 mb-1.5">Ye bills UNPROCESSED khari rahengi (1 item bhi load nahi hua — stock aane par process karein):</p>
              <div className="flex flex-wrap gap-1.5">
                {anywayResult.skippedBills.map((b, i) => (
                  <span key={`${b.orderNo}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-white border border-slate-300 px-2 py-0.5 text-xs">
                    <b className="text-slate-800">{b.orderNo}</b>
                    <span className="text-slate-500 max-w-[120px] truncate">{b.outletName}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {anywayResult && anywayResult.shortRows.length === 0 && anywayResult.skippedBills.length === 0 && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
              Sab kuch poora load ho gaya — koi kami nahi hui.
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => { const sid = anywayResult?.summaryId; setAnywayResult(null); if (sid) { setFocusSummary(sid); router.push('/summaries') } }}
              className="w-full sm:w-auto"
            >
              <ClipboardList className="h-4 w-4 mr-1.5" /> Summary Dekhein
            </Button>
            <Button onClick={() => setAnywayResult(null)} className="w-full sm:w-auto bg-slate-800 hover:bg-slate-900">
              Theek Hai
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ================= Salesflo-style bill row =================

function StockRow({ o, checked, onToggle, expanded, onExpand, detailLoading, dirty }: {
  o: OrderDTO
  checked: boolean
  onToggle: () => void
  expanded: boolean
  onExpand: () => void
  detailLoading: boolean
  dirty: boolean
}) {
  return (
    <TableRow className={`hover:bg-emerald-50/30 ${checked ? 'bg-emerald-50/60' : ''} ${expanded ? 'bg-emerald-50' : ''}`}>
      <TableCell>
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Select ${o.orderNo}`} />
      </TableCell>
      <TableCell className="font-semibold text-emerald-700">{o.orderNo}</TableCell>
      <TableCell className="text-slate-600">{o.salesmanName ?? '—'}</TableCell>
      <TableCell>
        <p className="font-medium text-slate-800">{o.outletName}</p>
        <p className="text-xs text-slate-400">{o.channel}</p>
      </TableCell>
      <TableCell className="text-right tabular-nums text-slate-700">
        {(o.totalCases ?? 0).toFixed(4)}
        {(o.totalFreePcs ?? 0) > 0 && <span className="ml-1 text-[10px] text-emerald-600">+free</span>}
      </TableCell>
      <TableCell className="text-right">
        {/* Task 79: FINAL PAYABLE (Net − TO + GST + AdvTax) — bill ke Grand Total se match + chhota Net reference */}
        <p className="font-semibold text-slate-900 tabular-nums whitespace-nowrap">{fmtPKR(orderGrandPayable(o))}</p>
        {(o.gstTotal ?? 0) > 0 || (o.tradeOfferTotal ?? 0) > 0 || (o.advanceTax ?? 0) > 0 ? (
          <p className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">Net {fmtPKR(o.total)}</p>
        ) : null}
      </TableCell>
      <TableCell className="text-center">
        <Button
          size="icon"
          variant="ghost"
          className={`h-8 w-8 rounded-full ${expanded ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'}`}
          onClick={onExpand}
          aria-label={`Change stock ${o.orderNo}`}
          aria-expanded={expanded}
        >
          {detailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : expanded ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
        {expanded && dirty && <span className="sr-only">unsaved changes</span>}
      </TableCell>
    </TableRow>
  )
}
