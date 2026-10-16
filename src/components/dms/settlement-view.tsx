'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate, STATUS_STYLES, statusLabel } from '@/lib/dms-api'
import type { SummaryDTO, SummaryDetailDTO, SummaryOrderDTO } from '@/lib/dms-types'
import { UnitQtyInputs, fmtQty } from '@/components/dms/unit-qty'
import { PrintFrame, CblSettlementDoc } from '@/components/dms/cbl-print'
import { Wallet, Loader2, CheckCircle2, History, PackageOpen, Undo2, ReceiptText } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface SettleRow { cash: string }
interface ReturnDraft { reason: string; qtys: Record<string, number> }

const REASON_LABELS: Record<string, string> = {
  UNSOLD: 'Unsold (shop ne wapas kiya)',
  DAMAGED: 'Damaged',
  EXPIRED: 'Expired',
}

/** Task 29: return par tax PRO-RATA reversal — jitna % goods wapas, utna tax reverse */
function proRata(full: number, bill: number, returnValue: number): { eff: number; reversal: number } {
  if (full <= 0 || bill <= 0 || returnValue <= 0) return { eff: Math.round(full * 100) / 100, reversal: 0 }
  const reversal = Math.min(Math.round((full * returnValue / bill) * 100) / 100, full)
  return { eff: Math.round((full - reversal) * 100) / 100, reversal }
}

/** Task 45: Grand payable parts — goods − return + GST − trade offer + adv tax (pro-rata reversals ke saath).
 * Booking chain (purchase invoice jaisa) settlement tak consistent. */
function orderNetPayable(o: { total: number; gstTotal?: number | null; tradeOfferTotal?: number | null; advanceTax?: number | null }, returnValue: number) {
  const gst = proRata(o.gstTotal ?? 0, o.total, returnValue)
  const to = proRata(o.tradeOfferTotal ?? 0, o.total, returnValue)
  const tax = proRata(o.advanceTax ?? 0, o.total, returnValue)
  const net = Math.round((o.total - returnValue + gst.eff - to.eff + tax.eff) * 100) / 100
  return { net, gst: gst.eff, gstRev: gst.reversal, to: to.eff, toRev: to.reversal, tax: tax.eff, taxRev: tax.reversal }
}

/** Task 63: return value bill ke ACTUAL per-pc rate par — lineTotal/qty (scheme + manual
 * discount merge hone ke baad ka net). Pehle trade price (rate) use hota tha — discount wale
 * bill ka full return bill se ZYADA credit karta tha => NET PAYABLE MINUS ho jata tha. */
function effRateOf(it: { qty: number; rate: number; lineTotal: number }) {
  return it.qty > 0 ? it.lineTotal / it.qty : it.rate
}

