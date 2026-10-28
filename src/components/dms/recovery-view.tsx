'use client'

/**
 * RECOVERY — order-booker wise udhaar wasooli.
 * Tab 1 "Route Recovery": booker chuno -> uski route shops ki pending-udhaar sheet
 *   (amount + method per shop) -> Post = RCV voucher + ledger CREDIT + RCP receipt (ek transaction).
 * Tab 2 "History & Report": booker-wise recovery muqabla + voucher history + print.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate } from '@/lib/dms-api'
import type { ObRecoveryReportDTO, RecoveryData, RecoveryRowDTO, RecoveryShopDTO } from '@/lib/dms-types'
import { RouteSheetPrint, RecoveryReportPrint, OBRecoveryPrint } from '@/components/dms/recovery-print'
import { DAY_CODES, DAY_FULL, dayMatches } from '@/lib/dms-day'
import { HandCoins, Loader2, Printer, ReceiptText, CheckCircle2, Users, AlertTriangle, History, ClipboardCheck, XCircle, Save, Clock3, ShieldCheck, Eye, Lock, Search, ArrowUpDown, FileSpreadsheet, Banknote, CalendarDays } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

const METHOD_LABELS: Record<string, string> = { CASH: 'Cash', CHEQUE: 'Cheque', BANK: 'Bank Transfer' }
const round2 = (n: number) => Math.round(n * 100) / 100

/** Task 99: day chip style — selected = emerald filled, warna outline */
const dayChipCls = (active: boolean) =>
  `h-7 px-2.5 rounded-md border text-[11px] font-bold transition-colors whitespace-nowrap ${active ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'}`

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'border-amber-300 bg-amber-50 text-amber-700',
  APPROVED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-red-300 bg-red-50 text-red-700',
}
const STATUS_TEXT: Record<string, string> = { PENDING: 'Approval Pending', APPROVED: 'Approved', REJECTED: 'Rejected' }

/** Aging badge — FIFO oldest unpaid debit se din nikal kar 30/60/90+ color coding */
function AgingBadge({ oldestDueDate }: { oldestDueDate?: string | null }) {
  if (!oldestDueDate) return <span className="text-xs text-slate-300">—</span>
  const days = Math.max(0, Math.floor((Date.now() - new Date(oldestDueDate).getTime()) / 86400000))
  const cls = days >= 90
    ? 'border-red-300 bg-red-50 text-red-700 font-bold'
    : days >= 60
      ? 'border-orange-300 bg-orange-50 text-orange-700'
      : days >= 30
        ? 'border-amber-300 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-500'
  return <Badge variant="outline" className={`text-[10px] whitespace-nowrap ${cls}`}>{days} din{days >= 90 ? ' (90+)' : ''}</Badge>
}

