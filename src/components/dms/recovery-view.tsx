'use client'

/**
 * RECOVERY — order-booker wise udhaar wasooli.
 * Tab 1 "Route Recovery": booker chuno -> uski route shops ki pending-udhaar sheet
 *   (amount + method per shop) -> Post = RCV voucher + ledger CREDIT + RCP receipt (ek transaction).
 *   UX v2: search + sort, quick chips (Full/R100/1000/5000), Enter-next navigation,
 *   post confirm dialog, sticky action bar, udhaar aging, aaj-ki-wasooli badges
 *   (double-entry guard: admin post + booker pending dono nazar aate hain).
 * Tab 2 "Recovery Approvals": bookers ki pending recoveries — single + BULK approve.
 * Tab 3 "History & Report": booker-wise muqabla + voucher history (date filter) + Excel/print.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate } from '@/lib/dms-api'
import type { RecoveryData, RecoveryRowDTO, RecoveryShopDTO } from '@/lib/dms-types'
import { agingBucket, filterSortShops, roundDownTo, type SortKey } from '@/lib/dms-recovery-ui'
import { exportRecoveryHistoryExcel } from '@/lib/excel-export'
import { RouteSheetPrint, RecoveryReportPrint } from '@/components/dms/recovery-print'
import { HandCoins, Loader2, Printer, ReceiptText, CheckCircle2, Users, AlertTriangle, History, ClipboardCheck, XCircle, Save, Clock3, ShieldCheck, Eye, Lock, Search, ArrowDownUp, FileSpreadsheet } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

const METHOD_LABELS: Record<string, string> = { CASH: 'Cash', CHEQUE: 'Cheque', BANK: 'Bank Transfer' }
const round2 = (n: number) => Math.round(n * 100) / 100

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'border-amber-300 bg-amber-50 text-amber-700',
  APPROVED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-red-300 bg-red-50 text-red-700',
}
const STATUS_TEXT: Record<string, string> = { PENDING: 'Approval Pending', APPROVED: 'Approved', REJECTED: 'Rejected' }

/** Udhaar umar tone — dms-recovery-ui.agingBucket ke tones se match */
const AGE_TONE: Record<string, string> = {
  fresh: 'border-slate-200 text-slate-500 bg-white',
  warn: 'border-amber-300 bg-amber-50 text-amber-700',
  hot: 'border-orange-300 bg-orange-50 text-orange-700',
  critical: 'border-red-300 bg-red-50 text-red-700',
}

interface Draft { amount: string; method: string; reference: string }
const emptyDraft = (): Draft => ({ amount: '', method: 'CASH', reference: '' })

/** Quick chips — partial wasooli allowed: Full | R100 (round down) | 1000 | 5000 */
function quickChips(shop: RecoveryShopDTO): Array<{ label: string; value: number }> {
  const bal = round2(shop.balance)
  const r100 = roundDownTo(bal, 100)
  const chips: Array<{ label: string; value: number }> = [{ label: 'Full', value: bal }]
  if (r100 > 0 && r100 < bal) chips.push({ label: 'R100', value: r100 })
  if (bal >= 1000) chips.push({ label: '1000', value: 1000 })
  if (bal >= 5000) chips.push({ label: '5000', value: 5000 })
  return chips
}

