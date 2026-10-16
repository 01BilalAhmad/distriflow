'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate, STATUS_STYLES, statusLabel } from '@/lib/dms-api'
import type { OrderDTO, OrderItemDTO, OutletDTO, ProductDTO, SchemeDTO, SalesmanPerfDTO } from '@/lib/dms-types'
import { UnitQtyInputs, splitPcs, fmtQty, packHint } from '@/components/dms/unit-qty'
import { PrintFrame, CblInvoiceDoc, keepDialogBehind, type InvoiceData } from '@/components/dms/cbl-print'
import { orderGrandPayable, splitManualByNet, aggregateSchemePromos } from '@/lib/dms-order-calc'
import { Plus, Eye, XCircle, Loader2, Search, ShoppingCart, Printer, Percent, Gift } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface DraftLine {
  productId: string
  qtyPcs: number // base unit = PIECE (Ctn/Box/Pcs inputs se banta hai)
  tradeOffer: string // Task 45: per-SKU Trade Offer Rs (string input state, discount ke ILAWA)
}

type DiscType = 'NONE' | 'PERCENT' | 'FLAT'

/** Task 57: booking preview ki per-scheme breakdown entry — har promotion apni
 * chip/row par dikhti hai (combined "Eclair + Khushhali" nahi), jitni schemes
 * qualify karein utni entries auto. */
interface PreviewStackEntry {
  id: string
  name: string
  type: string
  /** money scheme (PERCENT/FLAT) ka is line par apna Rs contribution */
  amount: number
  /** BxGy scheme ke is line par apne free pcs */
  freeGiven: number
}

