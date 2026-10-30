'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate, STATUS_STYLES, statusLabel } from '@/lib/dms-api'
import type { OrderDTO, OrderItemDTO } from '@/lib/dms-types'
import { fmtQty } from '@/components/dms/unit-qty'
import { PrintFrame, CblInvoiceDoc, keepDialogBehind, type InvoiceData } from '@/components/dms/cbl-print'
import { orderGrandPayable, aggregateSchemePromos } from '@/lib/dms-order-calc'
import { Plus, Eye, XCircle, Search, ShoppingCart, Printer, Lock } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export function OrdersView() {
  const user = useDMS((s) => s.user)
  const router = useRouter()
  const [orders, setOrders] = useState<OrderDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<OrderDTO | null>(null)
  const [detailItems, setDetailItems] = useState<OrderItemDTO[] | null>(null)

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
        <Button onClick={() => router.push('/orders/new')} className="bg-emerald-600 hover:bg-emerald-700">
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
                    <TableHead className="text-right">Total Payable</TableHead>
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
                      <TableCell className="text-right">
                        {/* Task 77: list par bill ka FINAL amount (Total Payable = Net − TO + GST + Adv Tax) —
                            pehle sirf goods net (o.total) dikhta tha jo bill ke aakhir ke Net Amount se kam lagta tha;
                            neeche chhota sub-line goods net bhi dikhata hai jab taxes/TO mojood hon */}
                        <p className="font-semibold text-slate-900 whitespace-nowrap">{fmtPKR(orderGrandPayable(o))}</p>
                        {(o.gstTotal ?? 0) > 0 || (o.tradeOfferTotal ?? 0) > 0 || (o.advanceTax ?? 0) > 0 ? (
                          <p className="text-[10px] text-slate-400 whitespace-nowrap">Net {fmtPKR(o.total)}</p>
                        ) : null}
                      </TableCell>
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

  // Task 34: PROCESS-PEHLE-PRINT — user directive: "bill ko process kiye bagair print nai
  // nikal saktein". CONFIRMED = unprocessed (Unprocessed Bills mein van-out hona baqi),
  // CANCELLED = dead bill — dono par print LOCK. Processed = PROCESSING / PARTIALLY_DELIVERED /
  // DELIVERED — print allowed. Un-process (revert) par print dobara lock ho jata hai.
  const canPrint = !!order && order.status !== 'CONFIRMED' && order.status !== 'CANCELLED'

  // Task 26-b: screen ladder bhi print (cbl-print) jaisa mode-aware — INVOICE_DISCOUNT order
  // par Noms/SalesFlo ladder (Trade Offer GST se PEHLE minus dikhta hai). Numbers pehle se
  // sahi the (Task 26 calc) — sirf presentation ka tarteeb yahan fix ho rahi hai.
  const detailModeA = order?.taxMode === 'INVOICE_DISCOUNT'

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
                {/* Task 108: kaunsa TAX SYSTEM is bill par laga — snapshot se, zuban ke sath */}
                <Badge variant="outline" className={`text-[9px] ${detailModeA ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                  {order.taxMode === 'MIXED'
                    ? 'Tax: Mixed (per-line)'
                    : detailModeA
                      ? 'Tax: Invoice Discount (Noms)'
                      : 'Tax: Claim (GST pehle)'}
                </Badge>
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
              {/* Task 26-b: ladder mode-aware (print jaisa) — INVOICE_DISCOUNT = Noms ladder */}
              {detailModeA && (order.tradeOfferTotal ?? 0) > 0 && (
                <div className="flex justify-between gap-3 text-sm text-violet-600">
                  <span>Less: Trade Offer (GST se pehle)</span>
                  <span className="whitespace-nowrap tabular-nums">- {fmtPKR(order.tradeOfferTotal ?? 0)}</span>
                </div>
              )}
              {(order.gstTotal ?? 0) > 0 && (
                <div className="flex justify-between gap-3 text-sm text-blue-600">
                  <span>{detailModeA ? 'Sales Tax (GST)' : 'GST (Sales Tax)'}</span>
                  <span className="whitespace-nowrap tabular-nums">+ {fmtPKR(order.gstTotal ?? 0)}</span>
                </div>
              )}
              {!detailModeA && (order.tradeOfferTotal ?? 0) > 0 && (
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
              {/* Task 102: shop ka khata bill par — purana udhaar + return advance auto-adjust */}
              {invData && (invData.prevBalance ?? 0) > 0.005 && (
                <div className="flex justify-between gap-3 text-sm text-orange-600">
                  <span>Previous Balance (shop ka purana udhaar)</span>
                  <span className="whitespace-nowrap tabular-nums">+ {fmtPKR(invData.prevBalance ?? 0)}</span>
                </div>
              )}
              {invData && (invData.advanceApplied ?? 0) > 0.005 && (
                <div className="text-sm text-emerald-600">
                  <div className="flex justify-between gap-3">
                    <span>Claim Adjustment (return ka claim is bill se)</span>
                    <span className="whitespace-nowrap tabular-nums">- {fmtPKR(invData.advanceApplied ?? 0)}</span>
                  </div>
                  {invData.advanceAppliedNote && (
                    <p className="text-[10px] text-emerald-500 text-right">{invData.advanceAppliedNote}</p>
                  )}
                </div>
              )}
              {invData && ((invData.prevBalance ?? 0) > 0.005 || (invData.advanceApplied ?? 0) > 0.005) && (
                <div className="flex justify-between gap-3 font-bold text-slate-900 border-t pt-1.5">
                  <span>Grand Net Total (bill + purana balance − advance)</span>
                  <span className="whitespace-nowrap tabular-nums">
                    {fmtPKR(Math.round((orderGrandPayable(order) + (invData.prevBalance ?? 0) - Math.min(invData.advanceApplied ?? 0, orderGrandPayable(order))) * 100) / 100)}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 border-t pt-3 shrink-0">
              {/* Task 34: print restriction note — process se pehle print locked */}
              {order && !canPrint && (
                <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 flex items-center gap-1.5 text-right">
                  <Lock className="h-3 w-3 shrink-0" />
                  {order.status === 'CANCELLED'
                    ? 'Bill cancel ho chuka hai — print locked'
                    : 'Bill process nahi hua — pehle Unprocessed Bills se process karein, phir print hogi'}
                </p>
              )}
              <Button disabled={!invData || !canPrint} title={canPrint ? 'Invoice print / export karein' : 'Print locked — bill pehle process hona zaroori hai'}
                className="bg-slate-800 hover:bg-slate-900 text-white" onClick={() => setPrinting(true)}>
                <Printer className="h-4 w-4 mr-1.5" /> Print / Export Invoice
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>

    {/* Task 59: invoice PORTRAIT A4 (landscape prop hataya) */}
    {printing && invData && (
      <PrintFrame title={`Invoice ${invData.orderNo}`} onClose={() => setPrinting(false)}>
        <CblInvoiceDoc inv={invData} gst={gst ?? undefined} />
      </PrintFrame>
    )}
    </>
  )
}