/** Per-invoice stock return dialog: item-wise qty (Ctn/Box/Pcs) + reason → net payable auto-calculate */
function ReturnDialog({ order, initial, onConfirm, onClose }: {
  order: SummaryOrderDTO
  initial?: ReturnDraft
  onConfirm: (draft: ReturnDraft) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState(initial?.reason ?? 'UNSOLD')
  // qtys = total PIECES per product (Ctn/Box/Pcs inputs se banta hai)
  const [qtys, setQtys] = useState<Record<string, number>>(initial?.qtys ?? {})
  // Task 63: per-bill toggle — har bill ka apna (dialog instance state, key={order.id})
  const [fullBill, setFullBill] = useState(false)

  const retQty = order.items.reduce((s, it) => s + (qtys[it.productId] ?? 0), 0)
  const retValue = Math.round(order.items.reduce((s, it) => s + (qtys[it.productId] ?? 0) * effRateOf(it), 0) * 100) / 100
  const parts = orderNetPayable(order, retValue)
  const net = parts.net

  function setQty(productId: string, totalPcs: number) {
    setFullBill(false)
    setQtys({ ...qtys, [productId]: Math.max(0, Math.floor(totalPcs || 0)) })
  }

  function toggleFullBill(on: boolean) {
    setFullBill(on)
    if (on) setQtys(Object.fromEntries(order.items.map((it) => [it.productId, it.qty])))
    else setQtys({})
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col gap-3 sm:gap-4 p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5 text-orange-500" />
            Stock Return — {order.outletName}
          </DialogTitle>
          <p className="text-xs text-slate-500 font-normal">{order.orderNo} • Bill {fmtPKR(order.total)} — wapas items ki qty (Ctn/Box/Pcs) enter karein</p>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <p className="text-xs font-semibold text-slate-500 uppercase w-24 shrink-0">Return Reason</p>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-8 w-full sm:w-64 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Task 63: PURA BILL RETURN toggle — har bill ka apna (ek click mein saary items full qty wapas) */}
          <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2">
            <Switch checked={fullBill} onCheckedChange={toggleFullBill} id={`full-ret-${order.id}`} />
            <label htmlFor={`full-ret-${order.id}`} className="text-sm font-semibold text-slate-700 cursor-pointer select-none">
              Pura Bill Return — saary items poori qty wapas (ek click)
            </label>
            <span className="ml-auto text-xs text-orange-700 font-bold">Bill: {fmtPKR(order.total)}</span>
          </div>

          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow className="bg-slate-50/70">
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Rate/pc</TableHead>
                  <TableHead className="text-center">Return Qty</TableHead>
                  <TableHead className="text-right">Return Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((it) => {
                  const q = qtys[it.productId] ?? 0
                  return (
                    <TableRow key={it.id}>
                      <TableCell>
                        <p className="text-sm font-medium text-slate-800">{it.productName}</p>
                        <p className="text-[10px] text-slate-400">{it.sku}{it.freeQty > 0 ? ` • ${fmtQty(it.freeQty, it.unitsPerCarton, it.pcsPerBox)} free` : ''}</p>
                      </TableCell>
                      <TableCell className="text-right text-sm whitespace-nowrap">{fmtQty(it.qty, it.unitsPerCarton, it.pcsPerBox)}</TableCell>
                      <TableCell className="text-right text-sm whitespace-nowrap">
                        {fmtPKR(effRateOf(it))}
                        {it.rate !== effRateOf(it) && <span className="ml-1 text-[10px] text-slate-400 line-through">{fmtPKR(it.rate)}</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <UnitQtyInputs
                            pcs={q}
                            upc={Math.max(1, it.unitsPerCarton)}
                            pcsPerBox={it.pcsPerBox > 0 ? it.pcsPerBox : 0}
                            maxPcs={it.qty}
                            inputW="w-12"
                            onChange={(totalPcs) => setQty(it.productId, totalPcs)}
                          />
                        </div>
                      </TableCell>
                      <TableCell className={`text-right text-sm font-semibold ${q > 0 ? 'text-orange-600' : 'text-slate-300'}`}>
                        {q > 0 ? fmtPKR(Math.round(q * effRateOf(it) * 100) / 100) : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end gap-6 text-sm pr-1">
            <div className="text-right">
              <p className="text-[11px] text-slate-400 uppercase">Return Value</p>
              <p className="font-bold text-orange-600 whitespace-nowrap tabular-nums">{fmtPKR(retValue)}</p>
            </div>
            {parts.gstRev > 0 && (
              <div className="text-right">
                <p className="text-[11px] text-slate-400 uppercase">GST</p>
                <p className="font-bold text-blue-600 whitespace-nowrap tabular-nums">{fmtPKR(parts.gst)} <span className="text-[10px] font-medium">(− {fmtPKR(parts.gstRev)})</span></p>
              </div>
            )}
            {parts.toRev > 0 && (
              <div className="text-right">
                <p className="text-[11px] text-slate-400 uppercase">Trade Offer</p>
                <p className="font-bold text-violet-600 whitespace-nowrap tabular-nums">− {fmtPKR(parts.to)} <span className="text-[10px] font-medium">(+ {fmtPKR(parts.toRev)} wapas)</span></p>
              </div>
            )}
            {parts.taxRev > 0 && (
              <div className="text-right">
                <p className="text-[11px] text-slate-400 uppercase">Adv Tax</p>
                <p className="font-bold text-blue-600 whitespace-nowrap tabular-nums">{fmtPKR(parts.tax)} <span className="text-[10px] font-medium">(− {fmtPKR(parts.taxRev)})</span></p>
              </div>
            )}
            <div className="text-right">
              <p className="text-[11px] text-slate-400 uppercase">Net Payable</p>
              <p className="font-bold text-emerald-700 text-lg whitespace-nowrap tabular-nums">{fmtPKR(net)}</p>
            </div>
          </div>
          {(parts.gstRev > 0 || parts.taxRev > 0 || parts.toRev > 0) && (
            <p className="text-[11px] text-slate-500 text-right pr-1">GST / Advance tax bhi return ke hisaab se kam ho gaya — returned goods par dobara tax nahi lagega{parts.toRev > 0 ? '; Trade Offer bhi returned goods ka wapas le liya gaya' : ''}</p>
          )}
          {retQty > 0 && Math.abs(net) < 0.01 && (
            <p className="text-[11px] font-semibold text-emerald-700 text-right pr-1">Poora bill wapas — is bill ka koi bakaya nahi bacha ✓</p>
          )}
          <p className="text-[10px] text-slate-400 text-right pr-1">Rate/pc bill ka actual rate hai (scheme + manual discount ke baad) — return isi par hota hai</p>
        </div>
        </div>

        <DialogFooter className="shrink-0 border-t pt-3 gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-orange-500 hover:bg-orange-600 text-white" disabled={retQty === 0}
            onClick={() => onConfirm({ reason, qtys })}>
            <Undo2 className="h-4 w-4 mr-1.5" />
            Apply Return ({retQty} pcs — {fmtPKR(retValue)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Late Stock Return — SETTLED summary ke bill par return (ghalti se settlement ke waqt
 * return reh gaya ho). SaleReturn + stock wapas + shop ledger CREDIT => shop ka balance
 * cum ho jata hai. Cap: per product billed - pehle se returned (settlement + late).
 */
function LateReturnDialog({ summaryId, onClose, onDone }: {
  summaryId: string
  onClose: () => void
  onDone: (summaryId: string) => void
}) {
  const user = useDMS((s) => s.user)
  const [detail, setDetail] = useState<SummaryDetailDTO | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [orderId, setOrderId] = useState('')
  const [reason, setReason] = useState('UNSOLD')
  const [qtys, setQtys] = useState<Record<string, number>>({})
  // Task 63: per-bill full return toggle
  const [fullBill, setFullBill] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await api<{ summary: SummaryDetailDTO }>(`/api/summaries/${summaryId}`)
        if (!alive) return
        setDetail(r.summary)
        // pehla bill jis par kuch returnable bacha ho, warna pehla bill
        const remain = (o: SummaryOrderDTO) => o.items.reduce((s, it) => {
          const done = (o.returns ?? []).reduce((s2, rt) => s2 + (rt.items ?? []).reduce((s3, rit) => s3 + (rit.productId === it.productId ? rit.qty : 0), 0), 0)
          return s + Math.max(0, it.qty - done)
        }, 0)
        const first = r.summary.orders.find((o) => remain(o) > 0) ?? r.summary.orders[0]
        if (first) setOrderId(first.id)
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : 'Detail load failed')
      }
    })()
    return () => { alive = false }
  }, [summaryId])

  const order = detail?.orders.find((o) => o.id === orderId) ?? null

  // per-product already returned (settlement + late, sab returns)
  const returnedMap: Record<string, number> = {}
  if (order) {
    for (const rt of order.returns ?? []) {
      for (const rit of rt.items ?? []) {
        if (rit.productId) returnedMap[rit.productId] = (returnedMap[rit.productId] ?? 0) + rit.qty
      }
    }
  }
  const remainOf = (productId: string, billed: number) => Math.max(0, billed - (returnedMap[productId] ?? 0))
  const orderRemain = order ? order.items.reduce((s, it) => s + remainOf(it.productId, it.qty), 0) : 0
  const retQty = order ? order.items.reduce((s, it) => s + (qtys[it.productId] ?? 0), 0) : 0
  const retValue = order ? Math.round(order.items.reduce((s, it) => s + (qtys[it.productId] ?? 0) * effRateOf(it), 0) * 100) / 100 : 0
  const overCap = order ? order.items.some((it) => (qtys[it.productId] ?? 0) > remainOf(it.productId, it.qty)) : false

  function setQty(productId: string, totalPcs: number) {
    setFullBill(false)
    setQtys({ ...qtys, [productId]: Math.max(0, Math.floor(totalPcs || 0)) })
  }

  function toggleFullBill(on: boolean) {
    setFullBill(on)
    if (!order) return
    if (on) setQtys(Object.fromEntries(order.items.map((it) => [it.productId, remainOf(it.productId, it.qty)])))
    else setQtys({})
  }

  async function apply() {
    if (!order || retQty === 0 || overCap) return
    setSaving(true)
    try {
      const items = order.items
        .map((it) => ({ productId: it.productId, qty: qtys[it.productId] ?? 0 }))
        .filter((x) => x.qty > 0)
      const r = await api<{ return: { returnNo: string; totalValue: number; taxReversal?: number; outletName: string; creditAmount: number } }>(
        `/api/summaries/${summaryId}/late-return`,
        { method: 'POST', body: JSON.stringify({ userId: user?.id, orderId: order.id, reason, items }) },
      )
      toast({
        title: `Late Return ${r.return.returnNo} ✓`,
        description: `${r.return.outletName}: ${fmtPKR(r.return.totalValue)} wapas${r.return.taxReversal ? ` + adv tax ${fmtPKR(r.return.taxReversal)} reversal` : ''} — stock warehouse mein, shop balance cum ho gaya${r.return.creditAmount < 0 ? ` (ab shop ko ${fmtPKR(Math.abs(r.return.creditAmount))} wapas karne hain)` : ''}`,
      })
      onDone(summaryId)
    } catch (e) {
      toast({ title: 'Late Return Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col gap-3 sm:gap-4 p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5 text-orange-500" />
            Late Stock Return{detail ? ` — ${detail.summaryNo}` : ''}
          </DialogTitle>
          <p className="text-xs text-slate-500 font-normal">
            Settled summary ka return — items stock mein wapas + shop ka balance (ledger) adjust ho jayega
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-3">
            {loadErr && <p className="text-sm text-red-600">{loadErr}</p>}
            {!detail && !loadErr && <Skeleton className="h-40 w-full" />}
            {detail && order && (
              <>
                {detail.orders.length > 1 && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase w-24 shrink-0">Bill</p>
                    <Select value={orderId} onValueChange={(v) => { setOrderId(v); setQtys({}) }}>
                      <SelectTrigger className="h-8 w-full sm:w-80 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {detail.orders.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.outletName} — {o.orderNo} ({fmtPKR(o.total)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">{order.outletName}</span> • {order.orderNo} • Bill {fmtPKR(order.total)}
                  {orderRemain === 0
                    ? <span className="block mt-0.5 text-emerald-700 font-medium">Is bill ka poora stock wapas ho chuka hai ✓</span>
                    : <span className="block mt-0.5">Returnable bacha hua: <span className="font-semibold text-orange-700">{orderRemain} pcs</span></span>}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase w-24 shrink-0">Return Reason</p>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger className="h-8 w-full sm:w-64 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(REASON_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Task 63: PURA BILL RETURN toggle — har bill ka apna (bacha hua poora stock ek click mein wapas) */}
                <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2">
                  <Switch checked={fullBill} onCheckedChange={toggleFullBill} id={`full-late-ret-${order?.id ?? 'x'}`} />
                  <label htmlFor={`full-late-ret-${order?.id ?? 'x'}`} className="text-sm font-semibold text-slate-700 cursor-pointer select-none">
                    Pura Bill Return — bacha hua poora stock wapas (ek click)
                  </label>
                  <span className="ml-auto text-xs text-orange-700 font-bold">Returnable: {orderRemain} pcs</span>
                </div>

                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <Table className="min-w-[560px]">
                    <TableHeader>
                      <TableRow className="bg-slate-50/70">
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Billed</TableHead>
                        <TableHead className="text-right">Returned</TableHead>
                        <TableHead className="text-center">Return Qty</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.items.map((it) => {
                        const q = qtys[it.productId] ?? 0
                        const done = returnedMap[it.productId] ?? 0
                        const rem = remainOf(it.productId, it.qty)
                        return (
                          <TableRow key={it.id}>
                            <TableCell>
                              <p className="text-sm font-medium text-slate-800">{it.productName}</p>
                              <p className="text-[10px] text-slate-400">{it.sku} • {fmtPKR(effRateOf(it))}/pc</p>
                            </TableCell>
                            <TableCell className="text-right text-sm whitespace-nowrap">{fmtQty(it.qty, it.unitsPerCarton, it.pcsPerBox)}</TableCell>
                            <TableCell className={`text-right text-sm whitespace-nowrap ${done > 0 ? 'text-orange-600' : 'text-slate-300'}`}>{done > 0 ? fmtQty(done, it.unitsPerCarton, it.pcsPerBox) : '—'}</TableCell>
                            <TableCell className="text-center">
                              {rem > 0 ? (
                                <div className="flex justify-center">
                                  <UnitQtyInputs
                                    pcs={q}
                                    upc={Math.max(1, it.unitsPerCarton)}
                                    pcsPerBox={it.pcsPerBox > 0 ? it.pcsPerBox : 0}
                                    maxPcs={rem}
                                    inputW="w-12"
                                    onChange={(totalPcs) => setQty(it.productId, totalPcs)}
                                  />
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-300">full returned</span>
                              )}
                            </TableCell>
                            <TableCell className={`text-right text-sm font-semibold whitespace-nowrap ${q > 0 ? 'text-orange-600' : 'text-slate-300'}`}>
                              {q > 0 ? fmtPKR(Math.round(q * effRateOf(it) * 100) / 100) : '—'}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-end gap-6 text-sm pr-1">
                  <div className="text-right">
                    <p className="text-[11px] text-slate-400 uppercase">Return Qty</p>
                    <p className="font-bold text-slate-700 whitespace-nowrap tabular-nums">{retQty} pcs</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-400 uppercase">Return Value</p>
                    <p className="font-bold text-orange-600 text-lg whitespace-nowrap tabular-nums">{fmtPKR(retValue)}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t pt-3 gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-orange-500 hover:bg-orange-600 text-white" disabled={!order || retQty === 0 || overCap || saving}
            onClick={apply}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1.5" />}
            Apply Late Return ({retQty} pcs — {fmtPKR(retValue)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SettlementView() {
  const user = useDMS((s) => s.user)
  const focusSummaryId = useDMS((s) => s.focusSummaryId)
  const setFocusSummary = useDMS((s) => s.setFocusSummary)

  const [summaries, setSummaries] = useState<SummaryDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SummaryDetailDTO | null>(null)
  const [cashInputs, setCashInputs] = useState<Record<string, SettleRow>>({})
  const [retInputs, setRetInputs] = useState<Record<string, ReturnDraft>>({})
  const [retDlgOrder, setRetDlgOrder] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  // Post-settlement sheet preview — settle hote hi khulti hai + history se bhi (RET numbers fresh detail se aate hain)
  const [postPrint, setPostPrint] = useState<SummaryDetailDTO | null>(null)
  // Late stock return — SETTLED summary ke bill par (ghalti se return reh gaya ho)
  const [lateRetId, setLateRetId] = useState<string | null>(null)

  async function load(keepActive = false) {
    if (!user) return
    setLoading(true)
    try {
      const r = await api<{ summaries: SummaryDTO[] }>(`/api/summaries?userId=${user.id}`)
      setSummaries(r.summaries)
      if (!keepActive) {
        const firstUnsettled = r.summaries.find((s) => s.status === 'UNSETTLED')
        setActiveId(focusSummaryId ?? firstUnsettled?.id ?? null)
        if (focusSummaryId) setFocusSummary(null)
      }
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [user])

  async function loadDetail(id: string) {
    setActiveId(id)
    setDetail(null)
    try {
      const r = await api<{ summary: SummaryDetailDTO }>(`/api/summaries/${id}`)
      setDetail(r.summary)
      // default: sab full cash (bill + advance tax), koi return nahi
      const init: Record<string, SettleRow> = {}
      // Task 45: default cash = grand payable (goods − TO + GST + adv tax) — booking chain jaisa
      for (const o of r.summary.orders) init[o.id] = { cash: String(orderNetPayable(o, 0).net) }
      setCashInputs(init)
      setRetInputs({})
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    }
  }

  // Focus se auto-select (summaries view se "Go to Settlement")
  useEffect(() => {
    if (focusSummaryId) { loadDetail(focusSummaryId); setFocusSummary(null) }
  }, [focusSummaryId])

  const unsettled = summaries.filter((s) => s.status === 'UNSETTLED')
  const settled = summaries.filter((s) => s.status === 'SETTLED')

  const rows = useMemo(() => {
    if (!detail) return []
    return detail.orders.map((o) => {
      const d = retInputs[o.id]
      let returnValue = 0
      let returnQty = 0
      if (d) {
        for (const it of o.items) {
          const q = d.qtys[it.productId] ?? 0
          if (q > 0) { returnValue += q * it.rate; returnQty += q }
        }
      }
      returnValue = Math.round(returnValue * 100) / 100
      const bill = o.total
      const parts = orderNetPayable(o, returnValue)
      const net = parts.net
      const cash = Math.max(0, Math.min(Number(cashInputs[o.id]?.cash ?? net) || 0, net))
      return {
        order: o, bill, returnValue, returnQty, tax: parts.tax, taxReversal: parts.taxRev, gst: parts.gst, gstRev: parts.gstRev, to: parts.to, toRev: parts.toRev, net, cash,
        credit: Math.round((net - cash) * 100) / 100,
        status: cash <= 0 ? 'CREDIT' : cash >= net ? 'CASH' : 'PARTIAL',
      }
    })
  }, [detail, cashInputs, retInputs])

  const totalCash = rows.reduce((s, r) => s + r.cash, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)
  const totalReturns = rows.reduce((s, r) => s + r.returnValue, 0)
  const totalTax = rows.reduce((s, r) => s + r.tax, 0)

  function setCash(orderId: string, val: string) { setCashInputs({ ...cashInputs, [orderId]: { cash: val } }) }
  function fullCash(orderId: string, net: number) { setCash(orderId, String(net)) }
  function fullUdhaar(orderId: string) { setCash(orderId, '0') }

  function confirmReturn(order: SummaryOrderDTO, draft: ReturnDraft) {
    setRetInputs({ ...retInputs, [order.id]: draft })
    // cash auto-adjust: net payable par le aao (user baad me edit kar sakta hai)
    let rv = 0
    for (const it of order.items) {
      const q = draft.qtys[it.productId] ?? 0
      if (q > 0) rv += q * it.rate
    }
    rv = Math.round(rv * 100) / 100
    const parts = orderNetPayable(order, rv)
    const net = parts.net
    setCashInputs({ ...cashInputs, [order.id]: { cash: String(net) } })
    setRetDlgOrder(null)
    toast({
      title: 'Return added ✓',
      description: `${order.outletName}: net payable ab ${fmtPKR(net)}${parts.taxRev > 0 ? ` — adv tax bhi ${fmtPKR(parts.taxRev)} kam hua` : ''}${parts.gstRev > 0 ? `, GST ${fmtPKR(parts.gstRev)} kam hua` : ''}`,
    })
  }

  async function settle() {
    if (!detail || rows.length === 0) return
    setSettling(true)
    try {
      const settlements = rows.map((r) => {
        const d = retInputs[r.order.id]
        const items = d
          ? r.order.items
              .map((it) => ({ productId: it.productId, qty: d.qtys[it.productId] ?? 0 }))
              .filter((x) => x.qty > 0)
          : []
        return {
          orderId: r.order.id,
          cashAmount: r.cash,
          ...(items.length > 0 ? { return: { reason: d!.reason, items } } : {}),
        }
      })
      await api(`/api/summaries/${detail.id}/settle`, {
        method: 'POST',
        body: JSON.stringify({ userId: user?.id, settlements }),
      })
      toast({
        title: `Summary ${detail.summaryNo} Settled ✓`,
        description: `Cash ${fmtPKR(totalCash)} — Udhaar ${fmtPKR(totalCredit)}${totalReturns > 0 ? ` — Returns ${fmtPKR(totalReturns)} (stock wapas)` : ''}${totalTax > 0 ? ` — Adv Tax (added) ${fmtPKR(totalTax)}` : ''} — shop ledgers update ho gaye`,
      })
      // Settlement Sheet seedha preview — fresh fetch (server-generated RET- numbers + posted amounts)
      try {
        const fr = await api<{ summary: SummaryDetailDTO }>(`/api/summaries/${detail.id}`)
        setPostPrint(fr.summary)
      } catch { /* print optional — settle to ho gaya */ }
      setDetail(null)
      setActiveId(null)
      setRetInputs({})
      await load(true)
    } catch (e) {
      toast({ title: 'Settlement Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSettling(false) }
  }

  const retDlgRow = rows.find((r) => r.order.id === retDlgOrder)
  const retDlgDraft = retDlgOrder ? retInputs[retDlgOrder] : undefined

  // History se settlement sheet print — koi editor state disturb nahi hota
  async function printSettled(id: string) {
    try {
      const r = await api<{ summary: SummaryDetailDTO }>(`/api/summaries/${id}`)
      setPostPrint(r.summary)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Delivery Settlement</h2>
        <p className="text-sm text-slate-500">Sham ko van wapis — per shop cash adjust karein, wapas items return karein, baqi udhaar ledger mein chala jayega</p>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 flex-1 min-h-0">
        {/* LEFT: summaries to post/settle */}
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Unsettled Summaries ({unsettled.length})</p>
              {loading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
              ) : unsettled.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">Sab settled ✓</p>
              ) : (
                <div className="space-y-2 max-h-[calc(100vh-430px)] min-h-[140px] overflow-y-auto">
                  {unsettled.map((s) => (
                    <button key={s.id} onClick={() => loadDetail(s.id)}
                      className={`w-full text-left rounded-lg border p-2.5 transition-colors ${activeId === s.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-emerald-700 text-sm">{s.summaryNo}</span>
                        <Badge variant="outline" className={`${STATUS_STYLES[s.status]} text-[9px]`}>{statusLabel(s.status)}</Badge>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">{s.salesmanName} • {s.billsCount} bills • {fmtPKR(s.subtotal)}</p>
                      <p className="text-[10px] text-slate-400">Delivery: {fmtDate(s.deliveryDate)}</p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Settled History</p>
              {settled.length === 0 ? (
                <p className="text-sm text-slate-400 py-3 text-center">Abhi koi settlement nahi hui</p>
              ) : (
                <div className="space-y-2 max-h-[38vh] overflow-y-auto">
                  {settled.map((s) => (
                    <div key={s.id} className="rounded-lg border border-slate-200 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-700 text-sm">{s.summaryNo}</span>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className={`${STATUS_STYLES.SETTLED} text-[9px]`}>Settled</Badge>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-orange-600" title="Late Stock Return — ghalti se return reh gaya tha? Ab items wapas karein, shop ka balance cum ho jayega"
                            onClick={() => setLateRetId(s.id)}>
                            <PackageOpen className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-violet-700" title="Settlement Sheet print karein — cash + return detail"
                            onClick={() => printSettled(s.id)}>
                            <ReceiptText className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">{s.salesmanName} • {s.billsCount} bills</p>
                      <p className="text-[11px] mt-1">
                        <span className="text-emerald-700 font-semibold">Cash {fmtPKR(s.settledCash)}</span>
                        {' • '}
                        {/* negative credit = return zyada hua (late return) — "Udhaar -X" reader ko
                            confuse karta hai, sheet ki tarah "Shop Ko Wapasi" positive dikhate hain */}
                        {s.settledCredit < 0
                          ? <span className="text-orange-600 font-semibold">Shop Ko Wapasi {fmtPKR(Math.abs(s.settledCredit))}</span>
                          : <span className="text-red-600 font-semibold">Udhaar {fmtPKR(s.settledCredit)}</span>}
                        {(s.settledReturns ?? 0) > 0 && <> • <span className="text-orange-600 font-semibold">Return {fmtPKR(s.settledReturns)}</span></>}
                      </p>
                      <p className="text-[10px] text-slate-400">{s.settledByName ? `By ${s.settledByName}` : ''} {s.settledAt ? `• ${fmtDate(s.settledAt)}` : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: settlement form */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-0">
            {!detail ? (
              <div className="py-20 text-center">
                <Wallet className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Left side se unsettled summary select karein</p>
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-800">{detail.summaryNo} — {detail.salesmanName}</p>
                    <p className="text-xs text-slate-500">Delivery: {fmtDate(detail.deliveryDate)} • {detail.orders.length} invoices • Total {fmtPKR(detail.subtotal)}</p>
                  </div>
                  <Badge variant="outline" className={STATUS_STYLES[detail.status]}>{statusLabel(detail.status)}</Badge>
                </div>

                <ScrollArea className="max-h-[calc(100vh-320px)] min-h-[240px]">
                  {/* MOBILE / TABLET — per-invoice cards (7-column table chhoti screen par bahut cramped hoti hai) */}
                  <div className="lg:hidden divide-y">
                    {rows.map((r) => (
                      <div key={r.order.id} className="p-3 space-y-2.5 last:border-b-0 border-b">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 text-sm truncate">{r.order.outletName}</p>
                            <p className="text-[11px] text-slate-400">{r.order.orderNo} • {r.order.channel}</p>
                          </div>
                          <Badge variant="outline" className={`${STATUS_STYLES[r.status]} text-[10px] shrink-0`}>{statusLabel(r.status)}</Badge>
                        </div>
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase mt-1 shrink-0">Payable</span>
                          <div className="text-right min-w-0">
                            <p className="font-semibold text-slate-900">{fmtPKR(r.net)}</p>
                            {(r.returnValue > 0 || r.tax > 0) && (
                              <p className="text-[10px] text-orange-600">Bill {fmtPKR(r.bill)}{r.returnValue > 0 ? ` − Ret ${fmtPKR(r.returnValue)}` : ''}{r.tax > 0 ? ` + Tax ${fmtPKR(r.tax)}` : ''}{r.taxReversal > 0 ? <span className="text-blue-500"> (−{fmtPKR(r.taxReversal)} rev)</span> : ''}</p>
                            )}
                            {r.credit > 0 && <p className="text-[10px] text-red-600 font-semibold">Udhaar {fmtPKR(r.credit)}</p>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className={`h-9 text-[11px] px-2.5 shrink-0 ${r.returnQty > 0 ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' : ''}`}
                            onClick={() => setRetDlgOrder(r.order.id)}>
                            <PackageOpen className="h-3 w-3 mr-1" />{r.returnQty > 0 ? `${r.returnQty} pcs • ${fmtPKR(r.returnValue)}` : 'Return'}
                          </Button>
                          <Input type="number" min={0} max={r.net} value={cashInputs[r.order.id]?.cash ?? ''} onChange={(e) => setCash(r.order.id, e.target.value)} placeholder="Cash received" className="h-9 text-right text-sm flex-1 min-w-0" />
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={() => fullCash(r.order.id, r.net)}>Full Cash</Button>
                          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 text-red-600 border-red-200 hover:bg-red-50" onClick={() => fullUdhaar(r.order.id)}>Udhaar</Button>
                        </div>
                      </div>
                    ))}
                    {rows.length === 0 && <p className="py-10 text-center text-sm text-slate-400">Is summary mein koi invoice nahi</p>}
                  </div>

                  {/* DESKTOP — full 7-column table */}
                  <div className="hidden lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/70">
                        <TableHead>Invoice / Shop</TableHead>
                        <TableHead className="text-right">Payable</TableHead>
                        <TableHead className="text-center">Stock Return</TableHead>
                        <TableHead className="text-right w-36">Cash Received</TableHead>
                        <TableHead className="text-right">Udhaar</TableHead>
                        <TableHead className="text-center">Type</TableHead>
                        <TableHead className="text-right">Quick</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.order.id}>
                          <TableCell>
                            <p className="font-medium text-slate-800 text-sm">{r.order.outletName}</p>
                            <p className="text-[11px] text-slate-400">{r.order.orderNo} • {r.order.channel}</p>
                          </TableCell>
                          <TableCell className="text-right">
                            {r.returnValue > 0 || r.tax > 0 ? (
                              <>
                                <p className="font-semibold">{fmtPKR(r.net)}</p>
                                <p className="text-[10px] text-orange-600">Bill {fmtPKR(r.bill)}{r.returnValue > 0 ? ` − Ret ${fmtPKR(r.returnValue)}` : ''}{r.tax > 0 ? ` + Tax ${fmtPKR(r.tax)}` : ''}{r.taxReversal > 0 ? <span className="text-blue-500"> (−{fmtPKR(r.taxReversal)} rev)</span> : ''}</p>
                              </>
                            ) : (
                              <p className="font-semibold">{fmtPKR(r.bill)}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {r.returnQty > 0 ? (
                              <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
                                onClick={() => setRetDlgOrder(r.order.id)}>
                                <PackageOpen className="h-3 w-3 mr-1" />{r.returnQty} pcs • {fmtPKR(r.returnValue)}
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-[11px] px-2"
                                onClick={() => setRetDlgOrder(r.order.id)}>
                                <PackageOpen className="h-3 w-3 mr-1" />Return
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input type="number" min={0} max={r.net} value={cashInputs[r.order.id]?.cash ?? ''} onChange={(e) => setCash(r.order.id, e.target.value)} className="h-8 text-right" />
                          </TableCell>
                          <TableCell className={`text-right font-semibold ${r.credit > 0 ? 'text-red-600' : 'text-slate-400'}`}>{r.credit > 0 ? fmtPKR(r.credit) : '—'}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={`${STATUS_STYLES[r.status]} text-[10px]`}>{statusLabel(r.status)}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={() => fullCash(r.order.id, r.net)}>Full Cash</Button>
                              <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 text-red-600 border-red-200 hover:bg-red-50" onClick={() => fullUdhaar(r.order.id)}>Udhaar</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </ScrollArea>

                <Separator />
                <div className="px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex gap-6 text-sm">
                    <div><p className="text-[11px] text-slate-400 uppercase">Total Cash</p><p className="font-bold text-emerald-700 text-lg">{fmtPKR(totalCash)}</p></div>
                    {totalReturns > 0 && (
                      <div><p className="text-[11px] text-slate-400 uppercase">Total Return</p><p className="font-bold text-orange-600 text-lg">{fmtPKR(totalReturns)}</p></div>
                    )}
                    <div><p className="text-[11px] text-slate-400 uppercase">Total Udhaar</p><p className="font-bold text-red-600 text-lg">{fmtPKR(totalCredit)}</p></div>
                  </div>
                  <Button onClick={settle} disabled={settling} className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto">
                    {settling ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                    ✓ Settle Summary & Update Ledgers
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-invoice stock return dialog */}
      {retDlgRow && (
        <ReturnDialog
          key={retDlgRow.order.id}
          order={retDlgRow.order}
          initial={retDlgDraft}
          onConfirm={(draft) => confirmReturn(retDlgRow.order, draft)}
          onClose={() => setRetDlgOrder(null)}
        />
      )}

      {/* Late stock return — settled summary ke bill par */}
      {lateRetId && (
        <LateReturnDialog
          summaryId={lateRetId}
          onClose={() => setLateRetId(null)}
          onDone={async (id) => {
            setLateRetId(null)
            await load(true)
            // updated settlement sheet preview — late return ka asar foran nazar aaye
            try {
              const fr = await api<{ summary: SummaryDetailDTO }>(`/api/summaries/${id}`)
              setPostPrint(fr.summary)
            } catch { /* print optional */ }
          }}
        />
      )}

      {/* Settlement Sheet preview — post karte hi khulti hai, history button se bhi */}
      {postPrint && (
        <PrintFrame title={`Settlement Sheet ${postPrint.summaryNo}`} pdfName={`settlement-${postPrint.summaryNo}`} onClose={() => setPostPrint(null)}>
          <CblSettlementDoc detail={postPrint} />
        </PrintFrame>
      )}
    </div>
  )
}