export function OrdersView() {
  const user = useDMS((s) => s.user)
  const [orders, setOrders] = useState<OrderDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<OrderDTO | null>(null)
  const [detailItems, setDetailItems] = useState<OrderItemDTO[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const res = await api<{ orders: OrderDTO[] }>(`/api/orders?userId=${user.id}`)
      setOrders(res.orders)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load()   }, [user])

  async function openDetail(o: OrderDTO) {
    setDetail(o)
    setDetailItems(null)
    try {
      const res = await api<{ order: { items: OrderItemDTO[] } }>(`/api/orders/${o.id}`)
      setDetailItems(res.order.items)
    } catch { /* noop */ }
  }

  async function cancelOrder(o: OrderDTO) {
    try {
      await api(`/api/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'CANCEL' }) })
      toast({ title: 'Cancelled', description: `${o.orderNo} cancel kar diya gaya` })
      load()
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    }
  }

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (filter !== 'ALL' && o.status !== filter) return false
      if (search && !`${o.orderNo} ${o.outletName} ${o.salesmanName ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [orders, filter, search])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Secondary Sales Orders</h2>
          <p className="text-sm text-slate-500">Order booking se delivery tak complete lifecycle</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-1.5" /> New Order
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order no, outlet ya salesman search karein..." className="pl-9" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {['ALL', 'CONFIRMED', 'PROCESSING', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED'].map((s) => (
              <SelectItem key={s} value={s}>{s === 'ALL' ? 'Sab Status' : statusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-slate-200 shadow-sm flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <ShoppingCart className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Koi order nahi mila</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/70">
                    <TableHead>Order #</TableHead>
                    <TableHead>Outlet</TableHead>
                    <TableHead className="hidden md:table-cell">Salesman</TableHead>
                    <TableHead className="hidden lg:table-cell">Date</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.id} className="hover:bg-emerald-50/30">
                      <TableCell className="font-semibold text-emerald-700">{o.orderNo}</TableCell>
                      <TableCell>
                        <p className="font-medium text-slate-800">{o.outletName}</p>
                        <p className="text-xs text-slate-400">{o.channel}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-slate-600">{o.salesmanName ?? '—'}</TableCell>
                      <TableCell className="hidden lg:table-cell text-slate-500 text-xs">{fmtDate(o.orderDate)}</TableCell>
                      <TableCell className="text-right text-slate-600">{o.itemCount}</TableCell>
                      <TableCell className="text-right font-semibold">{fmtPKR(o.total)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${STATUS_STYLES[o.status] ?? ''} text-[10px] whitespace-nowrap`}>{statusLabel(o.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openDetail(o)} className="h-8 w-8 p-0"><Eye className="h-4 w-4" /></Button>
                          {o.status === 'CONFIRMED' && (
                            <Button size="sm" variant="ghost" onClick={() => cancelOrder(o)} className="h-8 w-8 p-0 text-red-500 hover:text-red-600"><XCircle className="h-4 w-4" /></Button>
                          )}
                          {o.status === 'PROCESSING' && (
                            <span className="text-[10px] text-violet-600 font-medium whitespace-nowrap">Van Out → Settlement</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <OrderDetailDialog order={detail} items={detailItems} onClose={() => setDetail(null)} />
      <CreateOrderDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
    </div>
  )
}

function OrderDetailDialog({ order, items, onClose }: { order: OrderDTO | null; items: OrderItemDTO[] | null; onClose: () => void }) {
  const [invData, setInvData] = useState<InvoiceData | null>(null)
  const [printing, setPrinting] = useState(false)
  const [gst, setGst] = useState<{ enabled: boolean; rate: number } | null>(null)

  // Invoice print ke liye full data fetch (consumer price, units/carton, owner, summary ref)
  useEffect(() => {
    if (!order) { queueMicrotask(() => setInvData(null)); return }
    queueMicrotask(() => {
      api<{ order: InvoiceData }>(`/api/orders/${order.id}`).then((r) => setInvData(r.order)).catch(() => {})
      // GST settings (bill print ke liye) — fail ho to default (on, 18%)
      api<{ settings: { gstEnabled: boolean; gstRate: number } }>(`/api/settings?userId=${(JSON.parse(localStorage.getItem('dms_session') ?? 'null'))?.id ?? ''}`)
        .then((s) => setGst({ enabled: s.settings.gstEnabled, rate: s.settings.gstRate }))
        .catch(() => {})
    })
  }, [order])

  // Task 57: Promotions Applied breakdown — har scheme apni row (print bill jaisi hi,
  // ISI shared helper se). Purani orders (stack nahi) helper khud legacy fallback use karta hai.
  const detailPromos = useMemo(() => aggregateSchemePromos(items ?? []), [items])

  return (
    <>
    <Dialog open={!!order} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col gap-3 sm:gap-4 p-4 sm:p-6" {...keepDialogBehind}>
        {order && (
          <>
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                {order.orderNo}
                <Badge variant="outline" className={STATUS_STYLES[order.status]}>{statusLabel(order.status)}</Badge>
              </DialogTitle>
              <DialogDescription>
                {order.outletName} ({order.outletCode}) • {order.channel} • Salesman: {order.salesmanName ?? '—'} • {fmtDate(order.orderDate, true)}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Free</TableHead>
                    <TableHead className="text-right">Rate/pc</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Trade Offer</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(items ?? []).map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <p className="font-medium text-slate-800 text-sm">{it.productName}</p>
                        {it.schemeName && <p className="text-[11px] text-emerald-600">🎁 {it.schemeName}</p>}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{fmtQty(it.qty, it.unitsPerCarton ?? 1, it.pcsPerBox ?? 0)}</TableCell>
                      <TableCell className="text-right">{it.freeQty > 0 ? <span className="text-emerald-600 font-semibold">+{fmtQty(it.freeQty, it.unitsPerCarton ?? 1, it.pcsPerBox ?? 0)}</span> : '—'}</TableCell>
                      <TableCell className="text-right text-xs">{fmtPKR(it.rate)}</TableCell>
                      <TableCell className="text-right text-xs">{it.discount > 0 ? `- ${fmtPKR(it.discount)}` : '—'}</TableCell>
                      <TableCell className="text-right text-xs">{(it.gstAmt ?? 0) > 0 ? <span className="text-blue-600 font-medium">+ {fmtPKR(it.gstAmt ?? 0)}<span className="text-[10px] text-slate-400"> ({it.gstRate ?? 0}%)</span></span> : '—'}</TableCell>
                      <TableCell className="text-right text-xs">{(it.tradeOfferAmt ?? 0) > 0 ? <span className="text-violet-600 font-medium">- {fmtPKR(it.tradeOfferAmt ?? 0)}</span> : '—'}</TableCell>
                      <TableCell className="text-right font-semibold">{fmtPKR(it.lineTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-1 pt-2 shrink-0">
              <Separator className="mb-2" />
              <div className="flex justify-between gap-3 text-sm text-slate-500"><span>Subtotal</span><span className="whitespace-nowrap tabular-nums">{fmtPKR(order.subtotal)}</span></div>
              {detailPromos.length > 0 ? detailPromos.map((p) => (
                <div key={p.id} className="flex justify-between gap-3 text-sm text-emerald-600">
                  <span>🎁 {p.name}</span>
                  <span className="whitespace-nowrap tabular-nums">{p.freePcs > 0 ? `+${p.freePcs} Pcs Free` : `- ${fmtPKR(p.amount)}`}</span>
                </div>
              )) : (order.schemeDiscount ?? 0) > 0 && (
                <div className="flex justify-between gap-3 text-sm text-emerald-600"><span>Scheme Discount</span><span className="whitespace-nowrap tabular-nums">- {fmtPKR(order.schemeDiscount)}</span></div>
              )}
              {(order.manualDiscount ?? 0) > 0 && (
                <div className="flex justify-between gap-3 text-sm text-emerald-600">
                  <span>Manual Discount{order.manualDiscType === 'PERCENT' && order.manualDiscValue ? ` (${order.manualDiscValue}%)` : ''}</span>
                  <span className="whitespace-nowrap tabular-nums">- {fmtPKR(order.manualDiscount ?? 0)}</span>
                </div>
              )}
              <div className="flex justify-between gap-3 font-bold text-lg text-slate-900"><span>Total</span><span className="whitespace-nowrap tabular-nums">{fmtPKR(order.total)}</span></div>
              {(order.gstTotal ?? 0) > 0 && (
                <div className="flex justify-between gap-3 text-sm text-blue-600">
                  <span>GST (Sales Tax)</span>
                  <span className="whitespace-nowrap tabular-nums">+ {fmtPKR(order.gstTotal ?? 0)}</span>
                </div>
              )}
              {(order.tradeOfferTotal ?? 0) > 0 && (
                <div className="flex justify-between gap-3 text-sm text-violet-600">
                  <span>Trade Offer</span>
                  <span className="whitespace-nowrap tabular-nums">- {fmtPKR(order.tradeOfferTotal ?? 0)}</span>
                </div>
              )}
              {(order.advanceTax ?? 0) > 0 && (
                <>
                  <div className="flex justify-between gap-3 text-sm text-blue-600">
                    <span>Advance Tax ({order.advanceTaxRate != null ? `${order.advanceTaxRate}%` : ''}{order.filerStatus ? ` — ${order.filerStatus === 'FILER' ? 'Filer' : 'Non-Filer'}` : ''})</span>
                    <span className="whitespace-nowrap tabular-nums">+ {fmtPKR(order.advanceTax ?? 0)}</span>
                  </div>
                </>
              )}
              {(order.tradeOfferTotal ?? 0) > 0 || (order.gstTotal ?? 0) > 0 ? (
                <div className="flex justify-between gap-3 font-semibold text-sm text-slate-900 border-t pt-1.5">
                  <span>Grand Total Payable (Total + GST − Trade Offer + Adv Tax)</span>
                  <span className="whitespace-nowrap tabular-nums">{fmtPKR(orderGrandPayable(order))}</span>
                </div>
              ) : (order.advanceTax ?? 0) > 0 && (
                <div className="flex justify-between gap-3 font-semibold text-sm text-slate-900">
                  <span>Total Payable (incl. Adv Tax)</span>
                  <span className="whitespace-nowrap tabular-nums">{fmtPKR(Math.round((order.total + (order.advanceTax ?? 0)) * 100) / 100)}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end border-t pt-3 shrink-0">
              <Button disabled={!invData} className="bg-slate-800 hover:bg-slate-900 text-white" onClick={() => setPrinting(true)}>
                <Printer className="h-4 w-4 mr-1.5" /> Print / Export Invoice
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>

    {printing && invData && (
      <PrintFrame title={`Invoice ${invData.orderNo}`} landscape onClose={() => setPrinting(false)}>
        <CblInvoiceDoc inv={invData} gst={gst ?? undefined} />
      </PrintFrame>
    )}
    </>
  )
}

function CreateOrderDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const user = useDMS((s) => s.user)
  const [outlets, setOutlets] = useState<OutletDTO[]>([])
  const [products, setProducts] = useState<ProductDTO[]>([])
  const [schemes, setSchemes] = useState<SchemeDTO[]>([])
  const [salesmen, setSalesmen] = useState<SalesmanPerfDTO[]>([])
  const [outletId, setOutletId] = useState('')
  const [bookerId, setBookerId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [notes, setNotes] = useState('')
  const [discType, setDiscType] = useState<DiscType>('NONE')
  const [discValue, setDiscValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [taxRates, setTaxRates] = useState<{ filer: number; nonFiler: number } | null>(null)

  useEffect(() => {
    if (!open || !user) return
    setOutletId(''); setBookerId(''); setLines([]); setNotes('')
    setDiscType('NONE'); setDiscValue('')
    api<{ outlets: OutletDTO[] }>(`/api/outlets?userId=${user.id}`).then((r) => setOutlets(r.outlets)).catch(() => {})
    api<{ products: ProductDTO[] }>(`/api/products?userId=${user.id}`).then((r) => setProducts(r.products)).catch(() => {})
    api<{ schemes: SchemeDTO[] }>(`/api/schemes?userId=${user.id}`).then((r) => setSchemes(r.schemes.filter((s) => s.isActive))).catch(() => {})
    api<{ salesmen: SalesmanPerfDTO[] }>(`/api/field-force?userId=${user.id}`).then((r) => setSalesmen(r.salesmen)).catch(() => {})
    api<{ settings: { filerTaxRate: number; nonFilerTaxRate: number } }>(`/api/settings?userId=${user.id}`).then((r) => setTaxRates({ filer: r.settings.filerTaxRate, nonFiler: r.settings.nonFilerTaxRate })).catch(() => {})
  }, [open, user])

  const outlet = outlets.find((o) => o.id === outletId)
  const booker = salesmen.find((s) => s.id === bookerId)

  // Outlet select hote hi uska default order booker auto-fill (manual choice override nahi hota)
  function selectOutlet(id: string) {
    setOutletId(id)
    if (bookerId) return
    const o = outlets.find((x) => x.id === id)
    if (!o?.salesmanName) return
    const match = salesmen.find((s) => s.name === o.salesmanName)
    if (match) setBookerId(match.id)
  }

  function addLine() {
    const used = new Set(lines.map((l) => l.productId))
    const avail = products.find((p) => !used.has(p.id) && p.available > 0) // Task 26: out-of-stock pehle hi select na ho
    if (avail) setLines([...lines, { productId: avail.id, qtyPcs: Math.max(1, avail.unitsPerCarton), tradeOffer: '' }]) // default 1 ctn
  }

  const computed = useMemo(() => {
    if (!outlet) return { subtotal: 0, discount: 0, gstTotal: 0, toTotal: 0, rows: [] as { name: string; qtyPcs: number; freeQty: number; discount: number; total: number; gross: number; stack: PreviewStackEntry[]; ratePc: number; upc: number; pcsPerBox: number; tradeOffer: number; gstRate: number; gstAmt: number }[] }
    let subtotal = 0, discount = 0, gstTotal = 0, toTotal = 0
    const rows = lines.map((l) => {
      const p = products.find((x) => x.id === l.productId)
      if (!p) return { name: '', qtyPcs: l.qtyPcs, freeQty: 0, discount: 0, total: 0, gross: 0, stack: [] as PreviewStackEntry[], ratePc: 0, upc: 1, pcsPerBox: 0, tradeOffer: 0, gstRate: 0, gstAmt: 0 }
      const upc = Math.max(1, p.unitsPerCarton)
      const pcsPerBox = p.pcsPerBox > 0 ? p.pcsPerBox : 0
      const ratePc = p.tradePrice / upc
      const ctnEquiv = l.qtyPcs / upc
      let freeQty = 0, disc = 0
      // Task 55: server computeOrderLines ka client mirror — same filters (product + channel
      // + category + filer scope), warna booking preview server-booked discount se alag dikhta.
      // Task 56: TIER STACKING mirror — PRODUCT > CATEGORY > BLANKET, har tier best, tiers
      // stack (product 3% + all-products 2% = 5%). Same tier par best-wins (Task 55 rule).
      const applicable = schemes
        .filter((s) =>
          (!s.productId || s.productId === p.id)
          && (!s.channel || s.channel === outlet.channel)
          && (!s.categoryName || s.categoryName === p.category)
          && (!s.filerScope || s.filerScope === outlet.filerStatus)
        )
        .sort((a, b) => b.value - a.value)
      const tierOf = (s: SchemeDTO) => (s.productId ? 0 : s.categoryName ? 1 : 2)
      const qualifiesBxGy = (s: SchemeDTO) => s.type === 'BUY_X_GET_Y' && s.buyQty > 0 && ctnEquiv >= s.buyQty
      // Task 57: har scheme ka APNA contribution — per-scheme chips/rows isi se bante hain
      const stackAgg: PreviewStackEntry[] = []
      for (let tier = 0; tier <= 2; tier++) {
        const tierSchemes = applicable.filter((s) => tierOf(s) === tier)
        const bx = tierSchemes.find(qualifiesBxGy)
        if (bx) {
          const given = Math.round(Math.floor(ctnEquiv / bx.buyQty) * bx.freeQty * upc)
          freeQty += given
          stackAgg.push({ id: bx.id, name: bx.name ?? 'Scheme', type: bx.type, amount: 0, freeGiven: given })
          continue
        }
        const money = tierSchemes.find((s) => s.type === 'PERCENT_DISCOUNT' || s.type === 'FLAT_DISCOUNT')
        if (money) {
          const amount = money.type === 'PERCENT_DISCOUNT'
            ? Math.round(ratePc * l.qtyPcs * (money.value / 100) * 100) / 100
            : Math.round(money.value * ctnEquiv * 100) / 100
          disc += amount
          stackAgg.push({ id: money.id, name: money.name ?? 'Scheme', type: money.type, amount, freeGiven: 0 })
        }
      }
      const gross = Math.round(ratePc * l.qtyPcs * 100) / 100
      // Task 45: GST per product (Products page ka rate — hardcoded nahi); TO discount ke ILAWA
      const gstRate = p.gstEnabled === false ? 0 : Math.max(0, Number(p.gstRate) || 0)
      const gstAmt = Math.round(Math.max(0, gross - disc) * (gstRate / 100) * 100) / 100
      const tradeOffer = Math.max(0, Math.round((parseFloat(l.tradeOffer) || 0) * 100) / 100)
      const lineTotal = gross - disc
      subtotal += gross
      discount += disc
      gstTotal += gstAmt
      toTotal += tradeOffer
      return { name: p.name, qtyPcs: l.qtyPcs, freeQty, discount: disc, total: lineTotal, gross, stack: stackAgg, ratePc, upc, pcsPerBox, tradeOffer, gstRate, gstAmt }
    })
    return { subtotal, discount, gstTotal: Math.round(gstTotal * 100) / 100, toTotal: Math.round(toTotal * 100) / 100, rows }
  }, [lines, products, schemes, outlet])

  // Task 57: footer summary ki per-scheme rows — jitni schemes utni rows (auto).
  // Σ per-scheme amounts == computed.discount (Pass On column) — reconciliation barkarar.
  const schemePromos = useMemo(() => {
    const map = new Map<string, { id: string; name: string; amount: number; freePcs: number }>()
    for (const r of computed.rows) {
      for (const s of r.stack) {
        let e = map.get(s.id)
        if (!e) { e = { id: s.id, name: s.name, amount: 0, freePcs: 0 }; map.set(s.id, e) }
        if (s.freeGiven > 0) e.freePcs += s.freeGiven
        else e.amount = Math.round((e.amount + s.amount) * 100) / 100
      }
    }
    return [...map.values()]
  }, [computed])

  // Manual discount (order-level) — server bhi yehi formula dobara calculate karta hai
  const discNum = parseFloat(discValue)
  const discInputValid = Number.isFinite(discNum) && discNum > 0 && (discType === 'FLAT' || discNum <= 100)
  const manualDiscount = useMemo(() => {
    if (discType === 'NONE' || !discInputValid) return 0
    const raw = discType === 'PERCENT'
      ? Math.round(computed.subtotal * (discNum / 100) * 100) / 100
      : Math.round(discNum * 100) / 100
    return Math.round(Math.min(raw, Math.max(0, computed.subtotal - computed.discount)) * 100) / 100
  }, [discType, discNum, discInputValid, computed])
  const netTotal = Math.max(0, computed.subtotal - computed.discount - manualDiscount)

  // ---- Task 52: MANUAL DISCOUNT = PASS ON MERGE (server applyManualMerge ka client mirror) ----
  // Manual ko rows mein pro-rata (by net) tor kar har line par lagao — preview ke numbers
  // booked bill se EXACT match: Pass On (scheme + manual), Net, aur GST merged net par.
  const merged = useMemo(() => {
    const shares = splitManualByNet(computed.rows.map((r) => r.total), manualDiscount)
    let gstTotal = 0
    const rows = computed.rows.map((r, i) => {
      const manualShare = shares[i]
      const total = Math.round(Math.max(0, r.total - manualShare) * 100) / 100
      const gstAmt = r.gstRate > 0 ? Math.round(total * (r.gstRate / 100) * 100) / 100 : 0
      gstTotal += gstAmt
      return { ...r, manualShare, total, gstAmt }
    })
    return { rows, gstTotal: Math.round(gstTotal * 100) / 100 }
  }, [computed, manualDiscount])

  // Advance Tax live preview (bill par ADD hota hai) — shop ke filer status + settings rate se (server bhi yehi karta hai)
  const advTaxPreview = useMemo(() => {
    if (!outlet || !taxRates || netTotal <= 0) return 0
    const rate = outlet.filerStatus === 'FILER' ? taxRates.filer : taxRates.nonFiler
    return Math.round(netTotal * rate / 100 * 100) / 100
  }, [outlet, taxRates, netTotal])

  // Task 45: Grand payable = goods net − trade offer + GST + advance tax (purchase invoice chain)
  // Task 52: GST merged (manual ke baad wale) net par — jaisa server book karta hai
  const grandPayable = Math.round((netTotal - merged.rows.reduce((s, r) => s + r.tradeOffer, 0) + merged.gstTotal + advTaxPreview) * 100) / 100

  function deleteDiscount() {
    setDiscType('NONE')
    setDiscValue('')
  }

  async function save() {
    if (!outletId || lines.length === 0) {
      toast({ title: 'Missing info', description: 'Outlet aur kam az kam 1 product select karein', variant: 'destructive' })
      return
    }
    if (lines.some((l) => l.qtyPcs <= 0)) {
      toast({ title: 'Qty 0 hai', description: 'Har line mein Ctn/Box/Pcs mein kuch quantity enter karein', variant: 'destructive' })
      return
    }
    if (!bookerId) {
      toast({ title: 'Order Booker select karein', description: 'Bill kis order booker ka hai — pehle select karein', variant: 'destructive' })
      return
    }
    if (discType !== 'NONE' && !discInputValid) {
      toast({ title: 'Discount value galat hai', description: discType === 'PERCENT' ? 'Percentage 0 se 100 ke darmiyan ho' : 'Flat amount 0 se bara hona chahiye', variant: 'destructive' })
      return
    }
    // Task 45: Trade Offer validation — line ke net total se zyada nahi (server bhi check karta hai)
    // Task 52: merged net ke against (manual discount ke baad) — server bhi wahi karta hai
    const badTo = merged.rows.findIndex((r) => r.tradeOffer > r.total)
    if (badTo >= 0) {
      toast({ title: 'Trade Offer galat hai', description: `${merged.rows[badTo].name}: Rs ${merged.rows[badTo].tradeOffer} line total Rs ${merged.rows[badTo].total} se zyada nahi ho sakta`, variant: 'destructive' })
      return
    }
    // Task 26: STOCK LIMIT — available stock se zyada booking UI par bhi block (server bhi check karta hai)
    const overLines = lines.filter((l) => {
      const p = products.find((x) => x.id === l.productId)
      return p ? l.qtyPcs > p.available : false
    })
    if (overLines.length > 0) {
      const names = overLines.slice(0, 2).map((l) => products.find((x) => x.id === l.productId)?.name ?? '').filter(Boolean).join(', ')
      toast({ title: 'Stock limit crossed', description: `${names}${overLines.length > 2 ? ` +${overLines.length - 2} aur` : ''} — available stock se zyada book nahi ho sakta`, variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      // 3-unit split: qtyPcs -> ctn/box/pcs (server dobara verify karta hai) + per-SKU trade offer
      const items = lines.map((l) => {
        const p = products.find((x) => x.id === l.productId)
        const upc = Math.max(1, p?.unitsPerCarton ?? 1)
        const ppb = p?.pcsPerBox && p.pcsPerBox > 0 ? p.pcsPerBox : 0
        const s = splitPcs(l.qtyPcs, upc, ppb)
        return { productId: l.productId, ctn: s.ctn, box: s.box, pcs: s.pcs, tradeOffer: Math.max(0, parseFloat(l.tradeOffer) || 0) }
      })
      const res = await api<{ order: { orderNo: string; total: number; payable?: number } }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          outletId, salesmanId: bookerId, items, notes,
          discount: discType !== 'NONE' && discInputValid ? { type: discType, value: discNum } : undefined,
        }),
      })
      toast({ title: `Order ${res.order.orderNo} Booked ✓`, description: `Booker: ${booker?.name ?? ''} • Payable: ${fmtPKR(res.order.payable ?? res.order.total)}${manualDiscount > 0 ? ` (manual disc ${fmtPKR(manualDiscount)})` : ''}${computed.toTotal > 0 ? ` • TO ${fmtPKR(computed.toTotal)}` : ''}` })
      onOpenChange(false)
      onCreated()
    } catch (e) {
      toast({ title: 'Order Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-emerald-600" /> New Order Booking</DialogTitle>
          <DialogDescription>Outlet select karein — schemes order time par auto-apply hongi</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 overflow-y-auto pr-1">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Order Booker <span className="text-red-500">*</span></Label>
              <Select value={bookerId} onValueChange={setBookerId}>
                <SelectTrigger className={bookerId ? 'border-emerald-300' : 'border-amber-300'}><SelectValue placeholder="Bill kis order booker ka?" /></SelectTrigger>
                <SelectContent>
                  {salesmen.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}{s.region ? ` — ${s.region}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {booker && (
                <p className="text-[11px] text-emerald-700 font-medium">✓ Ye bill <b>{booker.name}</b> ke booker account par book ho raha hai</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Outlet</Label>
              <Select value={outletId} onValueChange={selectOutlet}>
                <SelectTrigger><SelectValue placeholder="Select outlet" /></SelectTrigger>
                <SelectContent>
                  {outlets.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name} — {o.channel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {outlet && (
              <div className="sm:col-span-2 text-xs text-slate-500 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                <span className="font-semibold text-emerald-700">{outlet.channel}</span> channel • Credit {outlet.creditDays} days • Route: {booker?.name ?? outlet.salesmanName ?? '—'}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Order Lines</Label>
              <Button size="sm" variant="outline" onClick={addLine} className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Product
              </Button>
            </div>
            {lines.length === 0 && (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-400">
                &quot;Add Product&quot; se order lines shuru karein
              </div>
            )}
            {computed.rows.map((r, i) => {
              const mr = merged.rows[i]
              const lineProduct = products.find((x) => x.id === lines[i]?.productId)
              return (
              <div key={i} className="rounded-lg border p-3 space-y-2 bg-slate-50/50">
                {/* Task 46: Trade Offer UPPER bill row ka COLUMN hai (invoice PDF ke table jaisa) — neeche sub-row me nahi */}
                <div className="flex flex-wrap gap-2 items-start">
                  <Select
                    value={lines[i]?.productId}
                    onValueChange={(v) => {
                      const next = [...lines]
                      const np = products.find((x) => x.id === v)
                      next[i] = { ...next[i], productId: v, qtyPcs: Math.max(1, np?.unitsPerCarton ?? 1), tradeOffer: '' }
                      setLines(next)
                    }}
                  >
                    <SelectTrigger className="flex-1 h-9 min-w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => {
                        const used = lines.some((l, j) => j !== i && l.productId === p.id)
                        const availCtn = p.available / Math.max(1, p.unitsPerCarton)
                        return (
                          <SelectItem key={p.id} value={p.id} disabled={used || p.available <= 0}>
                            {p.name} — {fmtPKR(p.tradePrice)}/crtn ({p.unitsPerCarton} pcs)
                            {used ? ' • pehle se add' : p.available <= 0 ? ' • out of stock' : ` • avail ${availCtn.toFixed(2)} ctn`}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  <UnitQtyInputs
                    pcs={lines[i]?.qtyPcs ?? 0}
                    upc={lineProduct ? Math.max(1, lineProduct.unitsPerCarton) : 1}
                    pcsPerBox={lineProduct?.pcsPerBox && lineProduct.pcsPerBox > 0 ? lineProduct.pcsPerBox : 0}
                    onChange={(totalPcs) => {
                      const next = [...lines]
                      next[i] = { ...next[i], qtyPcs: totalPcs }
                      setLines(next)
                    }}
                  />
                  <div className="flex flex-col items-center gap-0.5">
                    <Input
                      type="number" min={0} step="0.01" inputMode="decimal"
                      value={lines[i]?.tradeOffer ?? ''}
                      onChange={(e) => {
                        const next = [...lines]
                        next[i] = { ...next[i], tradeOffer: e.target.value }
                        setLines(next)
                      }}
                      placeholder="0"
                      aria-label="Trade Offer Rs"
                      className="h-9 w-24 text-center border-violet-200 focus-visible:ring-violet-300"
                    />
                    <span className="text-[9px] leading-none text-violet-500 font-medium flex items-center gap-0.5"><Gift className="h-2.5 w-2.5" />Trade Offer</span>
                  </div>
                  <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-red-400" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
                {/* Task 46: chain invoice PDF ke column order me — Gross → Pass On → Net → GST → Trade Offer → Line payable */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                  {lineProduct && <span className="text-slate-400 whitespace-nowrap">{packHint(lineProduct.unitsPerCarton, lineProduct.boxesPerCarton, lineProduct.pcsPerBox)} • {fmtPKR(r.ratePc)}/pc</span>}
                  <span className="text-slate-500 whitespace-nowrap">Gross <b className="text-slate-600">{fmtPKR(r.gross)}</b></span>
                  {/* Task 57: HAR promotion apni chip — combined Pass On chip nahi.
                     Σ per-scheme amounts + Manual == bill ke Pass On column ka total */}
                  {r.stack.filter((s) => s.amount > 0).map((s) => (
                    <span key={`m-${s.id}`} className="text-emerald-600 font-medium whitespace-nowrap">🎁 {s.name} − {fmtPKR(s.amount)}</span>
                  ))}
                  {r.stack.filter((s) => s.freeGiven > 0).map((s) => (
                    <span key={`f-${s.id}`} className="text-emerald-600 font-semibold whitespace-nowrap">🎁 {s.name} +{fmtQty(s.freeGiven, r.upc, r.pcsPerBox)} FREE</span>
                  ))}
                  {(mr?.manualShare ?? 0) > 0 && <span className="text-amber-600 font-medium whitespace-nowrap">Manual − {fmtPKR(mr!.manualShare)}</span>}
                  <span className="text-slate-500 whitespace-nowrap">Net <b className="text-slate-700">{fmtPKR(mr?.total ?? r.total)}</b></span>
                  {(mr?.gstAmt ?? r.gstAmt) > 0 ? (
                    <span className="text-blue-600 font-medium whitespace-nowrap">GST {r.gstRate}% + {fmtPKR(mr?.gstAmt ?? r.gstAmt)}</span>
                  ) : (
                    <span className="text-slate-400 whitespace-nowrap">GST nahi lagta</span>
                  )}
                  {r.tradeOffer > 0 && <span className="text-violet-600 font-semibold whitespace-nowrap">TO − {fmtPKR(r.tradeOffer)}</span>}
                  <span className="text-slate-500 ml-auto whitespace-nowrap">Line payable: <b className="text-slate-700">{fmtPKR(Math.max(0, Math.round(((mr?.total ?? r.total) - r.tradeOffer + (mr?.gstAmt ?? r.gstAmt)) * 100) / 100))}</b></span>
                </div>
                {/* Task 26: available stock guard — requested qty available se bara ho to red warning */}
                {lineProduct && (
                  (lines[i]?.qtyPcs ?? 0) > lineProduct.available ? (
                    <p className="text-[11px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                      Stock limit: sirf {fmtQty(lineProduct.available, Math.max(1, lineProduct.unitsPerCarton), lineProduct.pcsPerBox > 0 ? lineProduct.pcsPerBox : 0)} available hai — is line ko kam karein
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400">Available: <span className="font-semibold text-emerald-700">{fmtQty(lineProduct.available, Math.max(1, lineProduct.unitsPerCarton), lineProduct.pcsPerBox > 0 ? lineProduct.pcsPerBox : 0)}</span> (open bills ke baad bacha hua stock)</p>
                  )
                )}
              </div>
              )
            })}
          </div>

          {/* Manual Discount — % ya flat Rs; scheme ke ilawa order-level */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-white">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-slate-700"><Percent className="h-3.5 w-3.5 text-emerald-600" /> Discount (optional)</Label>
              {(discType !== 'NONE' || discValue) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={deleteDiscount}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Delete Discount
                </Button>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={discType} onValueChange={(v) => setDiscType(v as DiscType)}>
                <SelectTrigger className="sm:w-44 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No Discount</SelectItem>
                  <SelectItem value="PERCENT">Percentage (%)</SelectItem>
                  <SelectItem value="FLAT">Flat (Rs)</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number" min={0} step="0.01"
                disabled={discType === 'NONE'}
                value={discValue}
                onChange={(e) => setDiscValue(e.target.value)}
                placeholder={discType === 'FLAT' ? 'e.g. 500' : 'e.g. 5'}
                className="h-9 flex-1"
              />
              {manualDiscount > 0 && (
                <div className="flex items-center h-9 px-3 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 whitespace-nowrap">
                  <b>- {fmtPKR(manualDiscount)}</b>
                  {discType === 'PERCENT' && <span className="text-[11px] ml-1">({discValue}% of subtotal)</span>}
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-400">Scheme discount ke <b>ilawa</b> pura order par lagta hai — invoice ke Discount Summary mein alag row aati hai aur Pass On column mein merge hoti hai (GST naye net par)</p>
          </div>

          <div className="grid gap-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery instructions..." rows={2} />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2 items-stretch sm:items-center border-t pt-3">
          <div className="flex-1 text-sm space-y-0.5">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtPKR(computed.subtotal)}</span></div>
            {schemePromos.map((p) => (
              <div key={p.id} className="flex justify-between text-emerald-600 font-medium">
                <span>🎁 {p.name}</span>
                <span>{p.freePcs > 0 ? `+${p.freePcs} Pcs Free` : `- ${fmtPKR(p.amount)}`}</span>
              </div>
            ))}
            {manualDiscount > 0 && <div className="flex justify-between text-emerald-600 font-medium"><span>Manual Discount</span><span>- {fmtPKR(manualDiscount)}</span></div>}
            <div className="flex justify-between font-bold text-slate-900"><span>Net Total</span><span>{fmtPKR(netTotal)}</span></div>
            {merged.gstTotal > 0 && <div className="flex justify-between text-blue-600 font-medium"><span>GST (Sales Tax)</span><span>+ {fmtPKR(merged.gstTotal)}</span></div>}
            {computed.toTotal > 0 && <div className="flex justify-between text-violet-600 font-medium"><span>Trade Offer</span><span>- {fmtPKR(computed.toTotal)}</span></div>}
            {outlet && taxRates && advTaxPreview > 0 && (
              <div className="flex justify-between text-blue-600"><span>Advance Tax ({outlet.filerStatus === 'FILER' ? `Filer ${taxRates.filer}` : `Non-Filer ${taxRates.nonFiler}`}%)</span><span>+ {fmtPKR(advTaxPreview)}</span></div>
            )}
            {(computed.toTotal > 0 || merged.gstTotal > 0 || advTaxPreview > 0) && (
              <div className="flex justify-between font-bold text-emerald-700 border-t border-slate-200 pt-1"><span>Total Payable</span><span>{fmtPKR(grandPayable)}</span></div>
            )}
          </div>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Book Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