export function RecoveryView() {
  const { user } = useDMS()
  const userId = user?.id

  const [data, setData] = useState<RecoveryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [bookerId, setBookerId] = useState<string>('')
  const [shops, setShops] = useState<RecoveryShopDTO[]>([])
  const [shopsLoading, setShopsLoading] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [posting, setPosting] = useState(false)
  const [success, setSuccess] = useState<{ count: number; total: number; nos: string[] } | null>(null)
  const [recDate, setRecDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [historyFilter, setHistoryFilter] = useState<string>('all')
  const [printSheet, setPrintSheet] = useState(false)
  const [printReport, setPrintReport] = useState(false)
  // Approvals — bookers ki pending recoveries
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<RecoveryRowDTO | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [togglingRoutes, setTogglingRoutes] = useState(false)
  // UX v2 — search/sort/confirm/bulk/date-filter
  const [tab, setTab] = useState('route')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('amount-desc')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set())
  const [busyBulk, setBusyBulk] = useState(false)
  const [histFrom, setHistFrom] = useState('')
  const [histTo, setHistTo] = useState('')
  const amtRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const load = useCallback(async (uid: string) => {
    try {
      const d = await api<RecoveryData>(`/api/recovery?userId=${uid}`)
      setData(d)
    } catch (e) {
      toast({ title: 'Recovery data load failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    queueMicrotask(() => { load(userId) })
  }, [userId, load])

  // Pehla booker default (data aane par)
  useEffect(() => {
    if (!data || bookerId) return
    const first = data.bookers.find((b) => b.id && b.shopsWithUdhaar > 0) ?? data.bookers.find((b) => b.id)
    if (first?.id) setBookerId(first.id)
    else if (data.bookers.some((b) => b.id === null)) setBookerId('none')
  }, [data, bookerId])

  // Booker badle to uski route shops load
  useEffect(() => {
    if (!userId || !bookerId) { setShops([]); return }
    let alive = true
    setShopsLoading(true)
    api<{ shops: RecoveryShopDTO[] }>(`/api/recovery?userId=${userId}&bookerId=${bookerId}`)
      .then((d) => { if (alive) { setShops(d.shops); setDrafts({}) } })
      .catch((e) => toast({ title: 'Route shops load failed', description: e instanceof Error ? e.message : '', variant: 'destructive' }))
      .finally(() => { if (alive) setShopsLoading(false) })
    return () => { alive = false }
  }, [userId, bookerId])

  const selectedBooker = data?.bookers.find((b) => (b.id ?? 'none') === bookerId)

  const pendingShops = useMemo(() => shops.filter((s) => s.balance > 0.005), [shops])

  // UX v2: client-side search + sort (bara udhaar pehle default)
  const visibleShops = useMemo(() => filterSortShops(pendingShops, query, sortKey), [pendingShops, query, sortKey])

  const rows = useMemo(() => visibleShops.map((s) => {
    const d = drafts[s.outletId] ?? emptyDraft()
    const amt = parseFloat(d.amount) || 0
    return {
      shop: s, draft: d, amt,
      over: amt > round2(s.balance) + 0.005,
      needRef: d.method !== 'CASH' && !d.reference.trim(),
    }
  }), [visibleShops, drafts])

  const validRows = rows.filter((r) => r.amt > 0 && !r.over && !r.needRef)
  const enteredTotal = round2(validRows.reduce((a, r) => a + r.amt, 0))
  const hasInvalid = rows.some((r) => (r.amt > 0 && r.over) || r.needRef)

  const setDraft = (outletId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [outletId]: { ...(prev[outletId] ?? emptyDraft()), ...patch } }))
  }

  const fillAllFull = () => {
    const next: Record<string, Draft> = {}
    for (const s of pendingShops) next[s.outletId] = { ...(drafts[s.outletId] ?? emptyDraft()), amount: s.balance.toFixed(2) }
    setDrafts(next)
  }

  /** Enter dabao -> agli shop ka amount focus (tez typing — mouse ki zaroorat nahi) */
  const focusNextAmount = (outletId: string) => {
    const idx = visibleShops.findIndex((s) => s.outletId === outletId)
    const next = visibleShops[idx + 1]
    if (next?.outletId) amtRefs.current[next.outletId]?.focus()
    else amtRefs.current[outletId]?.blur()
  }

  /* ---------- Approvals: approve / reject / edit amount ---------- */
  const pendingRows: RecoveryRowDTO[] = data?.pending ?? []
  const selectedTotal = round2(pendingRows.filter((r) => selectedPending.has(r.id)).reduce((s, r) => s + r.amount, 0))

  const reviewAction = async (row: RecoveryRowDTO, action: 'APPROVE' | 'REJECT' | 'EDIT', amount?: number, note?: string) => {
    if (!userId || busyId) return
    setBusyId(row.id)
    try {
      const res = await api<{ message: string }>('/api/recovery/review', {
        method: 'POST',
        body: JSON.stringify({ userId, id: row.id, action, amount, reviewNote: note }),
      })
      toast({
        title: action === 'APPROVE' ? 'Recovery approve ho gayi ✓' : action === 'REJECT' ? 'Recovery reject ho gayi' : 'Amount update ho gaya',
        description: res.message,
      })
      if (action === 'REJECT') { setRejecting(null); setRejectNote('') }
      setAmountDrafts((prev) => { const n = { ...prev }; delete n[row.id]; return n })
      setSelectedPending((prev) => { const n = new Set(prev); n.delete(row.id); return n })
      await load(userId)
    } catch (e) {
      toast({ title: 'Review action failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  /** BULK APPROVE — checkbox selected pending recoveries ek sath approve (har entry apni transaction mein) */
  const bulkApprove = async () => {
    if (!userId || selectedPending.size === 0 || busyBulk) return
    setBusyBulk(true)
    try {
      const res = await api<{ approvedCount: number; failedCount: number; message: string }>('/api/recovery/review', {
        method: 'POST',
        body: JSON.stringify({ userId, action: 'APPROVE', ids: Array.from(selectedPending) }),
      })
      toast({
        title: res.failedCount > 0 ? `Bulk approve: ${res.approvedCount} OK, ${res.failedCount} fail` : `Bulk approve ho gaya ✓ — ${res.approvedCount} entries`,
        description: res.message,
        variant: res.failedCount > 0 ? 'destructive' : undefined,
      })
      setSelectedPending(new Set())
      await load(userId)
    } catch (e) {
      toast({ title: 'Bulk approve failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyBulk(false)
    }
  }

  /* ---------- All Routes Access: admin-controlled toggle per booker ---------- */
  const toggleAllRoutes = async (bid: string, next: boolean) => {
    if (!userId || togglingRoutes) return
    setTogglingRoutes(true)
    try {
      const res = await api<{ message: string }>('/api/recovery', {
        method: 'PATCH',
        body: JSON.stringify({ userId, bookerId: bid, allRoutesOpen: next }),
      })
      toast({ title: next ? 'All Routes access ON ho gayi ✓' : 'All Routes access OFF ho gayi', description: res.message })
      await load(userId)
    } catch (e) {
      toast({ title: 'All Routes toggle failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setTogglingRoutes(false)
    }
  }

  async function post() {
    if (!userId || validRows.length === 0 || posting) return
    setPosting(true)
    try {
      const res = await api<{ posted: Array<{ recoveryNo: string; receiptNo: string; outletName: string }>; total: number; count: number }>('/api/recovery', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          bookerId: bookerId === 'none' ? null : bookerId,
          date: recDate ? new Date(recDate + 'T12:00:00').toISOString() : undefined,
          entries: validRows.map((r) => ({
            outletId: r.shop.outletId,
            amount: r.amt,
            method: r.draft.method,
            reference: r.draft.reference || undefined,
          })),
        }),
      })
      setSuccess({ count: res.count, total: res.total, nos: res.posted.map((p) => p.recoveryNo) })
      setConfirmOpen(false)
      toast({ title: `Recovery post ho gayi ✓ — ${fmtPKR(res.total)}`, description: `${res.count} shop(s) — ledgers update ho gaye` })
      await load(userId)
      const d = await api<{ shops: RecoveryShopDTO[] }>(`/api/recovery?userId=${userId}&bookerId=${bookerId}`)
      setShops(d.shops)
      setDrafts({})
    } catch (e) {
      toast({ title: 'Recovery post failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col gap-3">
        <div className="flex gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 flex-1 rounded-xl" />)}</div>
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="flex-1 rounded-xl" />
      </div>
    )
  }

  const bookerName = selectedBooker?.id ? selectedBooker.name : 'Unassigned Shops'
  const businessName = user?.profile?.businessName ?? 'Company HQ'

  // History — booker filter + date range (UX v2)
  const inHistRange = (iso: string) => {
    const t = new Date(iso).getTime()
    if (histFrom && t < new Date(histFrom + 'T00:00:00').getTime()) return false
    if (histTo && t > new Date(histTo + 'T23:59:59.999').getTime()) return false
    return true
  }
  const historyRows: RecoveryRowDTO[] = (data?.history ?? [])
    .filter((r) => historyFilter === 'all' || (r.bookerId ?? 'none') === historyFilter)
    .filter((r) => inHistRange(r.date))

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* KPI header — clickable: card par click = mutaliqa tab khulta hai */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {[
          { label: 'Total Pending Udhaar (Sab Routes)', value: data?.totals.outstanding ?? 0, cls: 'text-red-600', icon: AlertTriangle, go: 'route' as const },
          { label: 'Recovered Today (Sab Bookers)', value: data?.totals.recoveredToday ?? 0, cls: 'text-emerald-600', icon: HandCoins, go: 'report' as const },
          { label: 'Recovered This Month', value: data?.totals.recoveredMonth ?? 0, cls: 'text-blue-600', icon: History, go: 'report' as const },
          { label: `Pending Approvals (${data?.totals.pendingCount ?? 0} entries)`, value: data?.totals.pendingAmount ?? 0, cls: 'text-amber-600', icon: Clock3, go: 'approvals' as const },
        ].map((k) => (
          <Card
            key={k.label}
            role="button"
            tabIndex={0}
            aria-label={`${k.label} — tab kholein`}
            onClick={() => setTab(k.go)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTab(k.go) } }}
            className={`border-slate-200 cursor-pointer hover:shadow-md hover:border-slate-300 transition-shadow focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none ${k.cls === 'text-amber-600' ? 'border-amber-200' : ''}`}
          >
            <CardContent className="px-4 py-3 flex items-center gap-3">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${k.cls === 'text-amber-600' ? 'bg-amber-100' : 'bg-slate-100'}`}><k.icon className={`h-4.5 w-4.5 ${k.cls === 'text-amber-600' ? 'text-amber-500' : 'text-slate-500'}`} /></div>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-400 font-medium truncate">{k.label}</p>
                <p className={`text-lg font-bold leading-tight ${k.cls}`}>{fmtPKR(k.value)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
        <TabsList className="bg-slate-100 shrink-0 w-fit">
          <TabsTrigger value="route" className="data-[state=active]:bg-white data-[state=active]:text-emerald-700">
            <HandCoins className="h-3.5 w-3.5 mr-1.5" /> Route Recovery
          </TabsTrigger>
          <TabsTrigger value="approvals" className="data-[state=active]:bg-white data-[state=active]:text-amber-700">
            <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" /> Recovery Approvals
            {(data?.totals.pendingCount ?? 0) > 0 && (
              <span className="ml-1.5 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">{data?.totals.pendingCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="report" className="data-[state=active]:bg-white data-[state=active]:text-emerald-700">
            <ReceiptText className="h-3.5 w-3.5 mr-1.5" /> History &amp; Report
          </TabsTrigger>
        </TabsList>

        {/* ==================== TAB 1: ROUTE RECOVERY ==================== */}
        <TabsContent value="route" className="flex-1 min-h-0 mt-3 flex flex-col gap-3 overflow-y-auto pr-0.5">
          {success && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start gap-2.5 shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-800">Recovery post ho gayi — {fmtPKR(success.total)} ({success.count} shop{success.count > 1 ? 's' : ''})</p>
                <p className="text-xs text-emerald-700 mt-0.5">Vouchers: {success.nos.join(', ')} — shop ledgers CREDIT ho gaye, receipts (RCP) ban gaye.</p>
              </div>
              <button onClick={() => setSuccess(null)} className="ml-auto text-emerald-500 hover:text-emerald-700 text-sm font-bold">✕</button>
            </div>
          )}

          {/* Booker select + search + sort row */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Select value={bookerId} onValueChange={(v) => { setBookerId(v); setSuccess(null); setSelectedPending(new Set()) }}>
              <SelectTrigger className="h-9 w-full sm:w-80 text-sm"><SelectValue placeholder="Order booker chunein" /></SelectTrigger>
              <SelectContent>
                {data?.bookers.map((b) => (
                  <SelectItem key={b.id ?? 'none'} value={b.id ?? 'none'}>
                    {b.id ? b.name : 'Unassigned Shops (Direct)'}{b.totalOutstanding > 0 ? ` — ${fmtPKR(b.totalOutstanding)} pending` : ' — sab clear'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBooker && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="border-slate-200 text-slate-600 text-[11px]"><Users className="h-3 w-3 mr-1" />Route: {selectedBooker.routeShops} shops</Badge>
                <Badge variant="outline" className="border-red-200 text-red-600 text-[11px]">Udhaar: {selectedBooker.shopsWithUdhaar} shops • {fmtPKR(selectedBooker.totalOutstanding)}</Badge>
                <Badge variant="outline" className="border-emerald-200 text-emerald-700 text-[11px]">Month: {fmtPKR(selectedBooker.recoveredMonth)}</Badge>
              </div>
            )}
            {/* ADMIN-CONTROLLED All Routes Access — orderbooker khud nahi khol sakta */}
            {selectedBooker?.id && (
              <button
                onClick={() => toggleAllRoutes(selectedBooker.id!, !selectedBooker.allRoutesOpen)}
                disabled={togglingRoutes}
                className={`h-9 flex items-center gap-2 rounded-md border px-3 text-[11px] font-bold transition-colors disabled:opacity-60 ${selectedBooker.allRoutesOpen ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-500 hover:border-emerald-300'}`}
                title="Admin control — ON karne par booker apni login mein sab route shops dekh sakega"
              >
                {togglingRoutes ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : selectedBooker.allRoutesOpen ? <Eye className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                All Routes: {selectedBooker.allRoutesOpen ? 'ON' : 'OFF'}
                <span className={`relative h-4 w-8 rounded-full transition-colors shrink-0 ${selectedBooker.allRoutesOpen ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${selectedBooker.allRoutesOpen ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
              </button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {/* UX v2: shop search + sort */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Shop dhoondein (naam/code/city)"
                  className="h-9 w-full sm:w-52 pl-8 text-xs"
                  aria-label="Route shops mein search karein"
                />
              </div>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="h-9 w-full sm:w-44 text-xs" aria-label="Sort order">
                  <div className="flex items-center gap-1.5 min-w-0"><ArrowDownUp className="h-3.5 w-3.5 text-slate-400 shrink-0" /><SelectValue /></div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount-desc">Udhaar: bara pehle</SelectItem>
                  <SelectItem value="amount-asc">Udhaar: chhota pehle</SelectItem>
                  <SelectItem value="age-desc">Purana udhaar pehle</SelectItem>
                  <SelectItem value="name-asc">Naam: A to Z</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={recDate} onChange={(e) => setRecDate(e.target.value)} className="h-9 w-38 text-xs" title="Recovery date" />
              <Button size="sm" variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50 h-9" disabled={pendingShops.length === 0} onClick={() => setPrintSheet(true)}>
                <Printer className="h-3.5 w-3.5 mr-1.5" /> Route Sheet
              </Button>
            </div>
          </div>

          {/* Shops sheet */}
          <Card className="border-slate-200 shrink-0">
            <CardContent className="p-0">
              {shopsLoading ? (
                <div className="p-6 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
              ) : pendingShops.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">Is booker ke route mein koi pending udhaar nahi</p>
                  <p className="text-xs text-slate-400 mt-1">Sab shops settled hain — dusra booker select karein</p>
                </div>
              ) : visibleShops.length === 0 ? (
                <div className="py-12 text-center">
                  <Search className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">&quot;{query}&quot; se koi shop nahi mili</p>
                  <button onClick={() => setQuery('')} className="text-xs text-emerald-600 hover:underline mt-1">Search clear karein</button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[880px]">
                    <TableHeader>
                      <TableRow className="bg-slate-50/70">
                        <TableHead>Shop</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead className="text-right">Pending Udhaar</TableHead>
                        <TableHead className="text-center">Purana</TableHead>
                        <TableHead className="text-center" style={{ width: 170 }}>Wasooli Amount</TableHead>
                        <TableHead className="text-center" style={{ width: 120 }}>Method</TableHead>
                        <TableHead className="text-center" style={{ width: 140 }}>Reference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const age = agingBucket(r.shop.udhaarAgeDays ?? 0)
                        const chips = quickChips(r.shop)
                        return (
                          <TableRow key={r.shop.outletId} className={r.amt > 0 && !r.over ? 'bg-emerald-50/40' : undefined}>
                            <TableCell>
                              <p className="text-sm font-medium text-slate-800">{r.shop.name}</p>
                              <p className="text-[10px] text-slate-400">{r.shop.code} • {r.shop.channel}</p>
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">{r.shop.city}</TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm font-bold text-red-600 whitespace-nowrap">{fmtPKR(r.shop.balance)}</span>
                              <div className="flex flex-col items-end gap-0.5 mt-0.5">
                                {(r.shop.collectedToday ?? 0) > 0 && (
                                  <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-px whitespace-nowrap" title="Aaj is shop ki wasooli already post ho chuki hai">
                                    Aaj: {fmtPKR(r.shop.collectedToday!)} ✓
                                  </span>
                                )}
                                {(r.shop.pendingToday ?? 0) > 0 && (
                                  <span className="text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px whitespace-nowrap" title="Booker ne app se bheji hai — approval ka intezar. Approve hone par balance kam hoga.">
                                    Approval mein: {fmtPKR(r.shop.pendingToday!)}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className={`text-[9px] whitespace-nowrap ${AGE_TONE[age.tone]}`} title="FIFO oldest unpaid udhaar ki umar">
                                {age.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Input
                                ref={(el) => { amtRefs.current[r.shop.outletId] = el }}
                                type="number" min={0} step={0.01} inputMode="decimal"
                                value={r.draft.amount}
                                onChange={(e) => setDraft(r.shop.outletId, { amount: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNextAmount(r.shop.outletId) } }}
                                placeholder="0"
                                className={`h-8 text-right text-sm ${r.over ? 'border-red-400 ring-1 ring-red-200' : ''}`}
                              />
                              {r.over && <p className="text-[10px] text-red-500 mt-0.5">Udhaar sirf {fmtPKR(r.shop.balance)} hai</p>}
                              <div className="flex gap-1 mt-1 flex-wrap" role="group" aria-label={`${r.shop.name} quick amounts`}>
                                {chips.map((c) => (
                                  <button
                                    key={c.label}
                                    type="button"
                                    disabled={posting}
                                    onClick={() => setDraft(r.shop.outletId, { amount: c.value.toFixed(2) })}
                                    title={`${r.shop.name} — ${fmtPKR(c.value)}`}
                                    className="h-5 px-1.5 rounded border border-slate-200 bg-white text-[10px] font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-40 disabled:hover:border-slate-200"
                                  >
                                    {c.label}
                                  </button>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Select value={r.draft.method} onValueChange={(v) => setDraft(r.shop.outletId, { method: v })}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {Object.entries(METHOD_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                value={r.draft.reference}
                                onChange={(e) => setDraft(r.shop.outletId, { reference: e.target.value })}
                                placeholder={r.draft.method === 'CASH' ? '—' : 'Cheque/Slip #'}
                                disabled={r.draft.method === 'CASH'}
                                className={`h-8 text-xs ${r.needRef ? 'border-red-400 ring-1 ring-red-200' : ''}`}
                              />
                              {r.needRef && <p className="text-[10px] text-red-500 mt-0.5">Reference zaroori</p>}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* UX v2: STICKY action bar — Post button hamesha nazar mein (lambi route sheet par bhi) */}
          {pendingShops.length > 0 && (
            <div className="sticky bottom-0 z-20 border border-slate-200 bg-white/95 backdrop-blur px-4 py-2.5 flex flex-wrap items-center gap-2 rounded-xl shadow-[0_-6px_16px_rgba(15,23,42,0.08)]">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800">
                  {validRows.length > 0 ? `${validRows.length} shop${validRows.length > 1 ? 's' : ''} — ${fmtPKR(enteredTotal)} wasooli` : 'Amount enter karein'}
                </p>
                <p className="text-[11px] text-slate-400">Post par: RCV voucher + shop ledger CREDIT + RCP receipt (ek transaction)</p>
              </div>
              {hasInvalid && (
                <Badge variant="outline" className="border-red-300 text-red-600 text-[11px]"><AlertTriangle className="h-3 w-3 mr-1" />Ghalat entries check karein</Badge>
              )}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" className="h-9" onClick={fillAllFull} disabled={posting}>Sab Full</Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-9" onClick={() => setConfirmOpen(true)} disabled={posting || validRows.length === 0}>
                  {posting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <HandCoins className="h-4 w-4 mr-1.5" />}
                  Post Recovery{validRows.length > 0 ? ` (${fmtPKR(enteredTotal)})` : ''}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ==================== TAB 2: RECOVERY APPROVALS ==================== */}
        <TabsContent value="approvals" className="flex-1 min-h-0 mt-3 flex flex-col gap-3 overflow-y-auto pr-0.5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-start gap-2.5 shrink-0">
            <ShieldCheck className="h-4.5 w-4.5 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-800">Order bookers ki wasooli pehle APPROVE hogi, tab shop ledger update hoga</p>
              <p className="text-[11px] text-amber-700 mt-0.5">Amount edit kar sakte hain — ghalat entry Reject karein (ledger bilkul nahi chhooti). Approve par RCV + ledger CREDIT + RCP receipt ek sath banti hai. Bulk approve ke liye shops select kar ke &quot;Approve Selected&quot; dabayein.</p>
            </div>
          </div>

          <Card className="border-slate-200 shrink-0">
            <CardContent className="p-0">
              {pendingRows.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">Koi pending recovery nahi — sab clear</p>
                  <p className="text-xs text-slate-400 mt-1">Order booker apni login se recovery add karega to yahan approval ke liye aayegi</p>
                </div>
              ) : (
                <>
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mr-auto">Pending Recovery Approvals ({pendingRows.length})</p>
                    {/* UX v2: BULK APPROVE — selected entries ek sath approve */}
                    {selectedPending.size > 0 && (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 h-7 text-[11px]"
                        disabled={busyBulk}
                        onClick={bulkApprove}
                      >
                        {busyBulk ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                        Approve Selected ({selectedPending.size}) — {fmtPKR(selectedTotal)}
                      </Button>
                    )}
                    <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[11px]">Total: {fmtPKR(pendingRows.reduce((s, r) => s + r.amount, 0))}</Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[940px]">
                      <TableHeader>
                        <TableRow className="bg-slate-50/70">
                          <TableHead className="w-10">
                            <Checkbox
                              aria-label="Sab pending select karein"
                              checked={selectedPending.size === pendingRows.length && pendingRows.length > 0}
                              onCheckedChange={(v) => setSelectedPending(v ? new Set(pendingRows.map((r) => r.id)) : new Set())}
                            />
                          </TableHead>
                          <TableHead>Voucher #</TableHead>
                          <TableHead>Booker</TableHead>
                          <TableHead>Shop</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-center" style={{ width: 170 }}>Amount (Rs)</TableHead>
                          <TableHead className="text-center">Method</TableHead>
                          <TableHead>Note</TableHead>
                          <TableHead className="text-center" style={{ width: 170 }}>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingRows.map((r) => {
                          const draftVal = amountDrafts[r.id] ?? String(r.amount)
                          const changed = Math.abs((parseFloat(draftVal) || 0) - r.amount) > 0.004
                          const editedAmt = parseFloat(draftVal) || 0
                          return (
                            <TableRow key={r.id} className="bg-amber-50/20">
                              <TableCell>
                                <Checkbox
                                  aria-label={`${r.recoveryNo} select karein`}
                                  checked={selectedPending.has(r.id)}
                                  onCheckedChange={(v) => setSelectedPending((prev) => {
                                    const n = new Set(prev)
                                    if (v) n.add(r.id)
                                    else n.delete(r.id)
                                    return n
                                  })}
                                />
                              </TableCell>
                              <TableCell className="text-xs font-bold text-emerald-700 whitespace-nowrap">
                                {r.recoveryNo}
                                {r.editedAmount && r.originalAmount != null && (
                                  <p className="text-[9px] font-medium text-slate-400 whitespace-nowrap">booker: {fmtPKR(r.originalAmount)}</p>
                                )}
                              </TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{r.bookerName}</TableCell>
                              <TableCell>
                                <p className="text-sm text-slate-800">{r.outletName}</p>
                                <p className="text-[10px] text-slate-400">{r.outletCode}</p>
                              </TableCell>
                              <TableCell className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.date, true)}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  <Input
                                    type="number" min={0} step={0.01} inputMode="decimal"
                                    value={draftVal}
                                    onChange={(e) => setAmountDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                    className="h-8 w-24 text-right text-sm"
                                  />
                                  {changed && (
                                    <Button
                                      size="sm" variant="outline"
                                      className="h-7 w-7 p-0 border-blue-300 text-blue-600 hover:bg-blue-50"
                                      title="Amount save karein (recovery pending rahegi)"
                                      disabled={busyId === r.id || !(editedAmt > 0)}
                                      onClick={() => reviewAction(r, 'EDIT', editedAmt)}
                                    >
                                      {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline" className={`text-[10px] ${r.method === 'CASH' ? 'border-emerald-200 text-emerald-700' : 'border-blue-200 text-blue-700'}`}>
                                  {METHOD_LABELS[r.method] ?? r.method}
                                </Badge>
                                {r.reference && <p className="text-[9px] text-slate-400 mt-0.5">#{r.reference}</p>}
                              </TableCell>
                              <TableCell className="text-xs text-slate-500 max-w-40"><span className="line-clamp-2">{r.note ?? '—'}</span></TableCell>
                              <TableCell>
                                <div className="flex items-center justify-center gap-1.5">
                                  <Button
                                    size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700 text-[11px] px-2.5"
                                    disabled={busyId === r.id}
                                    title={changed ? 'Changed amount save karke approve hoga' : 'Approve — ledger CREDIT + receipt'}
                                    onClick={() => reviewAction(r, 'APPROVE', changed ? editedAmt : undefined)}
                                  >
                                    {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm" variant="outline"
                                    className="h-8 border-red-300 text-red-600 hover:bg-red-50 text-[11px] px-2.5"
                                    disabled={busyId === r.id}
                                    onClick={() => { setRejecting(r); setRejectNote('') }}
                                  >
                                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50/50 rounded-b-xl">
                    <p className="text-[11px] text-slate-500">
                      Approve = shop ledger <b className="text-emerald-700">CREDIT</b> + RCP receipt + booker ki route report mein count.
                      Reject = koi ledger effect nahi — booker ko rejected entry nazar aayegi wajah ke sath.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== TAB 3: HISTORY & REPORT ==================== */}
        <TabsContent value="report" className="flex-1 min-h-0 mt-3 flex flex-col gap-3 overflow-y-auto pr-0.5">
          <div className="flex items-center justify-between gap-2 shrink-0 flex-wrap">
            <p className="text-sm font-semibold text-slate-600">Booker-wise recovery performance + voucher history</p>
            <div className="flex items-center gap-2 flex-wrap">
              {/* UX v2: date range filter + Excel export */}
              <Input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} className="h-8 w-36 text-xs" aria-label="Shuru ki tareekh" />
              <span className="text-xs text-slate-400">se</span>
              <Input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)} className="h-8 w-36 text-xs" aria-label="Aakhri tareekh" />
              <Button size="sm" variant="ghost" className="h-8 text-[11px] text-slate-600" onClick={() => { const t = new Date().toISOString().slice(0, 10); setHistFrom(t); setHistTo(t) }}>
                <Clock3 className="h-3.5 w-3.5 mr-1" />Aaj
              </Button>
              {(histFrom || histTo) && (
                <Button size="sm" variant="ghost" className="h-8 text-[11px] text-slate-400 hover:text-slate-600" onClick={() => { setHistFrom(''); setHistTo('') }}>Clear</Button>
              )}
              <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" disabled={historyRows.length === 0} onClick={() => exportRecoveryHistoryExcel(historyRows, `${bookerName === 'Unassigned Shops' ? 'Sab bookers' : 'Filter: ' + bookerName} — DistriFlow`)}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Excel
              </Button>
              <Button size="sm" variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50" onClick={() => setPrintReport(true)}>
                <Printer className="h-3.5 w-3.5 mr-1.5" /> Print Report
              </Button>
            </div>
          </div>

          {/* Section A: booker-wise */}
          <Card className="border-slate-200 shrink-0">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">A) Booker Wise Recovery Muqabla</p>
              </div>
              <div className="overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow className="bg-slate-50/70">
                      <TableHead>Order Booker</TableHead>
                      <TableHead className="text-center">Route Shops</TableHead>
                      <TableHead className="text-center">Udhaar Shops</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Today</TableHead>
                      <TableHead className="text-right">This Month</TableHead>
                      <TableHead className="text-right">Total Recovery</TableHead>
                      <TableHead className="text-center">Last Recovery</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.bookers ?? []).map((b) => (
                      <TableRow key={b.id ?? 'none'}>
                        <TableCell>
                          <p className="text-sm font-medium text-slate-800">{b.id ? b.name : 'Unassigned Shops'}</p>
                          {b.phone && <p className="text-[10px] text-slate-400">{b.phone}</p>}
                        </TableCell>
                        <TableCell className="text-center text-sm">{b.routeShops}</TableCell>
                        <TableCell className="text-center text-sm">{b.shopsWithUdhaar}</TableCell>
                        <TableCell className="text-right text-sm font-semibold text-red-600 whitespace-nowrap">{fmtPKR(b.totalOutstanding)}</TableCell>
                        <TableCell className="text-right text-sm text-emerald-600 whitespace-nowrap">{b.recoveredToday > 0 ? fmtPKR(b.recoveredToday) : '—'}</TableCell>
                        <TableCell className="text-right text-sm text-emerald-700 whitespace-nowrap">{b.recoveredMonth > 0 ? fmtPKR(b.recoveredMonth) : '—'}</TableCell>
                        <TableCell className="text-right text-sm font-bold whitespace-nowrap">{b.recoveredTotal > 0 ? fmtPKR(b.recoveredTotal) : '—'}</TableCell>
                        <TableCell className="text-center text-xs text-slate-500 whitespace-nowrap">{b.lastRecoveryAt ? fmtDate(b.lastRecoveryAt) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Section B: history */}
          <Card className="border-slate-200 shrink-0">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mr-auto">B) Recovery Voucher History (Latest {historyRows.length})</p>
                <Select value={historyFilter} onValueChange={setHistoryFilter}>
                  <SelectTrigger className="h-7 w-52 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Sab bookers</SelectItem>
                    {data?.bookers.map((b) => <SelectItem key={b.id ?? 'none'} value={b.id ?? 'none'}>{b.id ? b.name : 'Unassigned'}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto">
                <Table className="min-w-[860px]">
                  <TableHeader>
                    <TableRow className="bg-slate-50/70">
                      <TableHead>Voucher #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Order Booker</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead className="text-center">Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-center">Posted By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyRows.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center text-sm text-slate-400 py-8">Abhi koi recovery voucher post nahi hui — Route Recovery tab se pehli entry karein</TableCell></TableRow>
                    ) : historyRows.map((r) => (
                      <TableRow key={r.id} className={r.status === 'REJECTED' ? 'opacity-60' : undefined}>
                        <TableCell className="text-xs font-bold text-emerald-700">
                          {r.recoveryNo}
                          {r.editedAmount && r.originalAmount != null && (
                            <p className="text-[9px] font-medium text-slate-400 whitespace-nowrap" title="Admin ne amount edit kiya">booker: {fmtPKR(r.originalAmount)}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.date, true)}</TableCell>
                        <TableCell className="text-sm">{r.bookerName}</TableCell>
                        <TableCell>
                          <p className="text-sm text-slate-800">{r.outletName}</p>
                          <p className="text-[10px] text-slate-400">{r.outletCode}</p>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-[10px] ${r.method === 'CASH' ? 'border-emerald-200 text-emerald-700' : 'border-blue-200 text-blue-700'}`}>{METHOD_LABELS[r.method] ?? r.method}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">{r.reference ?? '—'}</TableCell>
                        <TableCell className="text-right text-sm font-bold whitespace-nowrap">{fmtPKR(r.amount)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`${STATUS_BADGE[r.status] ?? ''} text-[9px] whitespace-nowrap`}>
                            {STATUS_TEXT[r.status] ?? r.status}
                          </Badge>
                          {r.status !== 'PENDING' && r.approvedByName && (
                            <p className="text-[9px] text-slate-400 mt-0.5 whitespace-nowrap">by {r.approvedByName}</p>
                          )}
                          {r.status === 'REJECTED' && r.reviewNote && (
                            <p className="text-[9px] text-red-400 mt-0.5 max-w-28 truncate" title={r.reviewNote}>{r.reviewNote}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-xs text-slate-500">{r.postedByName ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Print overlays */}
      {printSheet && selectedBooker && (
        <RouteSheetPrint
          businessName={businessName}
          bookerName={bookerName}
          bookerPhone={selectedBooker.phone}
          date={recDate ? new Date(recDate + 'T12:00:00').toISOString() : new Date().toISOString()}
          shops={pendingShops}
          onClose={() => setPrintSheet(false)}
        />
      )}
      {printReport && data && (
        <RecoveryReportPrint
          businessName={businessName}
          bookers={data.bookers}
          history={data.history}
          onClose={() => setPrintReport(false)}
        />
      )}

      {/* UX v2: POST CONFIRM — financial action se pehle poori summary (double-check guard) */}
      <Dialog open={confirmOpen} onOpenChange={(v) => { if (!posting) setConfirmOpen(v) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5"><HandCoins className="h-4.5 w-4.5 text-emerald-600" /> Recovery post confirm karein</DialogTitle>
            <DialogDescription>
              <b>{validRows.length}</b> shop{validRows.length > 1 ? 's' : ''} ki wasooli — total <b className="text-emerald-700">{fmtPKR(enteredTotal)}</b>
              {recDate ? <> — date <b>{fmtDate(new Date(recDate + 'T12:00:00').toISOString())}</b></> : null}.
              Confirm par RCV voucher + shop ledger CREDIT + RCP receipt ban jayega.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {validRows.map((r) => (
              <div key={r.shop.outletId} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{r.shop.name}</p>
                  <p className="text-[10px] text-slate-400">
                    {METHOD_LABELS[r.draft.method] ?? r.draft.method}{r.draft.reference ? ` • Ref ${r.draft.reference}` : ''}
                    {(r.shop.pendingToday ?? 0) > 0 ? ` — dhyan rakhein: booker ki Rs ${fmtPKR(r.shop.pendingToday!)} bhi approval mein hai` : ''}
                  </p>
                </div>
                <span className="font-bold text-slate-700 whitespace-nowrap">{fmtPKR(r.amt)}</span>
              </div>
            ))}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={posting} onClick={() => setConfirmOpen(false)}>Wapas</Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              disabled={posting}
              onClick={post}
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
              Confirm &amp; Post ({fmtPKR(enteredTotal)})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog — wajah booker ko nazar aayegi */}
      <Dialog open={!!rejecting} onOpenChange={(v) => { if (!v) { setRejecting(null); setRejectNote('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5"><XCircle className="h-4.5 w-4.5 text-red-500" /> Recovery Reject karein?</DialogTitle>
            <DialogDescription>
              {rejecting && <>Entry <b>{rejecting.recoveryNo}</b> — {rejecting.bookerName} ne <b>{rejecting.outletName}</b> ki <b>{fmtPKR(rejecting.amount)}</b> likhi thi. Reject par shop ledger bilkul update nahi hoga aur booker ko nazar aayega.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold text-slate-500">Wajah (booker ko nazar aayegi)</label>
            <Input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="e.g. Cash booker ke hawale nahi pohanchi / galat amount" />
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setRejecting(null); setRejectNote('') }}>Wapas</Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700"
              disabled={busyId === rejecting?.id}
              onClick={() => rejecting && reviewAction(rejecting, 'REJECT', undefined, rejectNote.trim() || undefined)}
            >
              {busyId === rejecting?.id ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <XCircle className="h-4 w-4 mr-1.5" />}
              Reject karein
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
