'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate, STATUS_STYLES, statusLabel } from '@/lib/dms-api'
import { UnitQtyInputs, fmtQty } from '@/components/dms/unit-qty'
import { ProductCombobox } from '@/components/dms/product-combobox'
import type { ReturnDTO, ClaimDTO, OutletDTO, ProductDTO, BillReturnOptionsDTO } from '@/lib/dms-types'
import { Check, X, Undo2, FileText, Plus, Loader2, ReceiptText, Trash2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

const round2v = (n: number) => Math.round(n * 100) / 100
const STANDALONE = '__standalone__'
/** Task 103-b: booker dropdown ka "bina booker" option — unassigned shops ke liye */
const UNASSIGNED = '__unassigned__'

export function ReturnsClaimsView() {
  const user = useDMS((s) => s.user)
  const [returns, setReturns] = useState<ReturnDTO[]>([])
  const [claims, setClaims] = useState<ClaimDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<ReturnDTO | null>(null)
  const [newReturnOpen, setNewReturnOpen] = useState(false)

  const canApprove = user?.role === 'DISTRIBUTOR'

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const [r, c] = await Promise.all([
        api<{ returns: ReturnDTO[] }>(`/api/returns?userId=${user.id}`),
        api<{ claims: ClaimDTO[] }>(`/api/claims?userId=${user.id}`),
      ])
      setReturns(r.returns)
      setClaims(c.claims)
    } finally { setLoading(false) }
  }
  useEffect(() => { load()   }, [user])

  async function returnAction(id: string, action: 'APPROVE' | 'REJECT') {
    try {
      const res = await api<{ status: string; restocked?: boolean; effects?: { advancePosted?: number } }>(`/api/returns/${id}`, { method: 'PATCH', body: JSON.stringify({ action, approvedBy: user?.name }) })
      toast({
        title: action === 'APPROVE' ? 'Return Approved ✓' : 'Return Rejected',
        description: action === 'APPROVE'
          ? res.restocked === false
            ? 'Khata update ho gaya — damage/expired stock inventory mein NAHI gaya (floor claim report mein count hoga)'
            : 'Stock inventory mein wapas add ho gaya, shop ka khata update ho gaya'
          : 'Status update ho gaya',
      })
      load()
    } catch (e) { toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' }) }
  }

  // Task 29 — UNDO: galti se approved return wapas lena (stock + khata dono revert)
  async function undoReturn(r: ReturnDTO) {
    if (!window.confirm(`${r.returnNo} UNDO karein?\n\n${r.outletName} — ${fmtPKR(r.totalValue)} ka return cancel hoga. Stock aur shop ka khata wapas pehle wali state par chale jayenge.`)) return
    try {
      const res = await api<{ result: { returnNo: string; cancelledValue: number; outletName: string } }>(`/api/returns/${r.id}/cancel`, { method: 'POST' })
      toast({ title: `Return ${res.result.returnNo} Cancelled ✓`, description: `${res.result.outletName}: ${fmtPKR(res.result.cancelledValue)} ka return wapas liya — stock + khata pehle wali state par aa gaya` })
      load()
    } catch (e) { toast({ title: 'Undo failed', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' }) }
  }

  // Task 29 — DELETE: galti se banayi PENDING/REJECTED entry mitana (koi effect nahi tha)
  async function deleteReturn(r: ReturnDTO) {
    if (!window.confirm(`${r.returnNo} DELETE karein?\n\n${r.outletName} — ${fmtPKR(r.totalValue)} ki ${r.status === 'PENDING' ? 'pending' : 'rejected'} return entry hamesha ke liye mit jayegi. Is par koi stock/khata effect nahi hua tha.`)) return
    try {
      await api<{ deleted: string }>(`/api/returns/${r.id}`, { method: 'DELETE' })
      toast({ title: `Return ${r.returnNo} deleted ✓`, description: 'Galti wali entry mit gayi — koi stock/khata asar nahi hua tha' })
      load()
    } catch (e) { toast({ title: 'Delete failed', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' }) }
  }

  async function claimAction(id: string, action: 'APPROVE' | 'REJECT') {
    try {
      await api(`/api/claims/${id}`, { method: 'PATCH', body: JSON.stringify({ action, approvedBy: user?.name }) })
      toast({ title: action === 'APPROVE' ? 'Claim Approved ✓' : 'Claim Rejected', description: 'Ledger adjustment ho jayega' })
      load()
    } catch (e) { toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' }) }
  }

  if (loading) return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>

  const pendingReturns = returns.filter((r) => r.status === 'PENDING').length
  const pendingClaims = claims.filter((c) => c.status === 'PENDING').length

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Returns & Claims</h2>
          <p className="text-sm text-slate-500">Bill-linked return (full amount + taxes) — shop select, bill select, items wapas</p>
        </div>
        <Button onClick={() => setNewReturnOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-1.5" /> New Sale Return
        </Button>
      </div>

      <Tabs defaultValue="returns">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="returns" className="data-[state=active]:bg-white data-[state=active]:text-emerald-700">
            Sale Returns {pendingReturns > 0 && <Badge className="ml-1.5 bg-amber-100 text-amber-700 border-0 h-4 text-[9px] px-1">{pendingReturns}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="claims" className="data-[state=active]:bg-white data-[state=active]:text-emerald-700">
            Claims {pendingClaims > 0 && <Badge className="ml-1.5 bg-amber-100 text-amber-700 border-0 h-4 text-[9px] px-1">{pendingClaims}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="returns" className="mt-3 space-y-2.5">
          {returns.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-slate-400">Koi return nahi</CardContent></Card>}
          {returns.map((r) => (
            <Card key={r.id} className="border-slate-200 shadow-sm">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <Undo2 className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setDetail(r)} className="font-semibold text-emerald-700 hover:underline text-sm">{r.returnNo}</button>
                    <Badge variant="outline" className="text-[9px] border-slate-200">{r.type}</Badge>
                    {r.orderNo && (
                      <Badge variant="outline" className="text-[9px] border-emerald-200 text-emerald-700 bg-emerald-50 gap-1">
                        <ReceiptText className="h-2.5 w-2.5" /> {r.orderNo}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{r.outletName} • {r.items.length} items • {fmtDate(r.createdAt)}</p>
                  {r.reason && <p className="text-xs text-slate-400 truncate italic">&ldquo;{r.reason}&rdquo;</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-900">{fmtPKR(r.totalValue)}</p>
                  {(r.advancePosted ?? 0) > 0 && (
                    <p className="text-[10px] text-emerald-600 font-semibold" title="Bill paid tha — ye hissa shop ke advance mein gaya (agli bill se auto-adjust)">Advance {fmtPKR(r.advancePosted!)}</p>
                  )}
                  <Badge variant="outline" className={`${STATUS_STYLES[r.status]} text-[9px]`}>{statusLabel(r.status)}</Badge>
                </div>
                {r.status === 'PENDING' && canApprove && (
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => returnAction(r.id, 'APPROVE')} className="h-8 bg-emerald-600 hover:bg-emerald-700"><Check className="h-3.5 w-3.5 mr-1" /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => returnAction(r.id, 'REJECT')} className="h-8 text-red-500 border-red-200 hover:bg-red-50"><X className="h-3.5 w-3.5 mr-1" /> Reject</Button>
                  </div>
                )}
                {/* Task 29: UNDO — galti se approved return wapas (stock + khata revert) */}
                {r.status === 'APPROVED' && canApprove && (
                  <Button size="sm" variant="outline" title="Galti se return tha? Undo karein — stock + khata wapas chale jayenge" onClick={() => undoReturn(r)} className="h-8 text-orange-600 border-orange-200 hover:bg-orange-50 shrink-0">
                    <Undo2 className="h-3.5 w-3.5 mr-1" /> Undo
                  </Button>
                )}
                {/* Task 29: DELETE — galti se banayi PENDING/REJECTED entry mitana */}
                {(r.status === 'PENDING' || r.status === 'REJECTED') && (
                  <Button size="sm" variant="ghost" title="Galti se banayi entry — delete karein" onClick={() => deleteReturn(r)} className="h-8 w-8 p-0 text-red-400 hover:bg-red-50 hover:text-red-600 shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="claims" className="mt-3 space-y-2.5">
          {claims.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-slate-400">Koi claim nahi</CardContent></Card>}
          {claims.map((c) => (
            <Card key={c.id} className="border-slate-200 shadow-sm">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-violet-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-800 text-sm">{c.claimNo}</p>
                    <Badge variant="outline" className="text-[9px] border-slate-200">{c.type.replaceAll('_', ' ')}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">{c.distributorName} • {fmtDate(c.createdAt)}</p>
                  {c.reason && <p className="text-xs text-slate-400 truncate italic">&ldquo;{c.reason}&rdquo;</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-900">{fmtPKR(c.amount)}</p>
                  <Badge variant="outline" className={`${STATUS_STYLES[c.status]} text-[9px]`}>{statusLabel(c.status)}</Badge>
                  {c.approvedBy && <p className="text-[10px] text-slate-400 mt-0.5">by {c.approvedBy}</p>}
                </div>
                {c.status === 'PENDING' && canApprove && (
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => claimAction(c.id, 'APPROVE')} className="h-8 bg-emerald-600 hover:bg-emerald-700"><Check className="h-3.5 w-3.5 mr-1" /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => claimAction(c.id, 'REJECT')} className="h-8 text-red-500 border-red-200 hover:bg-red-50"><X className="h-3.5 w-3.5 mr-1" /> Reject</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-md">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.returnNo} — Items</DialogTitle>
                <DialogDescription>{detail.outletName} • {detail.type}{detail.orderNo ? ` • Bill ${detail.orderNo}` : ''}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {detail.items.map((it, i) => (
                  <div key={i} className="flex justify-between rounded-lg border px-3 py-2 text-sm">
                    <span className="text-slate-700">{it.productName}</span>
                    <span className="text-slate-500">{fmtQty(it.qty, it.unitsPerCarton ?? 1, it.pcsPerBox ?? 0)} × {fmtPKR(it.rate)}/pc = <b>{fmtPKR(it.value)}</b></span>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-1"><span>Total</span><span>{fmtPKR(detail.totalValue)}</span></div>
                {(detail.advancePosted ?? 0) > 0 && (
                  <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-1.5">
                    Is return ki Rs {fmtPKR(detail.advancePosted!)} credit shop ke <b>ADVANCE</b> mein gayi (bill paid tha) — agli bill se auto-adjust hogi
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <NewReturnDialog open={newReturnOpen} onOpenChange={setNewReturnOpen} onCreated={load} />
    </div>
  )
}

/**
 * Task 101 — New Sale Return (BILL-LINKED):
 *  1. Shop select → us shop ke SETTLED bills dropdown (sirf ledger wale — user rule)
 *  2. Bill select → bill ke items (billed / pehle wapas / returnable) @ actual effRate
 *  3. Qty + "Pura Bill Return" + live totals (goods + GST + advTax − TO = Total Credit)
 *  4. No-minus: bill paid ho to bachi credit shop ke ADVANCE mein — agli bill se auto-adjust
 * Bill select na ho to purana standalone tarika (trade price, PENDING) bhi mojood hai.
 */
function NewReturnDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const user = useDMS((s) => s.user)
  const [outlets, setOutlets] = useState<OutletDTO[]>([])
  const [products, setProducts] = useState<ProductDTO[]>([])
  // Task 103-b: pehle ORDER BOOKER select — phir usi ki assigned shops (galat shop guard)
  const [bookerId, setBookerId] = useState('')
  const [outletId, setOutletId] = useState('')
  const [type, setType] = useState('DAMAGED')
  const [reason, setReason] = useState('')
  // Task 101: bill-linked state
  const [billsLoading, setBillsLoading] = useState(false)
  const [billOpts, setBillOpts] = useState<BillReturnOptionsDTO | null>(null)
  const [billId, setBillId] = useState('') // '' = standalone (purana tarika)
  const [billQtys, setBillQtys] = useState<Record<string, number>>({})
  const [fullBill, setFullBill] = useState(false)
  // standalone lines
  const [lines, setLines] = useState<{ productId: string; qtyPcs: number }[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setBookerId(''); setOutletId(''); setLines([]); setReason(''); setBillId(''); setBillQtys({}); setBillOpts(null); setFullBill(false)
    api<{ outlets: OutletDTO[] }>(`/api/outlets?userId=${user.id}`).then((r) => setOutlets(r.outlets)).catch(() => {})
    api<{ products: ProductDTO[] }>(`/api/products?userId=${user.id}`).then((r) => setProducts(r.products)).catch(() => {})
  }, [open, user])

  // Task 103-b: booker list outlets se derive (OutletDTO.salesmanId/Name API se aata hai) —
  // ek hi booker ho (e.g. SALESMAN khud) to auto-select
  const bookers = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of outlets) if (o.salesmanId && o.salesmanName) m.set(o.salesmanId, o.salesmanName)
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [outlets])
  const unassignedCount = outlets.filter((o) => !o.salesmanId).length
  useEffect(() => {
    if (open && bookers.length === 1 && !bookerId) setBookerId(bookers[0].id)
  }, [open, bookers, bookerId])
  // Sirf selected booker ki ASSIGNED shops (user rule: "galat shop main return na ho")
  const visibleOutlets = outlets.filter((o) =>
    bookerId === UNASSIGNED ? !o.salesmanId : bookerId ? o.salesmanId === bookerId : false,
  )

  function pickBooker(v: string) {
    setBookerId(v)
    setOutletId(''); setBillOpts(null); setBillId(''); setBillQtys({}); setFullBill(false)
  }

  // Outlet change => settled bills + shop advance info (chhoti detail)
  useEffect(() => {
    setBillOpts(null); setBillId(''); setBillQtys({}); setFullBill(false)
    if (!open || !outletId) return
    let alive = true
    setBillsLoading(true)
    api<BillReturnOptionsDTO>(`/api/returns/bill-options?outletId=${outletId}`)
      .then((r) => { if (alive) setBillOpts(r) })
      .catch(() => { if (alive) setBillOpts(null) })
      .finally(() => { if (alive) setBillsLoading(false) })
    return () => { alive = false }
  }, [open, outletId])

  const bill = billOpts?.bills.find((b) => b.id === billId) ?? null
  const isBillMode = !!bill

  // Live totals — server (applyBillReturnEffects) ka EXACT math mirror:
  // effRate value + pro-rata caps (settlement effective remaining par)
  let retQty = 0, returnValue = 0, gstRev = 0, taxRev = 0, toRev = 0, overCap = false
  if (bill) {
    for (const it of bill.items) {
      const q = billQtys[it.productId] ?? 0
      if (q > 0) { retQty += q; returnValue += q * it.effRate }
      if (q > it.returnable) overCap = true
    }
    returnValue = round2v(returnValue)
    const cap = (full: number, remaining: number) =>
      returnValue > 0 && bill.total > 0 && full > 0 ? Math.min(round2v((full * returnValue) / bill.total), remaining) : 0
    gstRev = cap(bill.gstTotal, bill.settlement.gstTotal)
    taxRev = cap(bill.advanceTax, bill.settlement.advanceTax)
    toRev = cap(bill.tradeOfferTotal, bill.settlement.tradeOfferTotal)
  }
  const totalCredit = Math.max(0, round2v(returnValue + gstRev + taxRev - toRev))
  const outstanding = Math.max(0, billOpts?.outlet.balance ?? 0)
  const advancePortion = Math.max(0, round2v(totalCredit - outstanding))

  function setQty(productId: string, totalPcs: number) {
    setFullBill(false)
    setBillQtys({ ...billQtys, [productId]: Math.max(0, Math.floor(totalPcs || 0)) })
  }

  function toggleFullBill(on: boolean) {
    setFullBill(on)
    if (!bill) return
    if (on) setBillQtys(Object.fromEntries(bill.items.map((it) => [it.productId, it.returnable])))
    else setBillQtys({})
  }

  async function save() {
    if (isBillMode) {
      if (!bill || retQty === 0) {
        toast({ title: 'Missing info', description: 'Return qty enter karein', variant: 'destructive' }); return
      }
      if (overCap) {
        toast({ title: 'Qty zyada hai', description: 'Return qty returnable se zyada nahi ho sakti', variant: 'destructive' }); return
      }
      setSaving(true)
      try {
        const r = await api<{ return: { returnNo: string; status: string; message?: string } }>('/api/returns', {
          method: 'POST',
          body: JSON.stringify({
            outletId, type, reason,
            orderId: bill.id,
            items: bill.items.map((it) => ({ productId: it.productId, qty: billQtys[it.productId] ?? 0 })).filter((x) => x.qty > 0),
          }),
        })
        toast({
          title: `Return ${r.return.returnNo} ✓`,
          description: r.return.message ?? (r.return.status === 'PENDING' ? 'Bill-linked return PENDING hai — distributor approve kare' : 'Approved — stock + khata update ho gaya'),
        })
        onOpenChange(false)
        onCreated()
      } catch (e) {
        toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
      } finally { setSaving(false) }
      return
    }
    // ---- standalone (purana tarika) ----
    if (!outletId || lines.length === 0) {
      toast({ title: 'Missing info', description: 'Outlet aur items select karein', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      const r = await api<{ return: { returnNo: string } }>('/api/returns', {
        method: 'POST',
        body: JSON.stringify({ outletId, type, reason, items: lines.map((l) => ({ productId: l.productId, qty: l.qtyPcs })) }),
      })
      toast({ title: `Return ${r.return.returnNo} Created ✓`, description: 'Approval ke liye pending hai — approve par unsold stock inventory mein add hoga (damage/expired nahi hoga)' })
      onOpenChange(false)
      onCreated()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const returnableBills = (billOpts?.bills ?? []).filter((b) => !b.fullyReturned)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Sale Return</DialogTitle>
          <DialogDescription>Bill select kar ke usi bill ka maal wapas karein (full amount + taxes) — ya bina bill general return</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {/* Task 103-b: ORDER BOOKER pehle — phir usi ki assigned shops hi dropdown mein */}
          <div className="grid gap-1.5"><Label>Order Booker (Route)</Label>
            <Select value={bookerId} onValueChange={pickBooker}>
              <SelectTrigger><SelectValue placeholder="Pehle order booker select karein" /></SelectTrigger>
              <SelectContent>
                {bookers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                {unassignedCount > 0 && (
                  <SelectItem value={UNASSIGNED}>Bina booker — unassigned shops ({unassignedCount})</SelectItem>
                )}
                {bookers.length === 0 && unassignedCount === 0 && (
                  <SelectItem value="__nobookers__" disabled>Koi order booker/shop nahi</SelectItem>
                )}
              </SelectContent>
            </Select>
            {bookerId && bookerId !== UNASSIGNED && (
              <p className="text-[11px] text-slate-400">{visibleOutlets.length} shop(s) is booker ke route par hain — sirf yehi select ho sakti hain</p>
            )}
          </div>

          <div className="grid gap-1.5"><Label>Outlet (Shop)</Label>
            <Select value={outletId} onValueChange={setOutletId} disabled={!bookerId}>
              <SelectTrigger><SelectValue placeholder={bookerId ? 'Select outlet' : 'Pehle order booker select karein'} /></SelectTrigger>
              <SelectContent>
                {visibleOutlets.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                {bookerId && visibleOutlets.length === 0 && (
                  <SelectItem value="__noshops__" disabled>Is booker ki koi assigned shop nahi</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Task 101: Bills dropdown — sirf processed/settled bills (ledger wale hi) */}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Bill (jis se return karna hai)</Label>
              {billsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            </div>
            <Select
              value={billId || STANDALONE}
              onValueChange={(v) => { setBillId(v === STANDALONE ? '' : v); setBillQtys({}); setFullBill(false) }}
              disabled={!outletId || billsLoading}
            >
              <SelectTrigger><SelectValue placeholder={outletId ? (billsLoading ? 'Bills load ho rahe hain…' : 'Bill select karein') : 'Pehle outlet select karein'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={STANDALONE}>Bina bill — general return (purana tarika)</SelectItem>
                {returnableBills.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.orderNo} • {fmtDate(b.orderDate)} • {fmtPKR(b.total)} {b.settlement.status === 'CASH' ? '(Cash)' : b.settlement.status === 'CREDIT' ? '(Udhaar)' : '(Partial)'} — bacha {b.returnableQty} pcs
                  </SelectItem>
                ))}
                {billOpts && returnableBills.length === 0 && (
                  <SelectItem value="__nobills__" disabled>Is shop ka koi settled bill (jis par kuch returnable ho) nahi</SelectItem>
                )}
              </SelectContent>
            </Select>
            {billOpts && billOpts.outlet.advanceBalance > 0.005 && (
              <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-1.5">
                Is shop ke paas <b>Advance Rs {fmtPKR(billOpts.outlet.advanceBalance)}</b> hai ({billOpts.outlet.advanceSources.map((s) => s.returnNo).join(', ')}) — agli bill se auto-adjust ho jayega
              </p>
            )}
          </div>

          {isBillMode && bill && (
            <>
              <div className="rounded-lg border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs min-w-[540px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left font-semibold px-2 py-1.5">Item</th>
                      <th className="text-center font-semibold px-1 py-1.5">Billed</th>
                      <th className="text-center font-semibold px-1 py-1.5">Pehle Wapas</th>
                      <th className="text-center font-semibold px-1 py-1.5">Returnable</th>
                      <th className="text-center font-semibold px-1 py-1.5">Return Qty (pcs)</th>
                      <th className="text-right font-semibold px-2 py-1.5">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bill.items.map((it) => {
                      const q = billQtys[it.productId] ?? 0
                      return (
                        <tr key={it.productId} className={q > it.returnable ? 'bg-red-50' : ''}>
                          <td className="px-2 py-1.5 text-slate-700">{it.productName}</td>
                          <td className="px-1 py-1.5 text-center text-slate-500">{it.billed}</td>
                          <td className="px-1 py-1.5 text-center text-slate-400">{it.returned}</td>
                          <td className="px-1 py-1.5 text-center font-semibold text-slate-600">{it.returnable}</td>
                          <td className="px-1 py-1.5 text-center">
                            <Input type="number" min={0} max={it.returnable} value={q || ''} onChange={(e) => setQty(it.productId, Number(e.target.value))} className="h-7 w-20 text-right mx-auto" disabled={it.returnable === 0} />
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{q > 0 ? fmtPKR(q * it.effRate) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" variant="outline" className={`h-7 text-[11px] ${fullBill ? 'bg-orange-600 text-white hover:bg-orange-700' : 'border-orange-200 text-orange-700'}`} onClick={() => toggleFullBill(!fullBill)}>
                  <Undo2 className="h-3 w-3 mr-1" /> Pura Bill Return (bacha hua sab)
                </Button>
                <span className="text-xs text-orange-700 font-semibold">Returnable: {bill.returnableQty} pcs • {fmtPKR(bill.returnableValue)}</span>
              </div>

              {retQty > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-slate-500">Return Value (bill ke actual rate par)</span><span className="font-semibold tabular-nums">{fmtPKR(returnValue)}</span></div>
                  {gstRev > 0 && <div className="flex justify-between"><span className="text-slate-500">GST wapas (+)</span><span className="font-semibold text-blue-600 tabular-nums">+ {fmtPKR(gstRev)}</span></div>}
                  {taxRev > 0 && <div className="flex justify-between"><span className="text-slate-500">Advance Tax wapas (+)</span><span className="font-semibold text-blue-600 tabular-nums">+ {fmtPKR(taxRev)}</span></div>}
                  {toRev > 0 && <div className="flex justify-between"><span className="text-slate-500">Trade Offer wapas (−)</span><span className="font-semibold text-red-500 tabular-nums">− {fmtPKR(toRev)}</span></div>}
                  <Separator />
                  <div className="flex justify-between"><span className="font-bold text-slate-700">Total Credit</span><span className="font-bold text-emerald-700 tabular-nums">{fmtPKR(totalCredit)}</span></div>
                  {advancePortion > 0.005 && (
                    <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-2 py-1">
                      Bill paid hai — Rs {fmtPKR(advancePortion)} shop ke <b>ADVANCE</b> mein jayegi (agli bill se auto-adjust — <b>balance minus mein nahi jayega</b>)
                    </p>
                  )}
                  {overCap && <p className="text-[11px] text-red-600 font-semibold">Return qty returnable se zyada hai — theek karein</p>}
                </div>
              )}
            </>
          )}

          {!isBillMode && outletId && !billsLoading && (
            <p className="text-[11px] text-slate-400">Bina bill: trade price par general return — PENDING banegi (approval distributor karega). Behtar hai bill select karein — full amount + taxes return hote hain.</p>
          )}

          <div className="grid gap-1.5"><Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DAMAGED">Damaged</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
                <SelectItem value="UNSOLD">Unsold</SelectItem>
              </SelectContent>
            </Select>
            {/* Task 29: category ka INVENTORY asar pehle se nazar aaye — galti se galat category na chune */}
            {type === 'UNSOLD' ? (
              <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-1.5">
                Unsold maal <b>fresh</b> hota hai — approve hote hi <b>inventory</b> (warehouse) mein wapas add ho jayega aur dobara sale ho sakta hai
              </p>
            ) : (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
                {type === 'DAMAGED' ? 'Damaged' : 'Expired'} maal inventory mein <b>wapas NAHI</b> jayega — ye floor par claim stock banega aur <b>Damage &amp; Expiry report</b> mein count hoga
              </p>
            )}
          </div>

          {!isBillMode && (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between"><Label>Items (qty = pcs)</Label>
                <Button size="sm" variant="outline" className="h-7 border-emerald-200 text-emerald-700" onClick={() => setLines([...lines, { productId: products[0]?.id ?? '', qtyPcs: Math.max(1, products[0]?.unitsPerCarton ?? 1) }])}>
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
              {lines.map((l, i) => {
                const lp = products.find((x) => x.id === l.productId)
                return (
                  <div key={i} className="flex gap-2 items-start">
                    {/* Task 29: SKU SEARCH — naam/SKU likh kar dhoondo (sainkdon products scroll karna mushkil tha) */}
                    <ProductCombobox
                      products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, brand: p.brand, meta: `${p.unitsPerCarton}/ctn • trade ${fmtPKR(p.tradePrice)}` }))}
                      value={l.productId}
                      onSelect={(v) => { const n = [...lines]; n[i] = { ...n[i], productId: v }; setLines(n) }}
                      triggerClassName="flex-1 h-9"
                    />
                    <UnitQtyInputs
                      pcs={l.qtyPcs}
                      upc={Math.max(1, lp?.unitsPerCarton ?? 1)}
                      pcsPerBox={lp?.pcsPerBox && lp.pcsPerBox > 0 ? lp.pcsPerBox : 0}
                      inputW="w-12"
                      onChange={(totalPcs) => { const n = [...lines]; n[i] = { ...n[i], qtyPcs: totalPcs }; setLines(n) }}
                    />
                    <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-red-400" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="grid gap-1.5"><Label>Reason</Label>
            <Select onValueChange={setReason} value={reason}>
              <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cartons crushed during transport">Transit damage</SelectItem>
                <SelectItem value="Stock expired on shelf">Expired on shelf</SelectItem>
                <SelectItem value="Near expiry - unsold">Near expiry unsold</SelectItem>
                <SelectItem value="Wrong product delivered">Wrong delivery</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={save} disabled={saving || (isBillMode && (retQty === 0 || overCap))} className="bg-emerald-600 hover:bg-emerald-700">
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          {isBillMode ? `Submit Return (${retQty} pcs — ${fmtPKR(totalCredit)} credit)` : 'Submit Return'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
