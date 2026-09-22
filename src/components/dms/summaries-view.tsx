'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate, fmtNum, STATUS_STYLES, statusLabel } from '@/lib/dms-api'
import { fmtQty } from '@/components/dms/unit-qty'
import type { SummaryDTO, SummaryDetailDTO, SummaryOrderDTO, SummaryOrderReturnDTO } from '@/lib/dms-types'
import { PrintFrame, CblLoadFormDoc, CblInvoiceDoc, CblInvoicesDoc, CblSettlementDoc, keepDialogBehind, type InvoiceData } from '@/components/dms/cbl-print'
import { FileStack, Printer, Wallet, Loader2, FileText, Package, PackageOpen, Download, ReceiptText, Undo2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export function SummariesView() {
  const user = useDMS((s) => s.user)
  const focusSummaryId = useDMS((s) => s.focusSummaryId)
  const setFocusSummary = useDMS((s) => s.setFocusSummary)
  const setActiveView = useDMS((s) => s.setActiveView)

  const [summaries, setSummaries] = useState<SummaryDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<SummaryDetailDTO | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [bulk, setBulk] = useState<{ summaryNo: string; invoices: InvoiceData[]; gst?: { enabled: boolean; rate: number } } | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  // Task 27: Un-process — UNSETTLED summary revert (stock wapas, bills wapas unprocessed)
  const [unprocTarget, setUnprocTarget] = useState<{ id: string; summaryNo: string; billsCount: number } | null>(null)
  const [unprocBusy, setUnprocBusy] = useState(false)

  async function doUnprocess() {
    if (!unprocTarget) return
    setUnprocBusy(true)
    try {
      const r = await api<{ summaryNo: string; billsCount: number; restockedPcs: number }>(`/api/summaries/${unprocTarget.id}/unprocess`, {
        method: 'POST',
        body: JSON.stringify({ userId: user?.id ?? null }),
      })
      toast({ title: `${r.summaryNo} Un-processed ✓`, description: `${r.billsCount} bills wapas Stock Allocation mein — ${(r.restockedPcs ?? 0).toLocaleString('en-PK')} pcs warehouse mein wapas aa gaye` })
      setUnprocTarget(null)
      setDetail(null)
      load()
    } catch (e) {
      toast({ title: 'Un-process Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setUnprocBusy(false) }
  }

  // SAB invoices ek hi print mein — har invoice apne A4 page par
  async function printAllInvoices(s: { id: string; summaryNo: string }) {
    setBulkLoading(true)
    try {
      const [r, st] = await Promise.all([
        api<{ invoices: InvoiceData[] }>(`/api/summaries/${s.id}/invoices`),
        api<{ settings: { gstEnabled: boolean; gstRate: number } }>(`/api/settings?userId=${(JSON.parse(localStorage.getItem('dms_session') ?? 'null'))?.id ?? ''}`).catch(() => null),
      ])
      if (r.invoices.length === 0) {
        toast({ title: 'Is summary mein koi invoice nahi hai', variant: 'destructive' })
        return
      }
      const gst = st ? { enabled: st.settings.gstEnabled, rate: st.settings.gstRate } : undefined
      setBulk({ summaryNo: s.summaryNo, invoices: r.invoices, gst })
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally { setBulkLoading(false) }
  }

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const r = await api<{ summaries: SummaryDTO[] }>(`/api/summaries?userId=${user.id}`)
      setSummaries(r.summaries)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [user])  

  async function openDetail(id: string) {
    setDetailLoading(true)
    try {
      const r = await api<{ summary: SummaryDetailDTO }>(`/api/summaries/${id}`)
      setDetail(r.summary)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally { setDetailLoading(false) }
  }

  // Auto-open summary coming from "process" flow
  useEffect(() => {
    if (focusSummaryId && !detailLoading) {
      openDetail(focusSummaryId)
      setFocusSummary(null)
    }
  }, [focusSummaryId])

  const unsettled = summaries.filter((s) => s.status === 'UNSETTLED').length

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Delivery Summaries</h2>
          <p className="text-sm text-slate-500">{unsettled} unsettled — har summary mein product load + customers sheet ready hai</p>
        </div>
        <Button variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={load}>
          Refresh
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : summaries.length === 0 ? (
            <div className="py-16 text-center">
              <FileStack className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Abhi koi summary nahi bani — Unprocessed Bills se process karein</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/70">
                    <TableHead>Summary #</TableHead>
                    <TableHead>Order Booker</TableHead>
                    <TableHead className="hidden md:table-cell">Bills</TableHead>
                    <TableHead className="hidden md:table-cell">Booking → Delivery</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.map((s) => (
                    <TableRow key={s.id} className="hover:bg-emerald-50/30 cursor-pointer" onClick={() => openDetail(s.id)} onDoubleClick={() => openDetail(s.id)} title="Click / double-click = detail kholegi">
                      <TableCell className="font-semibold text-emerald-700">{s.summaryNo}</TableCell>
                      <TableCell>
                        <p className="font-medium text-slate-800">{s.salesmanName}</p>
                        <p className="text-xs text-slate-400">{s.warehouseName}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-slate-600">{s.billsCount}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-slate-500">
                        {fmtDate(s.orderDate)} → <b className="text-emerald-700">{fmtDate(s.deliveryDate)}</b>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{fmtPKR(s.subtotal)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${STATUS_STYLES[s.status] ?? ''} text-[10px] whitespace-nowrap`}>{statusLabel(s.status)}</Badge>
                        {s.status === 'SETTLED' && (
                          <p className="text-[10px] text-slate-400 mt-0.5">{fmtPKR(s.settledCash)} cash / {fmtPKR(s.settledCredit)} udhaar</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700" disabled={bulkLoading} title="SAB invoices ek hi print mein (har invoice apne page par)" onClick={(e) => { e.stopPropagation(); printAllInvoices(s) }}>
                            {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 text-xs px-2" onClick={(e) => { e.stopPropagation(); openDetail(s.id) }}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Open
                          </Button>
                          {s.status === 'UNSETTLED' && (
                            <>
                              <Button size="sm" variant="ghost" className="h-8 text-xs px-2 text-amber-700 hover:text-amber-800 hover:bg-amber-50" disabled={unprocBusy} title="Un-process — van stock wapas warehouse, bills wapas unprocessed" onClick={(e) => { e.stopPropagation(); setUnprocTarget({ id: s.id, summaryNo: s.summaryNo, billsCount: s.billsCount }) }}>
                                <Undo2 className="h-3.5 w-3.5 mr-1" /> Un-process
                              </Button>
                              <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700 text-xs px-2" onClick={(e) => { e.stopPropagation(); setFocusSummary(s.id); setActiveView('settlement') }}>
                                <Wallet className="h-3.5 w-3.5 mr-1" /> Settle
                              </Button>
                            </>
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

      {detailLoading && !detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
      )}

      <SummaryDetailDialog
        detail={detail}
        onClose={() => setDetail(null)}
        onSettled={() => { load() }}
        onGoSettle={(id) => { setDetail(null); setFocusSummary(id); setActiveView('settlement') }}
        onPrintAllInvoices={(s) => printAllInvoices(s)}
        onUnprocess={(s) => setUnprocTarget({ id: s.id, summaryNo: s.summaryNo, billsCount: s.billsCount })}
      />

      {/* Task 27: Un-process confirm — kya-kya revert hoga clearly likha hai */}
      <AlertDialog open={!!unprocTarget} onOpenChange={(v) => { if (!v) setUnprocTarget(null) }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Undo2 className="h-5 w-5 text-amber-600" /> Summary {unprocTarget?.summaryNo} un-process karein?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-600">
                <p>Ye process ka ulta hai — sab kuch wapas ho jayega:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Van se nikla stock <b className="text-slate-800">warehouse mein wapas</b> aa jayega ({unprocTarget?.billsCount ?? 0} bills ka saara stock)</li>
                  <li>Sab bills <b className="text-slate-800">wapas Stock Allocation (unprocessed)</b> mein chali jayengi — dobara edit/process kar sakte hain</li>
                  <li>Delivery challans aur ye summary <b className="text-slate-800">delete</b> ho jayengi</li>
                </ul>
                <p className="text-amber-700">Note: settled summary un-process nahi hoti — sirf abhi tak settlement na hui summary revert hogi.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unprocBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={unprocBusy}
              onClick={(e) => { e.preventDefault(); doUnprocess() }}
            >
              {unprocBusy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Haan, Un-process Karein
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk print: sab invoices ek hi print job mein — har invoice apne A4 page par */}
      {bulk && (
        <PrintFrame title={`${bulk.summaryNo} — All Invoices (${bulk.invoices.length})`} onClose={() => setBulk(null)}>
          <CblInvoicesDoc invoices={bulk.invoices} gst={bulk.gst} />
        </PrintFrame>
      )}
    </div>
  )
}

function SummaryDetailDialog({ detail, onClose, onSettled, onGoSettle, onPrintAllInvoices, onUnprocess }: {
  detail: SummaryDetailDTO | null
  onClose: () => void
  onSettled: () => void
  onGoSettle: (id: string) => void
  onPrintAllInvoices: (s: { id: string; summaryNo: string }) => void
  onUnprocess: (s: { id: string; summaryNo: string; billsCount: number }) => void
}) {
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  const [invoiceReturns, setInvoiceReturns] = useState<SummaryOrderReturnDTO[]>([])
  const [lfPrint, setLfPrint] = useState(false)
  const [stlPrint, setStlPrint] = useState(false)
  // Load Form preview ke andar invoice number click -> SIRF wohi invoice A4 preview khulti hai
  // (PrintFrame single-preview event se load form preview khud band ho jata hai)
  const [linkInv, setLinkInv] = useState<InvoiceData | null>(null)
  const [linkGst, setLinkGst] = useState<{ enabled: boolean; rate: number } | null>(null)
  const [linkLoading, setLinkLoading] = useState(false)

  async function openSingleInvoice(o: SummaryOrderDTO) {
    setLinkLoading(true)
    try {
      const [r, st] = await Promise.all([
        api<{ order: InvoiceData }>(`/api/orders/${o.id}`),
        api<{ settings: { gstEnabled: boolean; gstRate: number } }>(`/api/settings?userId=${(JSON.parse(localStorage.getItem('dms_session') ?? 'null'))?.id ?? ''}`).catch(() => null),
      ])
      if (st) setLinkGst({ enabled: st.settings.gstEnabled, rate: st.settings.gstRate })
      setLinkInv(r.order)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Invoice load failed', variant: 'destructive' })
    } finally { setLinkLoading(false) }
  }

  const totals = useMemo(() => {
    if (!detail) return { pcs: 0, free: 0, value: 0, bills: 0, amount: 0, cash: 0, credit: 0, returns: 0, tax: 0 }
    const pcs = detail.products.reduce((s, p) => s + p.qty, 0)
    const free = detail.products.reduce((s, p) => s + p.freeQty, 0)
    const value = detail.products.reduce((s, p) => s + p.amount, 0)
    const amount = detail.orders.reduce((s, o) => s + o.total, 0)
    const cash = detail.settlements.reduce((s, x) => s + x.cashAmount, 0)
    const credit = detail.settlements.reduce((s, x) => s + x.creditAmount, 0)
    const returns = detail.settlements.reduce((s, x) => s + (x.returnAmount ?? 0), 0)
    const tax = detail.settlements.reduce((s, x) => s + (x.advanceTax ?? 0), 0)
    return { pcs, free, value, bills: detail.orders.length, amount, cash, credit, returns, tax }
  }, [detail])

  if (!detail) return null

  return (
    <>
      <Dialog open={!!detail} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-5xl max-h-[92vh] overflow-hidden flex flex-col" {...keepDialogBehind}>
          <DialogHeader className="print:mb-2">
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <FileStack className="h-5 w-5 text-emerald-600" /> {detail.summaryNo}
              <Badge variant="outline" className={STATUS_STYLES[detail.status]}>{statusLabel(detail.status)}</Badge>
            </DialogTitle>
            <DialogDescription className="flex flex-wrap gap-x-3">
              <span>Order Booker: <b className="text-slate-700">{detail.salesmanName}</b></span>
              <span>•</span>
              <span>Warehouse: {detail.warehouseName}</span>
              <span>•</span>
              <span>Booking: {fmtDate(detail.orderDate)}</span>
              <span>•</span>
              <span className="text-emerald-700 font-medium">Delivery: {fmtDate(detail.deliveryDate)}</span>
              {detail.settledByName && <span>• Settled by {detail.settledByName}</span>}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-4 overflow-y-auto pr-1">
            {/* LEFT: Product Load Summary — warehouse se nikalne wala stock */}
            <div className="rounded-lg border">
              <div className="bg-slate-50 px-3 py-2 border-b flex items-center gap-2">
                <Package className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-bold text-slate-700">Product Load Summary (Van Stock)</p>
              </div>
              <div className="max-h-[42vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Free</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.products.map((p) => (
                      <TableRow key={p.productId}>
                        <TableCell className="font-mono text-[11px] text-slate-500">{p.sku}</TableCell>
                        <TableCell className="text-sm font-medium text-slate-800">{p.name}</TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">{fmtQty(p.qty, p.unitsPerCarton, p.pcsPerBox)}</TableCell>
                        <TableCell className="text-right text-emerald-600 whitespace-nowrap">{p.freeQty > 0 ? `+${fmtQty(p.freeQty, p.unitsPerCarton, p.pcsPerBox)}` : '—'}</TableCell>
                        <TableCell className="text-right">{fmtPKR(p.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Separator />
              <div className="px-3 py-2 flex justify-between text-sm">
                <span className="text-slate-500">Total: <b className="text-slate-800">{fmtNum(totals.pcs)} pcs</b>{totals.free > 0 && <span className="text-emerald-600"> +{fmtNum(totals.free)} free pcs</span>}</span>
                <b className="text-slate-900">{fmtPKR(totals.value)}</b>
              </div>
            </div>

            {/* RIGHT: Customers Sheet — shop + bill amount (click = invoice open) */}
            <div className="rounded-lg border">
              <div className="bg-slate-50 px-3 py-2 border-b flex items-center justify-between">
                <p className="text-sm font-bold text-slate-700">Customers Sheet (Invoices)</p>
                <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-slate-800 text-slate-800 hover:bg-slate-100" onClick={() => onPrintAllInvoices({ id: detail.id, summaryNo: detail.summaryNo })}>
                  <Printer className="h-3 w-3 mr-1" /> Print All Invoices
                </Button>
              </div>
              <div className="max-h-[42vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Customer / Shop</TableHead>
                      <TableHead className="hidden sm:table-cell">Area</TableHead>
                      <TableHead className="text-right">Bill Amount</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Adv Tax</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.orders.map((o) => (
                      <TableRow
                        key={o.id}
                        className="cursor-pointer hover:bg-emerald-50/40"
                        onClick={() => { setInvoiceId(o.id); setInvoiceReturns(o.returns ?? []) }}
                        onDoubleClick={() => { setInvoiceId(o.id); setInvoiceReturns(o.returns ?? []) }}
                        title="Click = invoice khulegi (print button andar)"
                      >
                        <TableCell className="font-semibold text-emerald-700 text-sm">{o.orderNo}
                          {(o.returns?.length ?? 0) > 0 && <Badge variant="outline" className="ml-1.5 text-[9px] border-orange-300 text-orange-600">RET</Badge>}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-medium text-slate-800">{o.outletName}</p>
                          <p className="text-[11px] text-slate-400">{o.outletCode} • {o.channel}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs text-slate-500 max-w-[140px] truncate">{o.address ?? '—'}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtPKR(o.total)}</TableCell>
                        <TableCell className="text-right text-xs text-blue-600 hidden sm:table-cell">{(o.advanceTax ?? 0) > 0 ? fmtPKR(o.advanceTax ?? 0) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Separator />
              <div className="px-3 py-2 flex justify-between text-sm">
                <span className="text-slate-500">{totals.bills} invoices</span>
                <b className="text-slate-900">{fmtPKR(totals.amount)}</b>
              </div>
              {detail.status === 'SETTLED' && (
                <div className="px-3 py-2 border-t bg-emerald-50/50 flex justify-between text-xs">
                  <span className="text-emerald-700 font-semibold">Cash: {fmtPKR(totals.cash)}</span>
                  {totals.returns > 0 && <span className="text-orange-600 font-semibold">Return: {fmtPKR(totals.returns)}</span>}
                  {totals.tax > 0 && <span className="text-blue-600 font-semibold">Adv Tax: {fmtPKR(totals.tax)}</span>}
                  <span className="text-red-600 font-semibold">Udhaar: {fmtPKR(totals.credit)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2 justify-end border-t pt-3">
            {detail.status === 'UNSETTLED' ? (
              <>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onGoSettle(detail.id)}>
                  <Wallet className="h-4 w-4 mr-1.5" /> Go to Settlement
                </Button>
                <Button variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => onUnprocess({ id: detail.id, summaryNo: detail.summaryNo, billsCount: detail.orders.length })}>
                  <Undo2 className="h-4 w-4 mr-1.5" /> Un-process
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" disabled className="border-emerald-200 text-emerald-700">
                  Settled ✓ {fmtPKR(detail.settledCash)} cash received
                </Button>
                <Button variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50" onClick={() => setStlPrint(true)}>
                  <ReceiptText className="h-4 w-4 mr-1.5" /> Print Settlement Sheet
                </Button>
              </>
            )}
            <Button variant="outline" className="border-slate-800 text-slate-800 hover:bg-slate-100" onClick={() => onPrintAllInvoices({ id: detail.id, summaryNo: detail.summaryNo })}>
              <Printer className="h-4 w-4 mr-1.5" /> Print All Invoices ({detail.orders.length})
            </Button>
            <Button onClick={() => setLfPrint(true)} className="bg-slate-800 hover:bg-slate-900 text-white">
              <Printer className="h-4 w-4 mr-1.5" /> Print / Export Load Form
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CBL-style Load Form print preview (products + customers + signatures) — invoice number click = sirf wohi invoice */}
      {lfPrint && detail && (
        <PrintFrame title={`Load Form ${detail.summaryNo}`} onClose={() => setLfPrint(false)}>
          <CblLoadFormDoc detail={detail} onInvoiceClick={openSingleInvoice} />
        </PrintFrame>
      )}

      {/* Load Form ke andar invoice click hui to SIRF wohi invoice (A4 cash memo) nazar aati hai */}
      {linkInv && (
        <PrintFrame title={`Invoice ${linkInv.orderNo}`} pdfName={`invoice-${linkInv.orderNo}`} onClose={() => setLinkInv(null)}>
          <CblInvoiceDoc inv={linkInv} gst={linkGst ?? undefined} />
        </PrintFrame>
      )}

      {linkLoading && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30">
          <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
            <span className="text-sm text-slate-700">Invoice khul rahi hai...</span>
          </div>
        </div>
      )}

      {/* Settlement Sheet — post hone ke baad ka cash + return hisaab (future reference) */}
      {stlPrint && detail && detail.status === 'SETTLED' && (
        <PrintFrame title={`Settlement Sheet ${detail.summaryNo}`} pdfName={`settlement-${detail.summaryNo}`} onClose={() => setStlPrint(false)}>
          <CblSettlementDoc detail={detail} />
        </PrintFrame>
      )}

      {/* Invoice drill-down (double-click se khulti hai — delivery man yahi le ke jata hai) */}
      <InvoiceDialog invoiceId={invoiceId} returns={invoiceReturns} onClose={() => setInvoiceId(null)} />
    </>
  )
}

function InvoiceDialog({ invoiceId, returns = [], onClose }: { invoiceId: string | null; returns?: SummaryOrderReturnDTO[]; onClose: () => void }) {
  const [data, setData] = useState<InvoiceData | null>(null)
  const [printing, setPrinting] = useState(false)
  const [gst, setGst] = useState<{ enabled: boolean; rate: number } | null>(null)

  useEffect(() => {
    if (!invoiceId) return
    queueMicrotask(() => setData(null))
    api<{ order: InvoiceData }>(`/api/orders/${invoiceId}`).then((r) => setData(r.order)).catch(() => {})
    api<{ settings: { gstEnabled: boolean; gstRate: number } }>(`/api/settings?userId=${(JSON.parse(localStorage.getItem('dms_session') ?? 'null'))?.id ?? ''}`)
      .then((s) => setGst({ enabled: s.settings.gstEnabled, rate: s.settings.gstRate }))
      .catch(() => {})
  }, [invoiceId])

  return (
    <>
    <Dialog open={!!invoiceId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col gap-3 sm:gap-4 p-4 sm:p-6" {...keepDialogBehind}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" /> Invoice {data?.orderNo ?? '...'}
          </DialogTitle>
          <DialogDescription>
            {data ? `${data.outlet.name} (${data.outlet.code}) • ${data.outlet.channel} • Booked by ${data.salesmanName ?? '—'}` : 'Loading...'}
          </DialogDescription>
        </DialogHeader>
        {data && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Table className="min-w-[420px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Free</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <p className="font-medium text-slate-800 text-sm">{it.productName}</p>
                        {it.schemeName && <p className="text-[11px] text-emerald-600">🎁 {it.schemeName}</p>}
                      </TableCell>
                      <TableCell className="text-right">{it.qty}</TableCell>
                      <TableCell className="text-right">{it.freeQty > 0 ? <span className="text-emerald-600 font-semibold">+{it.freeQty}</span> : '—'}</TableCell>
                      <TableCell className="text-right text-xs">{fmtPKR(it.rate)}</TableCell>
                      <TableCell className="text-right font-semibold">{fmtPKR(it.lineTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            <div className="space-y-1 pt-2">
              <Separator className="mb-2" />
              <div className="flex justify-between gap-3 text-sm text-slate-500"><span>Subtotal</span><span className="whitespace-nowrap tabular-nums">{fmtPKR(data.subtotal)}</span></div>
              <div className="flex justify-between gap-3 text-sm text-emerald-600"><span>Scheme Discount</span><span className="whitespace-nowrap tabular-nums">- {fmtPKR(data.schemeDiscount)}</span></div>
              {(data.manualDiscount ?? 0) > 0 && (
                <div className="flex justify-between gap-3 text-sm text-emerald-600">
                  <span>Manual Discount{data.manualDiscType === 'PERCENT' && data.manualDiscValue ? ` (${data.manualDiscValue}%)` : ''}</span>
                  <span className="whitespace-nowrap tabular-nums">- {fmtPKR(data.manualDiscount ?? 0)}</span>
                </div>
              )}
              <div className="flex justify-between gap-3 font-bold text-lg text-slate-900"><span>Payable</span><span className="whitespace-nowrap tabular-nums">{fmtPKR(data.total)}</span></div>
              {(data.advanceTax ?? 0) > 0 && (
                <>
                  <div className="flex justify-between gap-3 text-sm text-blue-600">
                    <span>Advance Tax ({data.advanceTaxRate != null ? `${data.advanceTaxRate}%` : ''}{data.filerStatus ? ` — ${data.filerStatus === 'FILER' ? 'Filer' : 'Non-Filer'}` : ''})</span>
                    <span className="whitespace-nowrap tabular-nums">+ {fmtPKR(data.advanceTax ?? 0)}</span>
                  </div>
                  <div className="flex justify-between gap-3 font-semibold text-sm text-slate-900">
                    <span>Total Payable (incl. Adv Tax)</span>
                    <span className="whitespace-nowrap tabular-nums">{fmtPKR(Math.round((data.total + (data.advanceTax ?? 0)) * 100) / 100)}</span>
                  </div>
                </>
              )}
            </div>
            {returns.length > 0 && (
              <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50/60 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-orange-700 uppercase tracking-wide mb-2">
                  <PackageOpen className="h-3.5 w-3.5" /> Stock Return (Settlement)
                </p>
                {returns.map((r) => (
                  <div key={r.returnNo} className="mb-2 last:mb-0">
                    <p className="text-xs text-slate-600">
                      <b className="text-orange-700">{r.returnNo}</b> • {r.type} • {new Date(r.createdAt).toLocaleDateString()}
                    </p>
                    {r.items.map((ri, i) => (
                      <p key={i} className="text-xs text-slate-500 ml-3">• {ri.productName} × {ri.qty} = {fmtPKR(ri.value)}</p>
                    ))}
                    <p className="text-xs font-semibold text-orange-700 ml-3">Return Total: {fmtPKR(r.totalValue)}</p>
                  </div>
                ))}
              </div>
            )}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={!data} className="bg-slate-800 hover:bg-slate-900 text-white" onClick={() => setPrinting(true)}>
            <Printer className="h-4 w-4 mr-1.5" /> Print / Export Invoice
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* CBL-style Cash Memo print preview */}
    {printing && data && (
      <PrintFrame title={`Invoice ${data.orderNo}`} onClose={() => setPrinting(false)}>
        <CblInvoiceDoc inv={data} gst={gst ?? undefined} />
      </PrintFrame>
    )}
    </>
  )
}