interface Draft { amount: string; method: string; reference: string }
const emptyDraft = (): Draft => ({ amount: '', method: 'CASH', reference: '' })

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
  // Phase A/B UX — tab control, search/sort, confirm dialog, bulk approve, history date filters
  const [tab, setTab] = useState('route')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<'amount' | 'name'>('amount')
  // Task 99: day-wise wasooli — 'ALL' ya day code (MON..SUN); default ALL = purana behavior
  const [dayFilter, setDayFilter] = useState<string>('ALL')
  const [confirmPost, setConfirmPost] = useState(false)
  const [selPending, setSelPending] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [histFrom, setHistFrom] = useState('')
  const [histTo, setHistTo] = useState('')
  // Task 100: OB Recovery Report — booker × date ki POSTED recovery (physical cash tally)
  const [obBookerId, setObBookerId] = useState('')
  const [obDate, setObDate] = useState(() => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)) // aaj ki PKT date
  const [obReport, setObReport] = useState<ObRecoveryReportDTO | null>(null)
  const [obLoading, setObLoading] = useState(false)
  const [obPrint, setObPrint] = useState(false)

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

  // Task 99: day-wise wasooli — sab pending shops + per-day counts + day filter
  // (visitDays khali = roz visit — dayMatches har din mein shamil karta hai)
  const pendingShopsAll = useMemo(() => shops.filter((s) => s.balance > 0.005), [shops])

  const dayCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const d of DAY_CODES) counts[d] = 0
    for (const s of pendingShopsAll) for (const d of DAY_CODES) if (dayMatches(s.visitDays, d)) counts[d] += 1
    return counts
  }, [pendingShopsAll])

  const pendingShops = useMemo(
    () => (dayFilter === 'ALL' ? pendingShopsAll : pendingShopsAll.filter((s) => dayMatches(s.visitDays, dayFilter))),
    [pendingShopsAll, dayFilter],
  )

  const rows = useMemo(() => pendingShops.map((s) => {
    const d = drafts[s.outletId] ?? emptyDraft()
    const amt = parseFloat(d.amount) || 0
    return {
      shop: s, draft: d, amt,
      over: amt > round2(s.balance) + 0.005,
      needRef: d.method !== 'CASH' && !d.reference.trim(),
    }
  }), [pendingShops, drafts])

  const validRows = rows.filter((r) => r.amt > 0 && !r.over && !r.needRef)
  const enteredTotal = round2(validRows.reduce((a, r) => a + r.amt, 0))
  const hasInvalid = rows.some((r) => (r.amt > 0 && r.over) || r.needRef)

  // Search + sort — sirf display/Enter-nav ke liye; post hamesha SAB entered rows par (search se mask na ho)
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? rows.filter((r) => `${r.shop.name} ${r.shop.code} ${r.shop.code4 ?? ''} ${r.shop.city}`.toLowerCase().includes(q)) : rows
    return sortMode === 'name' ? [...list].sort((a, b) => a.shop.name.localeCompare(b.shop.name)) : list
  }, [rows, search, sortMode])

  // Aaj is route par already wasooli (zero-balance shops bhi shamil)
  const todayCollected = useMemo(() => {
    let total = 0
    let count = 0
    for (const s of shops) {
      const c = s.collectedToday ?? 0
      if (c > 0.005) { total += c; count += 1 }
    }
    return { total: round2(total), count }
  }, [shops])

  // Enter dabao → agli shop ka amount input focus; aakhri row par seedha confirm dialog
  const focusNextAmount = (outletId: string) => {
    const idx = visibleRows.findIndex((r) => r.shop.outletId === outletId)
    const next = visibleRows[idx + 1]
    if (next) {
      const el = document.getElementById(`amt-${next.shop.outletId}`) as HTMLInputElement | null
      if (el) { el.focus(); el.select() }
    } else if (validRows.length > 0) {
      setConfirmPost(true)
    }
  }

  const setDraft = (outletId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [outletId]: { ...(prev[outletId] ?? emptyDraft()), ...patch } }))
  }

  const fillFull = (outletId: string, balance: number) => setDraft(outletId, { amount: balance.toFixed(2) })
  const fillAllFull = () => {
    const next: Record<string, Draft> = {}
    for (const s of pendingShops) next[s.outletId] = { ...(drafts[s.outletId] ?? emptyDraft()), amount: s.balance.toFixed(2) }
    setDrafts(next)
  }

  // Quick chips — partial wasooli allowed hai: +1000/+5000 ADD karte hain, Full/Round-100 SET karte hain
  const addAmount = (outletId: string, inc: number) => {
    const cur = parseFloat(drafts[outletId]?.amount ?? '') || 0
    setDraft(outletId, { amount: String(round2(cur + inc)) })
  }
  const fillRound100 = (outletId: string, balance: number) => {
    const v = Math.floor(balance / 100) * 100
    if (v > 0) setDraft(outletId, { amount: v.toFixed(2) })
  }
  const clearRow = (outletId: string) => setDraft(outletId, { amount: '', reference: '' })

  /* ---------- Approvals: approve / reject / edit amount ---------- */
  const pendingRows: RecoveryRowDTO[] = data?.pending ?? []

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
      setSelPending((prev) => { if (!prev.has(row.id)) return prev; const n = new Set(prev); n.delete(row.id); return n })
      await load(userId)
    } catch (e) {
      toast({ title: 'Review action failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
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

  /* ---------- Approvals: BULK approve — booker app ki pending entries ek sath approve ---------- */
  const selTargets = pendingRows.filter((r) => selPending.has(r.id))
  const selTotal = round2(selTargets.reduce((s, r) => {
    const draftVal = parseFloat(amountDrafts[r.id] ?? '')
    return s + (draftVal > 0 ? draftVal : r.amount)
  }, 0))

  const toggleSelAll = () => {
    setSelPending((prev) => (prev.size === pendingRows.length ? new Set() : new Set(pendingRows.map((r) => r.id))))
  }

  const bulkApprove = async () => {
    if (!userId || bulkBusy || selTargets.length === 0) return
    setBulkBusy(true)
    let ok = 0
    const failed: string[] = []
    for (const r of selTargets) {
      const draftVal = parseFloat(amountDrafts[r.id] ?? '')
      const amt = draftVal > 0 ? draftVal : r.amount
      try {
        await api<{ message: string }>('/api/recovery/review', {
          method: 'POST',
          body: JSON.stringify({ userId, id: r.id, action: 'APPROVE', amount: Math.abs(amt - r.amount) > 0.004 ? amt : undefined }),
        })
        ok += 1
      } catch (e) {
        failed.push(`${r.recoveryNo}: ${e instanceof Error ? e.message : 'action fail'}`)
      }
    }
    toast({
      title: `Bulk approve: ${ok}/${selTargets.length} approve ho gayi ✓`,
      description: failed.length ? failed.join(' | ') : 'Sab shop ledgers CREDIT + receipts ban gaye',
      variant: failed.length ? 'destructive' : 'default',
    })
    setSelPending(new Set())
    setBulkBusy(false)
    await load(userId)
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
      setConfirmPost(false)
      setSuccess({ count: res.count, total: res.total, nos: res.posted.map((p) => p.recoveryNo) })
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

  /* ---------- Task 100: OB Recovery Report — generate (booker × date) ---------- */
  const generateObReport = async () => {
    if (!userId || !obBookerId || obLoading) return
    setObLoading(true)
    try {
      const d = await api<ObRecoveryReportDTO>(`/api/recovery/report?bookerId=${obBookerId}&date=${obDate}`)
      setObReport(d)
    } catch (e) {
      setObReport(null)
      toast({ title: 'Report generate failed', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setObLoading(false)
    }
  }

  /** PKT time — report print jaisi hi ("2:45 pm") */
  const obTimeUI = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' })

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
  const historyRows: RecoveryRowDTO[] = (data?.history ?? []).filter((r) => {
    if (historyFilter !== 'all' && (r.bookerId ?? 'none') !== historyFilter) return false
    if (histFrom && new Date(r.date) < new Date(`${histFrom}T00:00:00`)) return false
    if (histTo && new Date(r.date) > new Date(`${histTo}T23:59:59.999`)) return false
    return true
  })

  // Excel (CSV) export — UTF-8 BOM ke sath taake Excel mein Urdu/symbols sahi khulen
  const exportHistoryCsv = () => {
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const head = ['Voucher #', 'Date', 'Booker', 'Shop', 'Code', 'Method', 'Reference', 'Amount', 'Status', 'Posted By', 'Note']
    const lines = [
      head.join(','),
      ...historyRows.map((r) => [
        r.recoveryNo,
        new Date(r.date).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
        r.bookerName,
        r.outletName,
        r.outletCode,
        METHOD_LABELS[r.method] ?? r.method,
        r.reference ?? '',
        r.amount.toFixed(2),
        r.status,
        r.postedByName ?? '',
        r.note ?? '',
      ].map(esc).join(',')),
    ]
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `recovery-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: `Excel export: ${historyRows.length} vouchers ✓`, description: 'CSV file download ho gayi — Excel mein khul jayegi' })
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* KPI header */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {[
          { label: 'Total Pending Udhaar (Sab Routes)', value: data?.totals.outstanding ?? 0, cls: 'text-red-600', icon: AlertTriangle, tab: 'route' },
          { label: 'Recovered Today (Sab Bookers)', value: data?.totals.recoveredToday ?? 0, cls: 'text-emerald-600', icon: HandCoins, tab: 'report' },
          { label: 'Recovered This Month', value: data?.totals.recoveredMonth ?? 0, cls: 'text-blue-600', icon: History, tab: 'report' },
          { label: `Pending Approvals (${data?.totals.pendingCount ?? 0} entries)`, value: data?.totals.pendingAmount ?? 0, cls: 'text-amber-600', icon: Clock3, tab: 'approvals' },
        ].map((k) => (
          <Card
            key={k.label}
            role="button" tabIndex={0}
            onClick={() => setTab(k.tab)} onKeyDown={(e) => { if (e.key === 'Enter') setTab(k.tab) }}
            title="Click — mutaliqa tab khulega"
            className={`border-slate-200 cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${k.cls === 'text-amber-600' ? 'border-amber-200' : ''}`}
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
          <TabsTrigger value="obreport" className="data-[state=active]:bg-white data-[state=active]:text-emerald-700">
            <Banknote className="h-3.5 w-3.5 mr-1.5" /> OB Recovery Report
          </TabsTrigger>
        </TabsList>

        {/* ==================== TAB 1: ROUTE RECOVERY ==================== */}
        <TabsContent value="route" className="flex-1 min-h-0 mt-3 flex flex-col gap-3">
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

          {/* Booker select row */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Select value={bookerId} onValueChange={(v) => { setBookerId(v); setSuccess(null) }}>
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
            <div className="ml-auto flex items-center gap-2">
              <Input type="date" value={recDate} onChange={(e) => setRecDate(e.target.value)} className="h-9 w-38 text-xs" title="Recovery date" />
              <Button size="sm" variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50 h-9" disabled={pendingShops.length === 0} onClick={() => setPrintSheet(true)} title="Day-wise wasooli sheet print karein — booker route par hath se bhare ga">
                <Printer className="h-3.5 w-3.5 mr-1.5" /> Route Sheet
              </Button>
            </div>
          </div>

          {/* Task 99: Day-wise selector — kis din ki visit shops ki wasooli list/print
              (roz wali shops har din ki list mein aati hain; ALL = purana poora route) */}
          {selectedBooker && shops.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mr-0.5">Visit Day:</span>
              <button type="button" onClick={() => setDayFilter('ALL')} className={dayChipCls(dayFilter === 'ALL')} title="Sari pending shops — koi day filter nahi">
                All <span className={`ml-0.5 text-[10px] font-semibold ${dayFilter === 'ALL' ? 'text-emerald-50' : 'text-slate-400'}`}>{pendingShopsAll.length}</span>
              </button>
              {DAY_CODES.map((d) => (
                <button key={d} type="button" onClick={() => setDayFilter(d)} className={dayChipCls(dayFilter === d)} title={`${DAY_FULL[d]} ki visit shops ki wasooli list`}>
                  {d} <span className={`ml-0.5 text-[10px] font-semibold ${dayFilter === d ? 'text-emerald-50' : 'text-slate-400'}`}>{dayCounts[d]}</span>
                </button>
              ))}
              {dayFilter !== 'ALL' && (
                <span className="text-[11px] font-semibold text-violet-600">
                  {DAY_FULL[dayFilter]}: {pendingShops.length} pending shops — Route Sheet isi din ki print hogi
                </span>
              )}
            </div>
          )}

          {/* Aaj ki wasooli strip — already-collected shops ka badge/summary */}
          {todayCollected.total > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 flex items-center gap-2 shrink-0">
              <HandCoins className="h-4 w-4 text-emerald-600 shrink-0" />
              <p className="text-xs font-semibold text-emerald-800">
                Aaj wasooli: {fmtPKR(todayCollected.total)} — {todayCollected.count} shop{todayCollected.count > 1 ? 's' : ''} mein collected (sheet mein bhi badge nazar aata hai)
              </p>
            </div>
          )}

          {/* Search + sort toolbar */}
          {pendingShops.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="relative flex-1 min-w-44 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Shop search: naam / code / city" className="h-9 pl-8 text-sm" />
              </div>
              <button
                type="button"
                onClick={() => setSortMode((m) => (m === 'amount' ? 'name' : 'amount'))}
                className="h-9 flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-colors"
                title="Sort toggle — bara udhaar pehle ya naam A-Z"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort: {sortMode === 'amount' ? 'Amount (bara pehle)' : 'Name (A-Z)'}
              </button>
              {search && <span className="text-[11px] text-slate-400">{visibleRows.length}/{pendingShops.length} shops nazar aa rahi</span>}
            </div>
          )}

          {/* Shops sheet — scroll area (footer neeche pinned hai) */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
          <Card className="border-slate-200">
            <CardContent className="p-0">
              {shopsLoading ? (
                <div className="p-6 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
              ) : pendingShops.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">Is booker ke route mein koi pending udhaar nahi</p>
                  <p className="text-xs text-slate-400 mt-1">Sab shops settled hain — dusra booker select karein</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[900px]">
                      <TableHeader>
                        <TableRow className="bg-slate-50/70">
                          <TableHead>Shop</TableHead>
                          <TableHead>City</TableHead>
                          <TableHead className="text-right">Pending Udhaar</TableHead>
                          <TableHead className="text-center" style={{ width: 84 }}>Aging</TableHead>
                          <TableHead className="text-center" style={{ width: 170 }}>Wasooli Amount</TableHead>
                          <TableHead className="text-center" style={{ width: 130 }}>Method</TableHead>
                          <TableHead className="text-center" style={{ width: 150 }}>Reference</TableHead>
                          <TableHead className="text-center" style={{ width: 64 }}></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleRows.map((r) => (
                          <TableRow key={r.shop.outletId} className={r.amt > 0 && !r.over ? 'bg-emerald-50/40' : undefined}>
                            <TableCell>
                              <p className="text-sm font-medium text-slate-800">{r.shop.name}</p>
                              <p className="text-[10px] text-slate-400"><span className="font-mono font-bold text-slate-600">{r.shop.code4 ?? r.shop.code}</span> • {r.shop.channel}</p>
                              {(r.shop.collectedToday ?? 0) > 0.005 && (
                                <Badge variant="outline" className="mt-1 border-emerald-300 bg-emerald-50 text-emerald-700 text-[9px]">Aaj: {fmtPKR(r.shop.collectedToday ?? 0)} wasooli</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">{r.shop.city}</TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm font-bold text-red-600 whitespace-nowrap">{fmtPKR(r.shop.balance)}</span>
                            </TableCell>
                            <TableCell className="text-center"><AgingBadge oldestDueDate={r.shop.oldestDueDate} /></TableCell>
                            <TableCell>
                              <Input
                                id={`amt-${r.shop.outletId}`}
                                type="number" min={0} step={0.01} inputMode="decimal"
                                value={r.draft.amount}
                                onChange={(e) => setDraft(r.shop.outletId, { amount: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNextAmount(r.shop.outletId) } }}
                                placeholder="0"
                                className={`h-8 text-right text-sm ${r.over ? 'border-red-400 ring-1 ring-red-200' : ''}`}
                              />
                              {r.over && <p className="text-[10px] text-red-500 mt-0.5">Udhaar sirf {fmtPKR(r.shop.balance)} hai</p>}
                              <div className="mt-1 flex flex-wrap gap-1">
                                <button type="button" onClick={() => fillFull(r.shop.outletId, r.shop.balance)} className="h-5 rounded border border-slate-200 bg-white px-1.5 text-[9px] font-bold text-slate-600 hover:border-emerald-400 hover:text-emerald-700 transition-colors" title="Poora udhaar">Full</button>
                                <button type="button" onClick={() => addAmount(r.shop.outletId, 1000)} className="h-5 rounded border border-slate-200 bg-white px-1.5 text-[9px] font-bold text-slate-600 hover:border-emerald-400 hover:text-emerald-700 transition-colors" title="Rs 1000 add (partial allowed)">+1000</button>
                                <button type="button" onClick={() => addAmount(r.shop.outletId, 5000)} className="h-5 rounded border border-slate-200 bg-white px-1.5 text-[9px] font-bold text-slate-600 hover:border-emerald-400 hover:text-emerald-700 transition-colors" title="Rs 5000 add (partial allowed)">+5000</button>
                                <button type="button" onClick={() => fillRound100(r.shop.outletId, r.shop.balance)} className="h-5 rounded border border-slate-200 bg-white px-1.5 text-[9px] font-bold text-slate-600 hover:border-emerald-400 hover:text-emerald-700 transition-colors" title="100 ke round mein (neeche wala)">Round-100</button>
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
                            <TableCell className="text-center">
                              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] text-slate-400 hover:text-red-600 hover:border-red-300" onClick={() => clearRow(r.shop.outletId)} title="Row clear karein">Clear</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          </div>

          {/* Pinned footer — hamesha nazar (scroll ke sath nahi jata) */}
          {pendingShops.length > 0 && !shopsLoading && (
            <div className="shrink-0 border border-slate-200 bg-white rounded-xl px-4 py-3 flex flex-wrap items-center gap-2 shadow-sm">
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
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-9" onClick={() => setConfirmPost(true)} disabled={posting || validRows.length === 0}>
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
              <p className="text-[11px] text-amber-700 mt-0.5">Amount edit kar sakte hain — ghalat entry Reject karein (ledger bilkul nahi chhooti). Approve par RCV + ledger CREDIT + RCP receipt ek sath banti hai.</p>
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
                    <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[11px]">Total: {fmtPKR(pendingRows.reduce((s, r) => s + r.amount, 0))}</Badge>
                  </div>
                  {selPending.size > 0 && (
                    <div className="px-4 py-2 bg-emerald-50/70 border-b border-emerald-100 flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-bold text-emerald-800 mr-auto">{selPending.size} selected — {fmtPKR(selTotal)}</p>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSelPending(new Set())} disabled={bulkBusy}>Clear</Button>
                      <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-[11px]" onClick={bulkApprove} disabled={bulkBusy}>
                        {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                        Approve Selected ({selPending.size})
                      </Button>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <Table className="min-w-[940px]">
                      <TableHeader>
                        <TableRow className="bg-slate-50/70">
                          <TableHead className="text-center" style={{ width: 40 }}>
                            <input type="checkbox" checked={pendingRows.length > 0 && selPending.size === pendingRows.length} onChange={toggleSelAll} className="h-3.5 w-3.5 accent-emerald-600 cursor-pointer" title="Sab select / clear" />
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
                            <TableRow key={r.id} className={`bg-amber-50/20 ${selPending.has(r.id) ? 'ring-1 ring-inset ring-emerald-200' : ''}`}>
                              <TableCell className="text-center">
                                <input
                                  type="checkbox"
                                  checked={selPending.has(r.id)}
                                  onChange={() => setSelPending((prev) => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })}
                                  className="h-3.5 w-3.5 accent-emerald-600 cursor-pointer"
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
                                <p className="text-[10px] text-slate-400 font-mono">{r.outletCode4 ?? r.outletCode}</p>
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
          <div className="flex items-center justify-between gap-2 shrink-0">
            <p className="text-sm font-semibold text-slate-600">Booker-wise recovery performance + voucher history</p>
            <Button size="sm" variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50" onClick={() => setPrintReport(true)}>
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Print Report
            </Button>
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
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mr-auto">B) Recovery Voucher History ({historyRows.length})</p>
                <Input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} className="h-7 w-36 text-xs" title="From date" />
                <span className="text-xs text-slate-400">se</span>
                <Input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)} className="h-7 w-36 text-xs" title="To date" />
                <span className="text-xs text-slate-400">tak</span>
                {(histFrom || histTo) && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-500" onClick={() => { setHistFrom(''); setHistTo('') }}>Clear</Button>
                )}
                <Select value={historyFilter} onValueChange={setHistoryFilter}>
                  <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Sab bookers</SelectItem>
                    {data?.bookers.map((b) => <SelectItem key={b.id ?? 'none'} value={b.id ?? 'none'}>{b.id ? b.name : 'Unassigned'}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-[11px]" onClick={exportHistoryCsv} disabled={historyRows.length === 0}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Excel
                </Button>
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
                          <p className="text-[10px] text-slate-400 font-mono">{r.outletCode4 ?? r.outletCode}</p>
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

        {/* ==================== TAB 4: OB RECOVERY REPORT (Task 100 — cash tally) ==================== */}
        <TabsContent value="obreport" className="flex-1 min-h-0 mt-3 flex flex-col gap-3 overflow-y-auto pr-0.5">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex items-start gap-2.5 shrink-0">
            <Banknote className="h-4.5 w-4.5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-800">Order booker ki POSTED recovery report — physical cash tally ke liye</p>
              <p className="text-[11px] text-emerald-700 mt-0.5">Pehle order booker chunein, phir date pick karein (koi bhi old date chal jayegi) aur Generate Report dabayen. Sirf APPROVED entries aati hain — pending approvals shamil nahi hoti.</p>
            </div>
          </div>

          {/* Controls — booker + date + generate (Finexa flow: select karo, phir generate) */}
          <Card className="border-slate-200 shrink-0">
            <CardContent className="p-4 flex flex-wrap items-end gap-2.5">
              <div className="min-w-52 flex-1 max-w-sm">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1"><Users className="h-3 w-3" /> Order Booker</label>
                <Select value={obBookerId} onValueChange={(v) => { setObBookerId(v); setObReport(null) }}>
                  <SelectTrigger className="h-9 mt-1 text-sm"><SelectValue placeholder="Order booker chunein" /></SelectTrigger>
                  <SelectContent>
                    {data?.bookers.map((b) => (
                      <SelectItem key={b.id ?? 'none'} value={b.id ?? 'none'}>{b.id ? b.name : 'Unassigned Shops (Direct)'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Date</label>
                <Input type="date" value={obDate} onChange={(e) => { setObDate(e.target.value); setObReport(null) }} className="h-9 mt-1 w-40 text-xs" title="Kisi bhi purani date ki posted recovery report" />
              </div>
              <Button className="bg-emerald-600 hover:bg-emerald-700 h-9" onClick={generateObReport} disabled={!obBookerId || obLoading}>
                {obLoading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Search className="h-4 w-4 mr-1.5" />}
                Generate Report
              </Button>
              {obReport && (
                <Button variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50 h-9" onClick={() => setObPrint(true)} disabled={obReport.entries.length === 0}>
                  <Printer className="h-4 w-4 mr-1.5" /> Print Report
                </Button>
              )}
            </CardContent>
          </Card>

          {obReport && (
            <>
              {/* summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
                {[
                  { label: `Posted Recovery — ${obReport.date}`, value: obReport.totals.total, cls: 'text-emerald-600' },
                  { label: 'Cash (jama honi wali)', value: obReport.totals.cash, cls: 'text-green-700' },
                  { label: 'Cheque / Bank', value: obReport.totals.nonCash, cls: 'text-blue-600' },
                ].map((k) => (
                  <Card key={k.label} className="border-slate-200">
                    <CardContent className="px-4 py-3">
                      <p className="text-[11px] text-slate-400 font-medium truncate">{k.label}</p>
                      <p className={`text-lg font-bold leading-tight ${k.cls}`}>{fmtPKR(k.value)}</p>
                    </CardContent>
                  </Card>
                ))}
                <Card className="border-slate-200">
                  <CardContent className="px-4 py-3">
                    <p className="text-[11px] text-slate-400 font-medium truncate">Shops / Entries</p>
                    <p className="text-lg font-bold leading-tight text-slate-700">{obReport.totals.shops} / {obReport.totals.count}</p>
                  </CardContent>
                </Card>
              </div>

              {/* entries preview */}
              <Card className="border-slate-200 shrink-0">
                <CardContent className="p-0">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mr-auto">
                      {obReport.booker.name} — Posted Entries ({obReport.entries.length})
                    </p>
                    {obReport.entries.length === 0 && (
                      <Badge variant="outline" className="border-slate-300 text-slate-500 text-[11px]">Koi posted recovery nahi</Badge>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[820px]">
                      <TableHeader>
                        <TableRow className="bg-slate-50/70">
                          <TableHead className="text-center" style={{ width: 40 }}>#</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Voucher #</TableHead>
                          <TableHead>Shop</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead className="text-center">Method</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {obReport.entries.length === 0 ? (
                          <TableRow><TableCell colSpan={8} className="text-center text-sm text-slate-400 py-8">Is date par posted recovery nahi mili — date/booker badal kar dobara try karein</TableCell></TableRow>
                        ) : obReport.entries.map((e, i) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-center text-xs text-slate-400">{i + 1}</TableCell>
                            <TableCell className="text-xs text-slate-500 whitespace-nowrap">{obTimeUI(e.time)}</TableCell>
                            <TableCell className="text-xs font-bold text-emerald-700 whitespace-nowrap">{e.recoveryNo}</TableCell>
                            <TableCell>
                              <p className="text-sm text-slate-800">{e.outletName}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{e.outletCode4 ?? e.outletCode}</p>
                            </TableCell>
                            <TableCell className="text-xs text-slate-500 max-w-52"><span className="line-clamp-2">{[e.outletAddress, e.outletCity].filter(Boolean).join(', ') || '—'}</span></TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className={`text-[10px] ${e.method === 'CASH' ? 'border-emerald-200 text-emerald-700' : 'border-blue-200 text-blue-700'}`}>{METHOD_LABELS[e.method] ?? e.method}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">{e.reference ?? '—'}</TableCell>
                            <TableCell className="text-right text-sm font-bold whitespace-nowrap">{fmtPKR(e.amount)}</TableCell>
                          </TableRow>
                        ))}
                        {obReport.entries.length > 0 && (
                          <TableRow className="bg-slate-50/70">
                            <TableCell colSpan={7} className="text-right text-sm font-bold text-slate-700">Total Posted ({obReport.totals.shops} shops)</TableCell>
                            <TableCell className="text-right text-sm font-bold text-emerald-700 whitespace-nowrap">{fmtPKR(obReport.totals.total)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50/50 rounded-b-xl">
                    <p className="text-[11px] text-slate-500">
                      Print par: S.No | Time | Voucher | Shop Code | Shop Name | Address | Method | Reference | Amount — booker sign + office sign ke sath. Ye report cash tally ke liye hai.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Print overlays */}
      {printSheet && selectedBooker && (
        <RouteSheetPrint
          businessName={user?.profile?.businessName ?? 'Company HQ'}
          bookerName={bookerName}
          bookerPhone={selectedBooker.phone}
          date={recDate ? new Date(recDate + 'T12:00:00').toISOString() : new Date().toISOString()}
          day={dayFilter}
          shops={pendingShops}
          onClose={() => setPrintSheet(false)}
        />
      )}
      {printReport && data && (
        <RecoveryReportPrint
          businessName={user?.profile?.businessName ?? 'Company HQ'}
          bookers={data.bookers}
          history={data.history}
          onClose={() => setPrintReport(false)}
        />
      )}
      {obPrint && obReport && (
        <OBRecoveryPrint
          businessName={user?.profile?.businessName ?? 'Company HQ'}
          bookerName={obReport.booker.name}
          bookerPhone={obReport.booker.phone}
          date={obReport.date}
          entries={obReport.entries}
          totals={obReport.totals}
          onClose={() => setObPrint(false)}
        />
      )}

      {/* Post confirm dialog — ghalat post se bachne ke liye */}
      <Dialog open={confirmPost} onOpenChange={setConfirmPost}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5"><HandCoins className="h-4.5 w-4.5 text-emerald-600" /> Recovery post karein?</DialogTitle>
            <DialogDescription>
              {validRows.length} shop{validRows.length > 1 ? 's' : ''} — <b className="text-emerald-700">{fmtPKR(enteredTotal)}</b>
              {recDate ? ` — date ${recDate}` : ''}. Post ke baad RCV vouchers + shop ledgers + receipts foran ban jayenge.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
            {validRows.map((r) => (
              <div key={r.shop.outletId} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                <span className="min-w-0 truncate text-slate-700">{r.shop.name} <span className="text-slate-400 font-mono">({r.shop.code4 ?? r.shop.code})</span></span>
                <span className="font-bold text-slate-800 whitespace-nowrap">{fmtPKR(r.amt)} <span className="font-normal text-slate-400">• {METHOD_LABELS[r.draft.method]}</span></span>
              </div>
            ))}
          </div>
          {hasInvalid && <p className="text-[11px] text-amber-600 -mt-1">Ghalat entries post mein shamil nahi hongi — unhe theek karein ya row clear karein.</p>}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmPost(false)} disabled={posting}>Wapas</Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={posting || validRows.length === 0} onClick={post}>
              {posting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <HandCoins className="h-4 w-4 mr-1.5" />}
              Confirm — {fmtPKR(enteredTotal)}
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
