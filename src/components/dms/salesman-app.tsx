'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate, STATUS_STYLES, statusLabel } from '@/lib/dms-api'
import type { PJPPlanDTO, PjpTodayDTO, ProductDTO, OrderDTO, RecoveryData, RecoveryRowDTO, RecoveryShopDTO, SalesmanPerfDTO } from '@/lib/dms-types'
import { UnitQtyInputs, splitPcs, fmtQty, packHint } from '@/components/dms/unit-qty'
import { orderGrandPayable } from '@/lib/dms-order-calc'
import { DAY_LIST, DAY_LABELS, VisitDayChips } from '@/components/dms/outlets-view'
import { karachiDayCode, isSameKarachiDay } from '@/lib/dms-day'
import { Route, Store, ShoppingCart, ClipboardList, User, MapPin, LogIn, LogOut, Plus, Trash2, Loader2, CheckCircle2, Navigation, Wallet, Percent, XCircle, HandCoins, CalendarDays, Clock3, Eye, Banknote, Lock, RefreshCw, Play, Square, CloudUpload, WifiOff, ReceiptText, Target } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { addToQueue, clearSnapshot, getQueue, isNetworkError, saveSnapshot, syncQueue, useRouteState, todayStr, type PendingSync, type RouteSnapshot } from '@/lib/route-cache'

type Tab = 'day' | 'shops' | 'orders' | 'me'

const RECOVERY_METHODS: Record<string, string> = { CASH: 'Cash', CHEQUE: 'Cheque', BANK: 'Bank Transfer' }

export function SalesmanApp() {
  const user = useDMS((s) => s.user)
  const [tab, setTab] = useState<Tab>('day')
  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const { queue } = useRouteState(user?.id)

  // Offline queue sync — online aane par + har 25s (agar queue non-empty)
  const doSync = useCallback(async (silent = false) => {
    if (!user || syncing || typeof navigator === 'undefined' || !navigator.onLine) return
    if (getQueue(user.id).length === 0) return
    setSyncing(true)
    try {
      const r = await syncQueue(user.id)
      if (r.synced > 0) {
        toast({ title: `Sync ho gaya ✓ — ${r.synced} entry server par`, description: r.failed > 0 ? `${r.failed} entry fail hain — detail Orders/Recovery section mein` : 'Sab entries clear' })
      } else if (!silent && r.failed > 0) {
        toast({ title: `${r.failed} entry sync fail`, description: 'Entry ka error section mein nazar aata hai', variant: 'destructive' })
      }
    } catch { /* ignore */ } finally { setSyncing(false) }
  }, [user, syncing])

  useEffect(() => {
    const on = () => { setOnline(true); doSync(true) }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    setOnline(navigator.onLine)
    const iv = setInterval(() => { if (navigator.onLine) doSync(true) }, 25000)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      clearInterval(iv)
    }
  }, [doSync])

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Mobile header */}
      <header className="bg-emerald-600 text-white sticky top-0 z-20 shadow-md">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm">
              {user?.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">{user?.name}</p>
              <p className="text-[11px] text-emerald-100">Order Booker • Lahore</p>
            </div>
          </div>
          <div className="text-right space-y-1">
            <p className="text-[10px] text-emerald-100">{new Date().toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
            {online ? (
              <p className="text-[10px] font-bold rounded-full bg-white/20 px-2 py-0.5 inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Online
              </p>
            ) : (
              <p className="text-[10px] font-bold rounded-full bg-red-600 px-2 py-0.5 inline-flex items-center gap-1">
                <WifiOff className="h-3 w-3" /> Offline — queue mein save hoga
              </p>
            )}
            {queue.length > 0 && (
              <button onClick={() => doSync(false)} disabled={syncing || !online} className="block ml-auto text-[10px] font-bold rounded-full bg-amber-400 text-amber-950 px-2 py-0.5 disabled:opacity-60">
                {syncing ? 'Sync ho rahi hai...' : `⏳ ${queue.length} pending sync — tap karein`}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="p-3 max-w-lg mx-auto">
        {tab === 'day' && <MyDayTab online={online} syncing={syncing} onSync={() => doSync(false)} onGoShops={() => setTab('shops')} />}
        {tab === 'shops' && <ShopsTab online={online} onGoDay={() => setTab('day')} />}
        {tab === 'orders' && <MyOrdersTab />}
        {tab === 'me' && <MeTab />}
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t z-30 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4 max-w-lg mx-auto">
          {([
            { key: 'day', label: 'My Day', icon: Route },
            { key: 'shops', label: 'Shops', icon: Store },
            { key: 'orders', label: 'Orders', icon: ClipboardList },
            { key: 'me', label: 'Profile', icon: User },
          ] as { key: Tab; label: string; icon: typeof Route }[]).map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex flex-col items-center py-2.5 gap-0.5 transition-colors ${tab === t.key ? 'text-emerald-600' : 'text-slate-400'}`}>
              <t.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

/* ================= MY DAY (AAJ KI ROUTE — AUTO PJP) ================= */
function MyDayTab({ online, syncing, onSync, onGoShops }: { online: boolean; syncing: boolean; onSync: () => void; onGoShops: () => void }) {
  const user = useDMS((s) => s.user)
  const [today, setToday] = useState<PjpTodayDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [endArm, setEndArm] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endReport, setEndReport] = useState<RouteEndReport | null>(null)
  const { snapshot, today: routeToday, queue } = useRouteState(user?.id)
  const stale = !!snapshot && !routeToday

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      // Task 82: AUTO route — Outlet.salesmanId + visitDays se aaj ki shops khud banti hain
      const r = await api<PjpTodayDTO>(`/api/pjp/today?userId=${user.id}`)
      setToday(r)
    } catch { setToday(null) } finally { setLoading(false) }
  }
  useEffect(() => { load()   }, [user])

  /** ROUTE START — aaj ki shops + products device par download (offline working ka data) */
  async function startRoute() {
    if (!user || starting) return
    if (!navigator.onLine) {
      toast({ title: 'Internet nahi hai', description: 'Route start ke liye ek dafa internet chahiye — data download hota hai', variant: 'destructive' })
      return
    }
    setStarting(true)
    try {
      const [rcv, prod] = await Promise.all([
        api<RecoveryData>(`/api/recovery?userId=${user.id}&bookerId=${user.id}`),
        api<{ products: ProductDTO[] }>(`/api/products?userId=${user.id}`),
      ])
      const snap: RouteSnapshot = {
        userId: user.id,
        date: todayStr(),
        startedAt: new Date().toISOString(),
        allRoutesAllowed: rcv.bookers.find((b) => b.id === user.id)?.allRoutesOpen ?? false,
        shops: rcv.shops,
        products: prod.products,
        history: rcv.history.slice(0, 30),
        pending: rcv.pending,
      }
      saveSnapshot(snap)
      toast({ title: `Route Start ✓ — ${snap.shops.length} shops download`, description: `${snap.products.length} products + balances device par — ab offline bhi kaam hoga` })
    } catch (e) {
      toast({ title: 'Route start failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setStarting(false) }
  }

  /** ROUTE END — report pehle banti hai (snapshot + queue ka data chahiye), phir snapshot clear */
  async function endRoute() {
    if (!user || !snapshot || ending) return
    if (!endArm) { setEndArm(true); setTimeout(() => setEndArm(false), 3000); return }
    setEnding(true)
    try {
      // Online ho to pehle pending queue sync — report mein synced actual amounts (schemes ke sath) aayenge
      if (navigator.onLine && getQueue(user.id).length > 0) {
        try { await syncQueue(user.id) } catch { /* best-effort — report phir bhi banegi */ }
      }
      const report = await buildRouteEndReport(user.id, snapshot, getQueue(user.id))
      setEndReport(report)
      clearSnapshot(user.id)
      toast({ title: 'Route End ✓ — Din ka Report tayyar', description: 'Aaj ki total bills, sale aur recovery ka khulasa report mein hai' })
    } finally {
      setEndArm(false)
      setEnding(false)
    }
  }

  async function visitAction(visitId: string, action: 'CHECK_IN' | 'CHECK_OUT', outletName?: string) {
    let lat: number | null = null, lng: number | null = null
    if (action === 'CHECK_IN' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }))
        lat = pos.coords.latitude; lng = pos.coords.longitude
      } catch { /* continue */ }
    }
    const payload = { action, lat, lng }
    // OFFLINE — check-in queue mein (sync par server par lagega)
    if (!navigator.onLine) {
      addToQueue(user!.id, { kind: 'VISIT', label: `${outletName ?? 'Visit'} — ${action === 'CHECK_IN' ? 'Check In' : 'Check Out'}`, url: `/api/visits/${visitId}`, method: 'PATCH', body: JSON.stringify(payload) })
      toast({ title: 'Offline — check-in queue mein save ✓', description: 'Internet aane par khud sync ho jayega' })
      return
    }
    try {
      await api(`/api/visits/${visitId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      toast({ title: action === 'CHECK_IN' ? 'Checked In ✓' : 'Visit Done ✓', description: action === 'CHECK_IN' ? 'GPS captured' : 'Next outlet par jayein' })
      load()
    } catch (e) {
      if (isNetworkError(e)) {
        addToQueue(user!.id, { kind: 'VISIT', label: `${outletName ?? 'Visit'} — ${action === 'CHECK_IN' ? 'Check In' : 'Check Out'}`, url: `/api/visits/${visitId}`, method: 'PATCH', body: JSON.stringify(payload) })
        toast({ title: 'Network fail — queue mein save ✓', description: 'Internet aane par khud sync ho jayega' })
      } else {
        toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
      }
    }
  }

  const visits = today?.visits ?? []
  const done = visits.filter((v) => v.status === 'COMPLETED').length
  const pendingSync = queue.length

  if (loading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>

  return (
    <div className="space-y-3">
      {/* ===== ROUTE START CONTROL ===== */}
      <Card className="border-0 shadow-lg text-white bg-gradient-to-br from-emerald-600 to-teal-700 shadow-emerald-600/20">
        <CardContent className="p-4">
          {!snapshot || stale ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-emerald-100 font-semibold flex items-center gap-1"><Navigation className="h-3.5 w-3.5" /> AAJ KA ROUTE</p>
                  <p className="text-lg font-bold leading-tight mt-0.5">{stale ? 'Purana route expire — dobara start karein' : 'Route start nahi hua'}</p>
                  <p className="text-[11px] text-emerald-100/90 mt-1 leading-relaxed">Start karte hi <b>aaj ki shops + products</b> aap ke device par download ho jayenge — phir <b>internet ke bina bhi</b> order/recovery punch kar sakte hain (queue mein save hoga).</p>
                </div>
                <Play className="h-8 w-8 text-white/70 shrink-0" />
              </div>
              <Button
                onClick={startRoute}
                disabled={starting || !online}
                className="mt-3 w-full h-12 bg-white text-emerald-700 hover:bg-emerald-50 text-base font-bold shadow-md disabled:opacity-70"
              >
                {starting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Play className="h-5 w-5 mr-2" />}
                {starting ? 'Data download ho raha hai...' : !online ? 'Internet chahiye — route start nahi ho sakta' : 'Route Start Karein — Aaj ki Shops Download'}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-emerald-100 font-semibold flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> ROUTE ON — {new Date(snapshot.startedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} download</p>
                  <p className="text-lg font-bold leading-tight mt-0.5">{snapshot.shops.length} shops • {snapshot.products.length} products</p>
                  <p className="text-[11px] text-emerald-100/90 mt-1">Aaj ka data device par hai — offline bhi working hogi</p>
                </div>
                <Navigation className="h-8 w-8 text-white/70 shrink-0" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button onClick={startRoute} disabled={starting || !online} variant="secondary" className="h-10 bg-white/15 text-white hover:bg-white/25 text-xs font-bold border border-white/30">
                  {starting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                  {starting ? 'Refresh...' : !online ? 'Refresh (offline)' : 'Data Refresh'}</Button>
                <Button onClick={endRoute} disabled={ending} className={`h-10 text-xs font-bold border ${endArm ? 'bg-red-600 border-red-500 hover:bg-red-700 text-white' : 'bg-black/20 border-white/30 text-white hover:bg-red-600'}`}>
                  {ending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Square className="h-3.5 w-3.5 mr-1.5" />}{ending ? 'Report...' : endArm ? 'Pakka End?' : 'Route End'}</Button>
              </div>
            </>
          )}
          {/* Pending sync bar */}
          {pendingSync > 0 && (
            <button onClick={onSync} disabled={syncing || !online} className="mt-2.5 w-full rounded-xl bg-amber-400 text-amber-950 px-3 py-2.5 flex items-center justify-between gap-2 disabled:opacity-70">
              <span className="text-left">
                <span className="block text-xs font-bold leading-tight">⏳ {pendingSync} entries offline queue mein</span>
                <span className="block text-[10px] leading-tight mt-0.5">{online ? 'Tap karein — abhi sync ho jayengi' : 'Internet aane par khud sync ho jayengi'}</span>
              </span>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <CloudUpload className="h-4 w-4 shrink-0" />}
            </button>
          )}
        </CardContent>
      </Card>

      {/* ===== JUMMA OFF BANNER — route nahi, sirf unplanned ===== */}
      {today?.fridayOff && (
        <Card className="border-0 shadow-lg text-white bg-gradient-to-br from-rose-600 to-red-700 shadow-rose-600/20">
          <CardContent className="p-4 text-center space-y-2">
            <p className="text-xs text-rose-100 font-bold tracking-wide flex items-center justify-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {today.dayCode} — OFF DAY</p>
            <p className="text-lg font-bold leading-tight">Aaj Jumma chhutti hai</p>
            <p className="text-[11px] text-rose-100/90 leading-relaxed">Aaj koi planned shop nazar nahi aayegi (roz wali shops bhi nahi). Order sirf <b>Unplanned Shop</b> se bana sakte hain — GPS ke sath.</p>
            <Button onClick={onGoShops} className="w-full h-11 bg-white text-rose-700 hover:bg-rose-50 font-bold">
              <Navigation className="h-4 w-4 mr-2" /> Unplanned Shop se Order Karein
            </Button>
          </CardContent>
        </Card>
      )}

      {!today?.fridayOff && (
      <>
      {/* ===== PJP VISITS ===== */}
      <Card className="bg-emerald-600 border-0 text-white shadow-lg shadow-emerald-600/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-emerald-100">Aaj ki Route (Auto PJP — {DAY_LABELS[today?.dayCode ?? ''] ?? ''})</p>
              <p className="text-xl font-bold">{done}/{visits.length} Visits Complete</p>
            </div>
            <Navigation className="h-9 w-9 text-white/70" />
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all" style={{ width: `${visits.length ? (done / visits.length) * 100 : 0}%` }} />
          </div>
        </CardContent>
      </Card>

      {visits.map((v) => (
        <Card key={v.id} className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${v.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : v.status === 'CHECKED_IN' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
                {v.status === 'COMPLETED' ? <CheckCircle2 className="h-5 w-5" /> : v.sequence}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-900 text-sm">{v.outletName}</p>
                  <Badge variant="outline" className="text-[9px] border-slate-200">{v.channel}</Badge>
                </div>
                <p className="text-xs text-slate-400 truncate">{v.area}</p>
                {v.checkInAt && (
                  <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {fmtDate(v.checkInAt, true)}
                    {v.checkInLat ? ` • 📍${v.checkInLat.toFixed(3)}, ${v.checkInLng?.toFixed(3)}` : ''}
                  </p>
                )}
              </div>
              <div className="shrink-0">
                {v.status === 'PENDING' && (
                  <Button size="sm" onClick={() => visitAction(v.id, 'CHECK_IN', v.outletName)} className="bg-emerald-600 hover:bg-emerald-700 text-xs h-8">
                    <LogIn className="h-3.5 w-3.5 mr-1" /> Check In
                  </Button>
                )}
                {v.status === 'CHECKED_IN' && (
                  <Button size="sm" onClick={() => visitAction(v.id, 'CHECK_OUT', v.outletName)} className="bg-teal-600 hover:bg-teal-700 text-xs h-8">
                    <LogOut className="h-3.5 w-3.5 mr-1" /> Check Out
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {today && visits.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-slate-400">Aaj ki route mein koi shop nahi — Shops page par shop ko booker + din assign karein, wo agle din khud route mein aayegi</CardContent></Card>}
      {!today && <Card><CardContent className="py-10 text-center text-sm text-slate-400">Route load nahi hua {online ? '' : '(offline)'} — dobara koshish karein</CardContent></Card>}
      </>
      )}

      {/* ROUTE END REPORT — din ka khulasa popup */}
      {endReport && <RouteEndReportDialog report={endReport} onClose={() => setEndReport(null)} />}
    </div>
  )
}

/* ================= ROUTE END REPORT (bills / sale / recovery ka khulasa) ================= */
interface RouteEndReport {
  startedAt: string
  endedAt: string
  shops: number
  /** aaj ke total bills (server synced + offline queue) */
  bills: number
  billsSynced: number
  billsQueued: number
  /** aaj ki total sale — synced actual + queue approx (schemes sync par apply hongi) */
  saleSynced: number
  saleQueued: number
  /** aaj ki total recovery — server (approved + pending) + offline queue */
  recSynced: number
  recApproved: number
  recQueued: number
  /** offline tha / fetch fail — synced data missing hai (sirf snapshot + queue shamil) */
  partial: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function buildRouteEndReport(userId: string, snapshot: RouteSnapshot, queue: PendingSync[]): Promise<RouteEndReport> {
  const isToday = (iso: string) => isSameKarachiDay(iso)
  const qOrders = queue.filter((q) => q.kind === 'ORDER')
  const qRecs = queue.filter((q) => q.kind === 'RECOVERY')

  // Synced aaj ka data — online ho to server se fresh, warna snapshot fallback
  let orders: OrderDTO[] = []
  let recRows: RecoveryRowDTO[] = snapshot.history
  let partial = typeof navigator === 'undefined' || !navigator.onLine
  if (!partial) {
    try {
      const [o, rcv] = await Promise.all([
        api<{ orders: OrderDTO[] }>(`/api/orders?userId=${userId}`),
        api<RecoveryData>(`/api/recovery?userId=${userId}&bookerId=${userId}`),
      ])
      orders = o.orders
      recRows = rcv.history.filter((r) => r.bookerId === userId)
    } catch { partial = true }
  }

  const todayOrders = orders.filter((o) => isToday(o.orderDate) && o.status !== 'CANCELLED')
  const todayRecs = recRows.filter((r) => isToday(r.date) && r.status !== 'REJECTED')

  // Offline queued order ka approx value — snapshot products se (sync par schemes/discount server apply karega)
  const estOrderValue = (body: string) => {
    try {
      const b = JSON.parse(body) as { items?: { productId: string; ctn: number; box: number; pcs: number }[]; discount?: { type?: string; value?: number } }
      let v = 0
      for (const it of b.items ?? []) {
        const p = snapshot.products.find((x) => x.id === it.productId)
        if (!p) continue
        const totalPcs = (it.ctn || 0) * Math.max(1, p.unitsPerCarton) + (it.box || 0) * (p.pcsPerBox > 0 ? p.pcsPerBox : 0) + (it.pcs || 0)
        v += totalPcs * (p.tradePrice / Math.max(1, p.unitsPerCarton))
      }
      v = round2(v)
      const d = b.discount
      if (d?.type === 'PERCENT' && d.value) v = round2(v * (1 - Math.min(100, d.value) / 100))
      else if (d?.type === 'FLAT' && d.value) v = Math.max(0, round2(v - d.value))
      return v
    } catch { return 0 }
  }
  const estRecValue = (body: string) => {
    try {
      const b = JSON.parse(body) as { entries?: { amount?: number }[] }
      return round2((b.entries ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0))
    } catch { return 0 }
  }

  return {
    startedAt: snapshot.startedAt,
    endedAt: new Date().toISOString(),
    shops: snapshot.shops.length,
    bills: todayOrders.length + qOrders.length,
    billsSynced: todayOrders.length,
    billsQueued: qOrders.length,
    saleSynced: round2(todayOrders.reduce((s, o) => s + o.total, 0)),
    saleQueued: round2(qOrders.reduce((s, q) => s + estOrderValue(q.body), 0)),
    recSynced: round2(todayRecs.reduce((s, r) => s + r.amount, 0)),
    recApproved: round2(todayRecs.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.amount, 0)),
    recQueued: round2(qRecs.reduce((s, q) => s + estRecValue(q.body), 0)),
    partial,
  }
}

function RouteEndReportDialog({ report, onClose }: { report: RouteEndReport; onClose: () => void }) {
  const totalSale = round2(report.saleSynced + report.saleQueued)
  const totalRec = round2(report.recSynced + report.recQueued)
  const started = new Date(report.startedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
  const ended = new Date(report.endedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-base"><ReceiptText className="h-4 w-4 text-emerald-600" /> Route End — Din ka Report</DialogTitle>
          <DialogDescription>{report.shops} shops • Route {started} — {ended}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2.5 max-h-[58vh] overflow-y-auto -mx-1 px-1">
          {/* TOTAL SALE — hero card */}
          <div className="rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-4 text-center shadow-sm shadow-emerald-600/20">
            <p className="text-[10px] font-bold tracking-wide text-emerald-100">AAJ KI TOTAL SALE</p>
            <p className="text-3xl font-bold leading-tight mt-0.5">{fmtPKR(totalSale)}</p>
            <p className="text-[10px] text-emerald-100 mt-1">{report.bills} bill{report.bills === 1 ? '' : 's'} banaye — {report.billsSynced} server par{report.billsQueued > 0 ? ` + ${report.billsQueued} offline queue mein (approx)` : ''}</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-center">
              <p className="text-[10px] font-bold tracking-wide text-violet-500 flex items-center justify-center gap-1"><ShoppingCart className="h-3 w-3" /> TOTAL BILLS</p>
              <p className="text-2xl font-bold text-violet-700 leading-tight mt-0.5">{report.bills}</p>
              <p className="text-[10px] text-violet-400">{report.billsQueued > 0 ? `${report.billsQueued} offline queue mein` : 'sab server par'}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
              <p className="text-[10px] font-bold tracking-wide text-emerald-600 flex items-center justify-center gap-1"><HandCoins className="h-3 w-3" /> TOTAL RECOVERY</p>
              <p className="text-2xl font-bold text-emerald-700 leading-tight mt-0.5">{fmtPKR(totalRec)}</p>
              <p className="text-[10px] text-emerald-500">{report.recQueued > 0 ? `${fmtPKR(report.recQueued)} offline queue mein` : 'sync ho chuki'}</p>
            </div>
          </div>
          {/* KHULASA — breakdown */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-[11px] text-slate-600">
            <p className="text-[10px] font-bold text-slate-500 tracking-wide">KHULASA</p>
            <div className="flex justify-between gap-2"><span>Server par synced bills ki sale</span><b className="text-slate-800">{fmtPKR(report.saleSynced)}</b></div>
            {report.billsQueued > 0 && <div className="flex justify-between gap-2"><span>Offline bills (approx — schemes sync par)</span><b className="text-slate-800">{fmtPKR(report.saleQueued)}</b></div>}
            <div className="flex justify-between gap-2"><span>Recovery — admin approved</span><b className="text-slate-800">{fmtPKR(report.recApproved)}</b></div>
            <div className="flex justify-between gap-2"><span>Recovery — approval pending</span><b className="text-slate-800">{fmtPKR(Math.max(0, round2(report.recSynced - report.recApproved)))}</b></div>
            {report.recQueued > 0 && <div className="flex justify-between gap-2"><span>Recovery — offline queue</span><b className="text-slate-800">{fmtPKR(report.recQueued)}</b></div>}
          </div>
          {report.partial && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800 leading-relaxed">
              Internet mojood nahi tha — aaj ki synced entries server se check nahi ho saki. Report mein sirf route start ka data + offline queue shamil hai. Entries sync hone ke baad admin portal par poori nazar aayengi.
            </p>
          )}
          <p className="text-[11px] text-slate-400 leading-relaxed text-center">Route end ho gaya — kal field se pehle <b>My Day</b> se naya route start karein. Offline queue ki entries internet aane par khud sync ho jayengi.</p>
        </div>
        <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={onClose}><CheckCircle2 className="h-4 w-4 mr-2" /> Theek Hai — Din Khatam</Button>
      </DialogContent>
    </Dialog>
  )
}

/* ================= SHOPS (day-wise route + recovery) ================= */
// Task 82: din hamesha Karachi se (browser foreign timezone par bhi sahi route)
const TODAY_CODE = () => karachiDayCode()

function ShopsTab({ online, onGoDay }: { online: boolean; onGoDay: () => void }) {
  const user = useDMS((s) => s.user)
  const { snapshot, today, queue } = useRouteState(user?.id)
  const [day, setDay] = useState(TODAY_CODE)
  const [allRoutes, setAllRoutes] = useState(false)
  const [collectShop, setCollectShop] = useState<RecoveryShopDTO | null>(null)
  const [actionShop, setActionShop] = useState<RecoveryShopDTO | null>(null)
  const [orderShop, setOrderShop] = useState<RecoveryShopDTO | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)
  // Task 82: PJP flags — Jumma OFF + Unplanned allowed (admin settings se)
  const [flags, setFlags] = useState<PjpTodayDTO | null>(null)
  const [unplannedOpen, setUnplannedOpen] = useState(false)
  const [orderUnplanned, setOrderUnplanned] = useState(false)

  useEffect(() => {
    if (!user) return
    api<PjpTodayDTO>(`/api/pjp/today?userId=${user.id}`).then(setFlags).catch(() => setFlags(null))
  }, [user])

  // ===== ROUTE START GATE =====
  // Route start ke bina shops ka data bilkul nahi dikhta — booker all-time working nahi dekhta,
  // sirf apna started route (aaj ki downloaded shops) dekhta hai, online + offline dono par
  if (!user) return null
  if (!snapshot || !today) {
    return (
      <Card className="border-0 shadow-lg text-white bg-gradient-to-br from-emerald-600 to-teal-700 shadow-emerald-600/20">
        <CardContent className="p-6 text-center space-y-3">
          <div className="h-14 w-14 rounded-full bg-white/15 mx-auto flex items-center justify-center"><Navigation className="h-7 w-7" /></div>
          <p className="text-lg font-bold">Route start nahi hua</p>
          <p className="text-xs text-emerald-100 leading-relaxed">Aaj ki shops tab nazar aayengi jab aap <b>My Day</b> se route start karenge — start hote hi shops + balances + products aap ke device par download ho jayenge, phir internet ke bina bhi working hogi.</p>
          <Button onClick={onGoDay} className="w-full h-11 bg-white text-emerald-700 hover:bg-emerald-50 font-bold">
            <Navigation className="h-4 w-4 mr-2" /> My Day par jayein — Route Start Karein
          </Button>
        </CardContent>
      </Card>
    )
  }

  const shops = snapshot.shops
  const dayMatches = (s: RecoveryShopDTO, code: string) => !s.visitDays || s.visitDays.split(',').filter(Boolean).includes(code)
  // ADMIN-CONTROLLED: All Routes toggle snapshot mein saved (route start ke waqt ka admin permission)
  const allRoutesAllowed = snapshot.allRoutesAllowed
  const visibleShops = allRoutes ? shops : shops.filter((s) => dayMatches(s, day))
  const perDayCount = (code: string) => shops.filter((s) => dayMatches(s, code)).length
  const todayCode = TODAY_CODE()
  const todayShops = shops.filter((s) => dayMatches(s, todayCode))
  const todayUdhaar = todayShops.reduce((s, x) => s + (x.balance > 0 ? x.balance : 0), 0)
  const routeUdhaar = shops.reduce((s, x) => s + (x.balance > 0 ? x.balance : 0), 0)
  // ALL-TIME working hidden — sirf AAJ ki recoveries (route start ke waqt ka snapshot + offline queue)
  const myRecoveries = snapshot.history.filter((r) => isSameKarachiDay(r.date))
  const pendingMine = snapshot.pending
  // Shop-wise pending approval count — card par amber badge (booker ko pata ho kis shop ki entry admin ke paas hai)
  const pendingByCode = new Map<string, number>()
  for (const r of snapshot.pending) pendingByCode.set(r.outletCode, (pendingByCode.get(r.outletCode) ?? 0) + 1)

  return (
    <div className="space-y-3 pb-2">
      {/* ===== JUMMA OFF BANNER — koi route nahi, sirf unplanned ===== */}
      {flags?.fridayOff && (
        <Card className="border-0 shadow-lg text-white bg-gradient-to-br from-rose-600 to-red-700 shadow-rose-600/20">
          <CardContent className="p-4 text-center space-y-2">
            <p className="text-xs text-rose-100 font-bold tracking-wide flex items-center justify-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {flags.dayCode} — OFF DAY</p>
            <p className="text-lg font-bold leading-tight">Aaj Jumma chhutti hai — route band hai</p>
            <p className="text-[11px] text-rose-100/90 leading-relaxed">Aaj koi planned shop nazar nahi aayegi (roz wali bhi nahi). Neeche <b>Unplanned Shop</b> se out-of-route shop ka order bana sakte hain — GPS ke sath.</p>
          </CardContent>
        </Card>
      )}

      {/* Task 82: UNPLANNED SHOP — route se bahar shop ka order (KPO manual bill ka jhanjhat khatam) */}
      {flags?.unplannedEnabled && (
        <button type="button" onClick={() => setUnplannedOpen(true)} className="w-full flex items-center gap-3 rounded-xl border-2 border-dashed border-violet-400 bg-violet-50 p-3.5 text-left hover:bg-violet-100 transition-colors">
          <span className="h-10 w-10 rounded-full bg-violet-600 text-white flex items-center justify-center shrink-0"><Plus className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-violet-800 leading-tight">Unplanned Shop — Order Karein</span>
            <span className="block text-[11px] text-violet-500 leading-snug mt-0.5">Aaj ki route ki bahar shop ka bill yahan se banayein {flags?.fridayOff ? '(aaj sirf yehi option hai)' : ''} — GPS lazmi</span>
          </span>
        </button>
      )}
      {flags && !flags.unplannedEnabled && !flags.fridayOff && (
        <p className="text-[10px] text-slate-400 text-center">Unplanned orders admin ne band kar diye hain — sirf route shops par order hoga</p>
      )}

      {!flags?.fridayOff && (<>
      {/* Aaj ka route summary + All Routes switch */}
      <Card className="bg-emerald-600 border-0 text-white shadow-lg shadow-emerald-600/20">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-emerald-100 flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Aaj ({DAY_LABELS[todayCode]}) ki Route Shops</p>
              <p className="text-xl font-bold leading-tight mt-0.5">{todayShops.length} Shops</p>
              <p className="text-[11px] text-emerald-100 mt-0.5">Pending udhaar: {fmtPKR(todayUdhaar)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-emerald-100">Poora Route</p>
              <p className="text-sm font-bold">{shops.length} shops • {fmtPKR(routeUdhaar)}</p>
            </div>
          </div>
          {allRoutesAllowed ? (
            <button
              onClick={() => setAllRoutes((v) => !v)}
              className={`mt-3 w-full flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors ${allRoutes ? 'bg-white text-emerald-700' : 'bg-white/15 text-white'}`}
            >
              <span className="flex items-center gap-2 text-left">
                <Eye className="h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-xs font-bold leading-tight">All Routes Open {allRoutes ? '(ON)' : '(OFF)'}</span>
                  <span className="block text-[10px] opacity-80 leading-tight">End of month max recovery — sab shops dikhao</span>
                </span>
              </span>
              <span className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ${allRoutes ? 'bg-emerald-500' : 'bg-white/30'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${allRoutes ? 'left-[22px]' : 'left-0.5'}`} />
              </span>
            </button>
          ) : (
            <div className="mt-3 w-full flex items-center justify-between rounded-xl px-3 py-2.5 bg-black/10 text-white/90" aria-label="All Routes admin lock">
              <span className="flex items-center gap-2 text-left">
                <Lock className="h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-xs font-bold leading-tight">All Routes (Admin Lock)</span>
                  <span className="block text-[10px] opacity-80 leading-tight">Admin ne access band rakhi hai — All Routes ke liye admin se request karein</span>
                </span>
              </span>
              <span className="relative h-6 w-11 rounded-full bg-white/20 shrink-0">
                <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white/50 shadow" />
              </span>
            </div>
          )}
        </CardContent>
      </Card>
      </>)}

      {/* Offline queue — order/recovery/visit jo sync ka intezar kar rahe hain */}
      {queue.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
          <p className="text-xs font-bold text-amber-800 flex items-center gap-1"><CloudUpload className="h-3.5 w-3.5" /> OFFLINE ENTRIES ({queue.length}) — SYNC KA INTEZAR</p>
          {queue.map((q: PendingSync) => (
            <div key={q.id} className="bg-white rounded-lg border border-amber-200 px-2.5 py-2 flex items-center gap-2">
              <Badge variant="outline" className="text-[8px] border-amber-300 text-amber-700 bg-amber-50 shrink-0">{q.kind}</Badge>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-700 truncate">{q.label}</p>
                {q.lastError && <p className="text-[10px] text-red-500 truncate">Sync fail: {q.lastError}</p>}
              </div>
              <span className="text-[10px] text-slate-400 whitespace-nowrap">{new Date(q.createdAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
          <p className="text-[10px] text-amber-700 leading-relaxed">{online ? 'Internet mojood hai — My Day par Sync Now dabayein' : 'Internet aane par ye entries khud server par sync ho jayengi'}</p>
        </div>
      )}

      {!flags?.fridayOff && (<>
      {/* Day chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
        {DAY_LIST.map((d) => (
          <button key={d.code} onClick={() => { setDay(d.code); setAllRoutes(false) }}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold border transition-colors ${!allRoutes && day === d.code ? 'bg-violet-600 text-white border-violet-600 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-violet-300'} ${d.code === todayCode ? 'ring-1 ring-emerald-400' : ''}`}>
            {d.label}
            <span className={`ml-1 ${!allRoutes && day === d.code ? 'text-emerald-100' : 'text-slate-400'}`}>{perDayCount(d.code)}</span>
            {d.code === todayCode && <span className="ml-0.5 text-[8px]">•</span>}
          </button>
        ))}
      </div>
      </>)}

      {!flags?.fridayOff && (<>
      {/* Shops list */}
      <p className="text-xs font-semibold text-slate-500">
        {allRoutes ? `SAB ROUTE SHOPS (${visibleShops.length})` : `${DAY_LABELS[day]?.toUpperCase() ?? day} KI SHOPS (${visibleShops.length})`}
      </p>
      {visibleShops.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-slate-400">{allRoutesAllowed ? 'Is din koi shop nahi — All Routes ON karke sab dekhein' : 'Is din koi shop nahi — All Routes ke liye admin se access lein'}</CardContent></Card>
      ) : visibleShops.map((s) => (
        <Card key={s.outletId} onClick={() => setActionShop(s)}
          className="border-slate-200 shadow-sm cursor-pointer hover:border-emerald-300 hover:shadow-md active:scale-[0.99] transition-all">
          <CardContent className="p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 text-sm truncate">{s.name}</p>
                <p className="text-[11px] text-slate-400">{s.code} • {s.channel} • {s.city}</p>
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  <VisitDayChips visitDays={s.visitDays} compact />
                  {(pendingByCode.get(s.code) ?? 0) > 0 && (
                    <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[9px] px-1.5 py-0">{pendingByCode.get(s.code)} approval pending</Badge>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold whitespace-nowrap ${s.balance > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPKR(Math.max(0, s.balance))}</p>
                <p className="text-[10px] text-slate-400">previous balance</p>
              </div>
            </div>
            {/* Action chips — tap se popup khulta hai (Recovery / Order) */}
            <div className="mt-2.5 flex items-center gap-1.5">
              <span className={`flex-1 h-8 rounded-md flex items-center justify-center gap-1 text-[11px] font-bold ${s.balance > 0.005 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-400'}`}>
                <HandCoins className="h-3.5 w-3.5" /> Recovery
              </span>
              <span className="flex-1 h-8 rounded-md flex items-center justify-center gap-1 text-[11px] font-bold bg-violet-50 text-violet-700">
                <ShoppingCart className="h-3.5 w-3.5" /> Order
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
      </>)}

      {/* Aaj ki recoveries — status ke sath (all-time history hidden) */}
      <div className="pt-1">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-slate-500 flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> AAJ KI RECOVERIES ({myRecoveries.length})</p>
          {pendingMine.length > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[10px]">{pendingMine.length} approval pending</Badge>
          )}
        </div>
        {(showAllHistory ? myRecoveries : myRecoveries.slice(0, 5)).map((r) => (
          <Card key={r.id} className="border-slate-200 shadow-sm mb-2">
            <CardContent className="p-3 flex items-center gap-2.5">
              <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${r.status === 'APPROVED' ? 'bg-emerald-100' : r.status === 'PENDING' ? 'bg-amber-100' : 'bg-red-100'}`}>
                <Banknote className={`h-4.5 w-4.5 ${r.status === 'APPROVED' ? 'text-emerald-600' : r.status === 'PENDING' ? 'text-amber-600' : 'text-red-500'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-700">{r.recoveryNo}</p>
                <p className="text-[11px] text-slate-500 truncate">{r.outletName} • {r.method !== 'CASH' ? `${r.method}${r.reference ? ` #${r.reference}` : ''}` : 'Cash'} • {fmtDate(r.date)}</p>
                {r.status === 'REJECTED' && r.reviewNote && <p className="text-[10px] text-red-500 truncate">Wajah: {r.reviewNote}</p>}
                {r.status === 'PENDING' && <p className="text-[10px] text-amber-600">Admin approval ka intezar — ledger abhi update nahi hui</p>}
                {r.status === 'APPROVED' && r.editedAmount && r.originalAmount != null && <p className="text-[10px] text-slate-400">Booker ne {fmtPKR(r.originalAmount)} likhi thi — admin ne {fmtPKR(r.amount)} approve ki</p>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold whitespace-nowrap">{fmtPKR(r.amount)}</p>
                <Badge variant="outline" className={`${STATUS_STYLES[r.status] ?? ''} text-[8px] px-1 py-0`}>{r.status === 'PENDING' ? 'Approval Pending' : r.status}</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
        {myRecoveries.length > 5 && (
          <Button variant="ghost" size="sm" className="w-full text-xs text-slate-500" onClick={() => setShowAllHistory((v) => !v)}>
            {showAllHistory ? 'Kam dikhao' : `Aur ${myRecoveries.length - 5} dekho`}
          </Button>
        )}
        {myRecoveries.length === 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-slate-400">Aaj ki koi recovery nahi — shop card pr tap kar ke collect karein</CardContent></Card>
        )}
      </div>

      {collectShop && user && (
        <RecoveryCollectDialog
          shop={collectShop}
          userId={user.id}
          bookerId={user.id}
          bookerName={user.name}
          onClose={() => setCollectShop(null)}
          onPosted={() => { setCollectShop(null) }}
        />
      )}

      {/* Shop tap popup — 2 options: Recovery / Order */}
      {actionShop && (
        <ShopActionDialog
          shop={actionShop}
          onRecovery={() => { setCollectShop(actionShop); setActionShop(null) }}
          onOrder={() => { setOrderShop(actionShop); setActionShop(null) }}
          onClose={() => setActionShop(null)}
        />
      )}

      {/* Shop-wise order punch (popup ke Order option se, ya Unplanned picker se) */}
      {orderShop && user && (
        <OrderBookSheet
          shop={orderShop}
          userId={user.id}
          products={snapshot.products}
          unplanned={orderUnplanned}
          onClose={() => { setOrderShop(null); setOrderUnplanned(false) }}
          onPlaced={() => { setOrderShop(null); setOrderUnplanned(false) }}
          onRecoveryRequest={() => { const s = orderShop; setOrderShop(null); setOrderUnplanned(false); if (s) setCollectShop(s) }}
        />
      )}

      {/* Task 82: Unplanned Shop picker — route se bahar shops (aaj ki route se exclude) */}
      {unplannedOpen && snapshot && (
        <UnplannedShopDialog
          shops={snapshot.shops}
          todayCode={todayCode}
          onClose={() => setUnplannedOpen(false)}
          onPick={(s) => { setUnplannedOpen(false); setOrderUnplanned(true); setOrderShop(s) }}
        />
      )}
    </div>
  )
}

/* ================= UNPLANNED SHOP PICKER (Task 82 — out-of-route order) ================= */
function UnplannedShopDialog({ shops, todayCode, onClose, onPick }: {
  shops: RecoveryShopDTO[]
  todayCode: string
  onClose: () => void
  onPick: (s: RecoveryShopDTO) => void
}) {
  const [search, setSearch] = useState('')
  // Out-of-route = aaj ke din pe assign nahi (din wali + roz wali dono exclude)
  const outOfRoute = shops.filter((s) => {
    const days = (s.visitDays || '').split(',').map((x) => x.trim()).filter(Boolean)
    return days.length > 0 && !days.includes(todayCode)
  })
  const filtered = outOfRoute.filter((s) => `${s.name} ${s.code} ${s.channel} ${s.city}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-base"><Navigation className="h-4 w-4 text-violet-600" /> Unplanned Shop</DialogTitle>
          <DialogDescription>Route ki bahar shop select karein — shop open hote hi location auto capture hogi (lazmi)</DialogDescription>
        </DialogHeader>
        <Input placeholder="Shop ka naam likh kar search karein..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 -mx-1 px-1">
          {filtered.map((s) => (
            <button key={s.outletId} type="button" onClick={() => onPick(s)}
              className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-violet-400 hover:shadow-sm transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                  <p className="text-[11px] text-slate-400">{s.code} • {s.channel} • {s.city}</p>
                </div>
                <p className={`text-xs font-bold whitespace-nowrap ${s.balance > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPKR(Math.max(0, s.balance))}</p>
              </div>
              <div className="mt-1.5"><VisitDayChips visitDays={s.visitDays} compact /></div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-xs text-slate-400">Koi out-of-route shop nahi mili{search ? ' — dusra naam try karein' : ''}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Booker recovery entry — PENDING jati hai, admin approve karega tab ledger update hoga */
function RecoveryCollectDialog({ shop, userId, bookerId, bookerName, onClose, onPosted }: {
  shop: RecoveryShopDTO
  userId: string
  bookerId: string
  bookerName: string
  onClose: () => void
  onPosted: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [posting, setPosting] = useState(false)

  const amt = parseFloat(amount) || 0
  const over = amt > Math.round(shop.balance * 100) / 100 + 0.005
  const needRef = method !== 'CASH' && !reference.trim()
  const valid = amt > 0 && !over && !needRef

  async function submit() {
    if (!valid || posting) return
    setPosting(true)
    const body = JSON.stringify({
      userId, bookerId,
      entries: [{ outletId: shop.outletId, amount: amt, method, reference: reference.trim() || undefined, note: note.trim() || undefined }],
    })
    // OFFLINE — entry queue mein (internet aane par khud sync, admin approval flow wahi)
    if (!navigator.onLine) {
      addToQueue(userId, { kind: 'RECOVERY', label: `${shop.name} — ${fmtPKR(amt)}`, url: '/api/recovery', method: 'POST', body })
      setPosting(false)
      toast({ title: `Offline — Recovery ${fmtPKR(amt)} queue mein save ✓`, description: 'Internet aane par khud sync hogi — phir admin approval ke paas jayegi' })
      onPosted()
      return
    }
    try {
      await api('/api/recovery', { method: 'POST', body })
      toast({
        title: `Recovery ${fmtPKR(amt)} — approval ke liye bhej di gayi ✓`,
        description: 'Admin approve karega tab shop ledger update hoga — pending list mein nazar aayegi',
      })
      onPosted()
    } catch (e) {
      if (isNetworkError(e)) {
        addToQueue(userId, { kind: 'RECOVERY', label: `${shop.name} — ${fmtPKR(amt)}`, url: '/api/recovery', method: 'POST', body })
        toast({ title: `Network fail — Recovery ${fmtPKR(amt)} queue mein save ✓`, description: 'Internet aane par khud sync hogi' })
        onPosted()
      } else {
        toast({ title: 'Recovery submit failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
      }
    } finally {
      setPosting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-base"><HandCoins className="h-4 w-4 text-emerald-600" /> Recovery — {shop.name}</DialogTitle>
          <DialogDescription>Booker: {bookerName} • Pending udhaar: <b className="text-red-600">{fmtPKR(shop.balance)}</b></DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold text-slate-500">WASOOLI AMOUNT (Rs)</label>
            <div className="flex gap-1.5">
              <Input type="number" min={0} step={0.01} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={`text-right font-bold ${over ? 'border-red-400 ring-1 ring-red-200' : ''}`} />
              <Button variant="outline" className="h-9 shrink-0 text-xs" onClick={() => setAmount(shop.balance.toFixed(2))}>Full</Button>
            </div>
            {over && <p className="text-[10px] text-red-500">Udhaar sirf {fmtPKR(shop.balance)} hai — is se zyada nahi</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(RECOVERY_METHODS).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setMethod(v)}
                className={`h-9 rounded-md text-xs font-bold border transition-colors ${method === v ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-white text-slate-500 border-slate-200'}`}>
                {l}
              </button>
            ))}
          </div>
          {method !== 'CASH' && (
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-slate-500">{method === 'CHEQUE' ? 'CHEQUE #' : 'SLIP / REF #'} *</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={needRef ? 'Zaroori hai' : 'e.g. 452198'} className={needRef ? 'border-red-400 ring-1 ring-red-200' : ''} />
            </div>
          )}
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold text-slate-500">NOTE (optional)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dukan dar ne kaha next month..." />
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800 leading-relaxed">
            Entry <b>PENDING</b> status mein admin portal jayegi — admin approve karega tab hi shop ledger update hoga.
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={posting}>Cancel</Button>
          <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={!valid || posting}>
            {posting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <HandCoins className="h-4 w-4 mr-1.5" />}
            Submit{valid ? ` (${fmtPKR(amt)})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type DiscType = 'NONE' | 'PERCENT' | 'FLAT'

/** Task 82: GPS capture — lazmi (fail => null => order create nahi hoga). Task 83: accuracy bhi return hoti hai. */
async function captureGps(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null
  try {
    const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 60000 }))
    const lat = pos.coords.latitude
    const lng = pos.coords.longitude
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    const acc = pos.coords.accuracy
    return { lat, lng, accuracy: Number.isFinite(acc) ? acc : undefined }
  } catch {
    return null
  }
}

/* ================= SHOP ACTION POPUP (Recovery / Order — 2 options) ================= */
function ShopActionDialog({ shop, onRecovery, onOrder, onClose }: {
  shop: RecoveryShopDTO
  onRecovery: () => void
  onOrder: () => void
  onClose: () => void
}) {
  const hasUdhaar = shop.balance > 0.005
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-base"><Store className="h-4 w-4 text-violet-600" /> {shop.name}</DialogTitle>
          <DialogDescription>{shop.code} • {shop.channel} • {shop.city}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className={`rounded-xl border p-3.5 text-center ${hasUdhaar ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className="text-[10px] font-bold tracking-wide text-slate-500">PREVIOUS BALANCE (UDHAAR)</p>
            <p className={`text-2xl font-bold leading-tight ${hasUdhaar ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPKR(Math.max(0, shop.balance))}</p>
            <div className="mt-1.5 flex items-center justify-center gap-1 flex-wrap">
              <VisitDayChips visitDays={shop.visitDays} compact />
            </div>
          </div>
          {hasUdhaar && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800 leading-relaxed">
              Is shop ka purana udhaar baqi hai — <b>pehle recovery collect karein</b>, us ke baad order punch karein.
            </div>
          )}
          <button type="button" onClick={onRecovery} disabled={!hasUdhaar}
            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${hasUdhaar ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20' : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'}`}>
            <span className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${hasUdhaar ? 'bg-white/20' : 'bg-slate-200'}`}>
              <HandCoins className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold leading-tight">Recovery Collect Karein</span>
              <span className={`block text-[11px] leading-snug mt-0.5 ${hasUdhaar ? 'text-emerald-100' : ''}`}>{hasUdhaar ? `Pending udhaar ${fmtPKR(shop.balance)} — admin approve karega tab ledger update` : 'Is shop ka koi udhaar nahi — recovery ki zaroorat nahi'}</span>
            </span>
          </button>
          <button type="button" onClick={onOrder}
            className="flex items-center gap-3 rounded-xl border border-violet-600 bg-violet-600 p-3.5 text-left text-white hover:bg-violet-700 transition-colors shadow-sm shadow-violet-600/20">
            <span className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <ShoppingCart className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold leading-tight">Order Punch Karein</span>
              <span className="block text-[11px] leading-snug mt-0.5 text-violet-100">Is shop ka naya order book karein — schemes auto-apply hongi</span>
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ================= ORDER PUNCH (shop-wise — shop popup se / unplanned picker se) ================= */
function OrderBookSheet({ shop, userId, products: snapshotProducts, unplanned, onClose, onPlaced, onRecoveryRequest }: {
  shop: RecoveryShopDTO
  userId: string
  /** Route snapshot ke products (offline working) — na mile to fallback fetch */
  products?: ProductDTO[]
  /** Task 82: out-of-route order — Unplanned Shop picker se bana */
  unplanned?: boolean
  onClose: () => void
  onPlaced: () => void
  onRecoveryRequest: () => void
}) {
  const [products, setProducts] = useState<ProductDTO[]>(snapshotProducts ?? [])
  const [cart, setCart] = useState<{ productId: string; qtyPcs: number }[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [search, setSearch] = useState('')
  const [discType, setDiscType] = useState<DiscType>('NONE')
  const [discValue, setDiscValue] = useState('')
  // Task 83: GPS shop OPEN hote hi AUTO capture hota hai (place ke waqt naya capture nahi — wahi coords evidence)
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null)
  const [gpsStatus, setGpsStatus] = useState<'capturing' | 'captured' | 'failed'>('capturing')

  const fetchGps = useCallback(() => {
    setGpsStatus('capturing')
    captureGps().then((g) => {
      if (g) { setGps(g); setGpsStatus('captured') } else setGpsStatus('failed')
    })
  }, [])
  // Shop open hote hi foran capture shuru — booker products pick karte karte location mil jati hai
  useEffect(() => { fetchGps() }, [fetchGps])

  useEffect(() => {
    if (snapshotProducts && snapshotProducts.length > 0) { setProducts(snapshotProducts); return }
    api<{ products: ProductDTO[] }>(`/api/products?userId=${userId}`).then((r) => setProducts(r.products)).catch(() => {})
  }, [userId, snapshotProducts])

  const filteredProducts = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
  const cartPcs = cart.reduce((s, c) => s + c.qtyPcs, 0)
  const cartValue = cart.reduce((s, c) => {
    const p = products.find((x) => x.id === c.productId)
    if (!p) return s
    return s + c.qtyPcs * (p.tradePrice / Math.max(1, p.unitsPerCarton))
  }, 0)
  const hasUdhaar = shop.balance > 0.005

  // Manual discount preview (server scheme discount ke baad cap karta hai)
  const discNum = parseFloat(discValue)
  const discInputValid = Number.isFinite(discNum) && discNum > 0 && (discType === 'FLAT' || discNum <= 100)
  const manualDiscount = (() => {
    if (discType === 'NONE' || !discInputValid) return 0
    const raw = discType === 'PERCENT'
      ? Math.round(Math.round(cartValue * 100) / 100 * (discNum / 100) * 100) / 100
      : Math.round(discNum * 100) / 100
    return Math.round(Math.min(raw, Math.max(0, Math.round(cartValue * 100) / 100)) * 100) / 100
  })()

  function deleteDiscount() {
    setDiscType('NONE')
    setDiscValue('')
  }

  function addToCart(pid: string) {
    const p = products.find((x) => x.id === pid)
    if (!p) return
    const step = Math.max(1, p.unitsPerCarton) // +1 ctn
    const ex = cart.find((c) => c.productId === pid)
    const nextPcs = (ex?.qtyPcs ?? 0) + step
    // Task 26: STOCK LIMIT — available se aage cart nahi jata (clamp + toast)
    if (nextPcs > p.available) {
      if (p.available <= 0) {
        toast({ title: 'Out of stock', description: `${p.name} — warehouse mein available stock nahi hai`, variant: 'destructive' })
        return
      }
      setCart(ex ? cart.map((c) => (c.productId === pid ? { ...c, qtyPcs: p.available } : c)) : [...cart, { productId: pid, qtyPcs: p.available }])
      toast({ title: 'Stock limit', description: `${p.name} — sirf ${fmtQty(p.available, Math.max(1, p.unitsPerCarton), p.pcsPerBox > 0 ? p.pcsPerBox : 0)} available hai`, variant: 'destructive' })
      return
    }
    if (ex) setCart(cart.map((c) => (c.productId === pid ? { ...c, qtyPcs: nextPcs } : c)))
    else setCart([...cart, { productId: pid, qtyPcs: step }])
  }
  function changeQty(pid: string, dCtn: number) {
    const p = products.find((x) => x.id === pid)
    const step = Math.max(1, p?.unitsPerCarton ?? 1)
    const ex = cart.find((c) => c.productId === pid)
    if (!ex) return
    let np = ex.qtyPcs + dCtn * step
    if (dCtn > 0 && p && np > p.available) {
      np = p.available
      toast({ title: 'Stock limit', description: `${p.name} — sirf ${fmtQty(p.available, Math.max(1, p.unitsPerCarton), p.pcsPerBox > 0 ? p.pcsPerBox : 0)} available hai`, variant: 'destructive' })
    }
    setCart(np <= 0 ? cart.filter((x) => x.productId !== pid) : cart.map((x) => (x.productId === pid ? { ...x, qtyPcs: np } : x)))
  }
  function setItemPcs(pid: string, totalPcs: number) {
    setCart(totalPcs <= 0 ? cart.filter((x) => x.productId !== pid) : cart.map((x) => (x.productId === pid ? { ...x, qtyPcs: totalPcs } : x)))
  }

  async function placeOrder() {
    if (cart.length === 0 || placing) return
    if (cart.some((c) => c.qtyPcs <= 0)) return
    // Task 26: STOCK LIMIT — direct qty entry par bhi available se zyada block (server bhi check karta hai)
    const overCart = cart.filter((c) => {
      const p = products.find((x) => x.id === c.productId)
      return p ? c.qtyPcs > p.available : false
    })
    if (overCart.length > 0) {
      const names = overCart.slice(0, 2).map((c) => products.find((x) => x.id === c.productId)?.name ?? '').filter(Boolean).join(', ')
      toast({ title: 'Stock limit crossed', description: `${names}${overCart.length > 2 ? ` +${overCart.length - 2} aur` : ''} — available stock se zyada book nahi ho sakta`, variant: 'destructive' })
      return
    }
    // Task 83: GPS shop open hote hi auto-capture ho chuka — captured na ho to order place hi nahi hoga
    if (!gps) {
      toast({
        title: 'GPS capture lazmi hai',
        description: 'Location abhi capture nahi hui — phone mein location ON kar ke "Location nahi mili — Retry" dabayein',
        variant: 'destructive',
      })
      return
    }
    setPlacing(true)
    const items = cart.map((c) => {
      const p = products.find((x) => x.id === c.productId)
      const upc = Math.max(1, p?.unitsPerCarton ?? 1)
      const ppb = p?.pcsPerBox && p.pcsPerBox > 0 ? p.pcsPerBox : 0
      const s = splitPcs(c.qtyPcs, upc, ppb)
      return { productId: c.productId, ctn: s.ctn, box: s.box, pcs: s.pcs }
    })
    const payload = JSON.stringify({
      outletId: shop.outletId, salesmanId: userId, items,
      discount: discType !== 'NONE' && discInputValid ? { type: discType, value: discNum } : undefined,
      // Task 82: GPS evidence + unplanned flag — server isi se gates lagata hai
      fromBooker: true,
      unplanned: !!unplanned,
      lat: gps.lat,
      lng: gps.lng,
    })
    const itemsPcs = cart.reduce((s, c) => s + c.qtyPcs, 0)
    // OFFLINE — order queue mein (internet aane par khud sync, schemes server par apply hongi)
    if (!navigator.onLine) {
      addToQueue(userId, { kind: 'ORDER', label: `${shop.name} — ${cart.length} items / ${itemsPcs} pcs`, url: '/api/orders', method: 'POST', body: payload })
      setCart([]); setCartOpen(false); deleteDiscount()
      setPlacing(false)
      toast({ title: 'Offline — order queue mein save ✓', description: 'Internet aane par khud sync hoga — Orders tab mein "Pending Sync" nazar aayega' })
      onPlaced()
      return
    }
    try {
      const r = await api<{ order: { orderNo: string; total: number } }>('/api/orders', { method: 'POST', body: payload })
      toast({ title: `Order ${r.order.orderNo} Booked ✓`, description: `${shop.name} — Total: ${fmtPKR(r.order.total)} — schemes applied` })
      setCart([]); setCartOpen(false); deleteDiscount()
      onPlaced()
    } catch (e) {
      if (isNetworkError(e)) {
        addToQueue(userId, { kind: 'ORDER', label: `${shop.name} — ${cart.length} items / ${itemsPcs} pcs`, url: '/api/orders', method: 'POST', body: payload })
        setCart([]); setCartOpen(false); deleteDiscount()
        toast({ title: 'Network fail — order queue mein save ✓', description: 'Internet aane par khud sync hoga' })
        onPlaced()
      } else {
        toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
      }
    } finally { setPlacing(false) }
  }

  return (
    <>
      <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
        <DialogContent className="max-w-lg h-[92vh] max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Order Punch — {shop.name}</DialogTitle>
          {/* Header — shop + previous balance */}
          <div className="shrink-0 border-b bg-slate-50 p-3.5 pr-12">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-slate-900 text-sm flex items-center gap-1.5"><Store className="h-4 w-4 text-violet-600 shrink-0" /> {shop.name}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{shop.code} • {shop.channel} • {shop.city}</p>
                {unplanned && (
                  <Badge className="mt-1.5 bg-violet-600 text-white text-[9px] px-1.5">UNPLANNED — out of route</Badge>
                )}
                {/* Task 83: GPS status — shop open hote hi auto capture, captured na ho to place disabled */}
                {gpsStatus === 'capturing' && (
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                    <Loader2 className="h-3 w-3 animate-spin" /> LOCATION CAPTURE HO RAHI HAI...
                  </span>
                )}
                {gpsStatus === 'captured' && (
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                    <MapPin className="h-3 w-3" /> LOCATION CAPTURED {gps?.accuracy ? `(±${Math.round(gps.accuracy)}m)` : ''} ✓
                  </span>
                )}
                {gpsStatus === 'failed' && (
                  <button type="button" onClick={fetchGps} className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-red-50 border border-red-200 px-1.5 py-0.5 text-[9px] font-bold text-red-600 hover:bg-red-100 transition-colors">
                    <MapPin className="h-3 w-3" /> LOCATION NAHI MILI — RETRY
                  </button>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold ${hasUdhaar ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPKR(Math.max(0, shop.balance))}</p>
                <p className="text-[10px] text-slate-400">previous balance</p>
              </div>
            </div>
            {hasUdhaar && (
              <button type="button" onClick={onRecoveryRequest}
                className="mt-2.5 w-full flex items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-left hover:bg-amber-100 transition-colors">
                <span className="text-[11px] text-amber-800 leading-tight"><b>Pehle recovery lein</b> — is shop ka udhaar baqi hai</span>
                <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1 shrink-0"><HandCoins className="h-3.5 w-3.5" /> Recovery</span>
              </button>
            )}
          </div>

          {/* Products — scrollable */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
            <Input placeholder="Product search..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="grid grid-cols-2 gap-2.5">
              {filteredProducts.map((p) => {
                const inCart = cart.find((c) => c.productId === p.id)
                return (
                  <Card key={p.id} className="border-slate-200 shadow-sm overflow-hidden">
                    <CardContent className="p-3">
                      <p className="text-xs font-semibold text-slate-800 leading-tight line-clamp-2 min-h-8">{p.name}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{p.brand} • {fmtPKR(p.tradePrice)}/crtn • {packHint(p.unitsPerCarton, p.boxesPerCarton, p.pcsPerBox)}</p>
                      {/* Task 26: available stock — booker stock se zyada book na kar sake */}
                      <p className={`text-[10px] font-semibold mt-1 ${p.available <= 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {p.available <= 0 ? 'Out of stock' : `Avail: ${fmtQty(p.available, Math.max(1, p.unitsPerCarton), p.pcsPerBox > 0 ? p.pcsPerBox : 0)}`}
                      </p>
                      {inCart ? (
                        <div className="mt-2 -ml-1">
                          <UnitQtyInputs
                            pcs={inCart.qtyPcs}
                            upc={Math.max(1, p.unitsPerCarton)}
                            pcsPerBox={p.pcsPerBox > 0 ? p.pcsPerBox : 0}
                            inputW="w-12"
                            onChange={(totalPcs) => setItemPcs(p.id, totalPcs)}
                          />
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="w-full mt-2 h-7 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => addToCart(p.id)}>
                          <Plus className="h-3 w-3 mr-1" /> Add
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
              {filteredProducts.length === 0 && <p className="col-span-2 py-8 text-center text-xs text-slate-400">Koi product nahi mila</p>}
            </div>
          </div>

          {/* Footer — cart summary */}
          <div className="shrink-0 border-t p-3">
            {cart.length === 0 ? (
              <div className="h-11 rounded-lg bg-slate-100 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                <ShoppingCart className="h-4 w-4" /> Cart khali — products add karein
              </div>
            ) : (
              <button type="button" onClick={() => setCartOpen(true)}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-2 text-sm font-bold shadow-sm shadow-emerald-600/20 transition-colors">
                <ShoppingCart className="h-4.5 w-4.5" />
                {cart.length} items • {cartPcs} pcs • {fmtPKR(Math.round(cartValue * 100) / 100)}
                <span className="text-emerald-100 text-xs font-medium">— Cart kholein</span>
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {cartOpen && (
        <CartDialog
          cart={cart}
          products={products}
          shopName={shop.name}
          cartValue={cartValue}
          discType={discType}
          setDiscType={setDiscType}
          discValue={discValue}
          setDiscValue={setDiscValue}
          manualDiscount={manualDiscount}
          deleteDiscount={deleteDiscount}
          changeQty={changeQty}
          onQtyChange={setItemPcs}
          placing={placing}
          onPlace={placeOrder}
          gpsStatus={gpsStatus}
          gpsAccuracy={gps?.accuracy}
          onRetryGps={fetchGps}
          onClose={() => setCartOpen(false)}
        />
      )}
    </>
  )
}

/* ================= CART (order review + place) ================= */
function CartDialog({ cart, products, shopName, cartValue, discType, setDiscType, discValue, setDiscValue, manualDiscount, deleteDiscount, changeQty, onQtyChange, placing, gpsStatus, gpsAccuracy, onRetryGps, onPlace, onClose }: {
  cart: { productId: string; qtyPcs: number }[]
  products: ProductDTO[]
  shopName: string
  cartValue: number
  discType: DiscType
  setDiscType: (v: DiscType) => void
  discValue: string
  setDiscValue: (v: string) => void
  manualDiscount: number
  deleteDiscount: () => void
  changeQty: (pid: string, dCtn: number) => void
  onQtyChange: (pid: string, totalPcs: number) => void
  placing: boolean
  /** Task 83: shop-open GPS auto capture ka status */
  gpsStatus: 'capturing' | 'captured' | 'failed'
  gpsAccuracy?: number
  onRetryGps: () => void
  onPlace: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md max-h-[88vh] p-4 gap-3 overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base">Order Cart — {shopName}</DialogTitle>
          <DialogDescription>Ctn/Box/Pcs adjust karein aur place karein — schemes auto-apply hongi</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 -mx-1 px-1">
          {cart.map((c) => {
            const p = products.find((x) => x.id === c.productId)
            if (!p) return null
            const ratePc = p.tradePrice / Math.max(1, p.unitsPerCarton)
            return (
              <div key={c.productId} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                    <p className="text-[10px] text-slate-400">{packHint(p.unitsPerCarton, p.boxesPerCarton, p.pcsPerBox)} • {fmtPKR(ratePc)}/pc</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-slate-800">{fmtPKR(Math.round(ratePc * c.qtyPcs * 100) / 100)}</span>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" onClick={() => changeQty(c.productId, -Math.ceil(c.qtyPcs / Math.max(1, p.unitsPerCarton)))}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <UnitQtyInputs
                    pcs={c.qtyPcs}
                    upc={Math.max(1, p.unitsPerCarton)}
                    pcsPerBox={p.pcsPerBox > 0 ? p.pcsPerBox : 0}
                    onChange={(totalPcs) => onQtyChange(c.productId, totalPcs)}
                  />
                  <span className="text-xs font-semibold text-emerald-700">= {fmtQty(c.qtyPcs, p.unitsPerCarton, p.pcsPerBox)}</span>
                </div>
                {/* Task 26: available guard — over-limit line red, warna available info */}
                {c.qtyPcs > p.available ? (
                  <p className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                    Stock limit: sirf {fmtQty(p.available, Math.max(1, p.unitsPerCarton), p.pcsPerBox > 0 ? p.pcsPerBox : 0)} available hai
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-400">Available: <span className="font-semibold text-emerald-600">{fmtQty(p.available, Math.max(1, p.unitsPerCarton), p.pcsPerBox > 0 ? p.pcsPerBox : 0)}</span></p>
                )}
              </div>
            )
          })}
          {cart.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Cart khali hai — pehle products add karein</p>}
        </div>
        <div className="shrink-0 border-t pt-3 space-y-2">
          {/* Manual discount — % ya flat Rs */}
          <div className="flex items-center gap-1.5">
            <Percent className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <select
              value={discType}
              onChange={(e) => setDiscType(e.target.value as DiscType)}
              className="h-9 rounded-md border bg-white px-2 text-xs font-medium w-[112px] shrink-0"
            >
              <option value="NONE">No Disc</option>
              <option value="PERCENT">Percent %</option>
              <option value="FLAT">Flat Rs</option>
            </select>
            <input
              type="number" min={0} step="0.01" inputMode="decimal"
              disabled={discType === 'NONE'}
              value={discValue}
              onChange={(e) => setDiscValue(e.target.value)}
              placeholder={discType === 'FLAT' ? '500' : '5'}
              className="h-9 min-w-0 flex-1 rounded-md border px-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            />
            {manualDiscount > 0 ? (
              <span className="text-xs font-bold text-emerald-700 whitespace-nowrap">-{fmtPKR(manualDiscount)}</span>
            ) : (discType !== 'NONE' || discValue) && (
              <button onClick={deleteDiscount} className="h-9 w-9 flex items-center justify-center text-red-500 shrink-0"><XCircle className="h-4 w-4" /></button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Est. Total (before schemes)</span>
            <span className="text-lg font-bold">{fmtPKR(Math.round(cartValue * 100) / 100)}</span>
          </div>
          {/* Task 83: live GPS status — captured na ho to Place Order disabled */}
          {gpsStatus === 'capturing' && (
            <p className="text-[10px] text-amber-600 text-center -mt-1 flex items-center justify-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Location capture ho rahi hai — thora intezar karein</p>
          )}
          {gpsStatus === 'captured' && (
            <p className="text-[10px] text-emerald-600 text-center -mt-1 flex items-center justify-center gap-1"><MapPin className="h-3 w-3" /> Location captured {gpsAccuracy ? `(±${Math.round(gpsAccuracy)}m)` : ''} ✓ — order place ho sakta hai</p>
          )}
          {gpsStatus === 'failed' && (
            <button type="button" onClick={onRetryGps} className="mx-auto text-[10px] font-bold text-red-600 text-center -mt-1 flex items-center justify-center gap-1 hover:underline">
              <MapPin className="h-3 w-3" /> Location nahi mili — tap kar ke dobara try karein
            </button>
          )}
          <Button onClick={onPlace} disabled={placing || cart.length === 0 || gpsStatus !== 'captured'} className="w-full bg-emerald-600 hover:bg-emerald-700 h-11">
            {placing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />} Place Order
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ================= MY ORDERS (aaj ki bookings + offline queue) ================= */
function MyOrdersTab() {
  const user = useDMS((s) => s.user)
  const [orders, setOrders] = useState<OrderDTO[]>([])
  const [loading, setLoading] = useState(true)
  const { queue } = useRouteState(user?.id)

  useEffect(() => {
    if (!user) return
    api<{ orders: OrderDTO[] }>(`/api/orders?userId=${user.id}`).then((r) => setOrders(r.orders)).finally(() => setLoading(false)).catch(() => setLoading(false))
  }, [user])

  if (loading) return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>

  // ALL-TIME hidden — sirf AAJ ki booked orders + offline queue wali entries (Karachi din)
  const todayOrders = orders.filter((o) => isSameKarachiDay(o.orderDate))
  const queuedOrders = queue.filter((q) => q.kind === 'ORDER')
  const queuedRecoveries = queue.filter((q) => q.kind === 'RECOVERY')

  return (
    <div className="space-y-2.5">
      {queuedOrders.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber-600 mb-1.5">PENDING SYNC — OFFLINE ORDERS ({queuedOrders.length})</p>
          {queuedOrders.map((q) => (
            <Card key={q.id} className="border-amber-300 bg-amber-50 shadow-sm mb-2">
              <CardContent className="p-3.5 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <Clock3 className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-amber-800 text-sm">Offline Order — {q.label}</p>
                  <p className="text-xs text-slate-500 truncate">{new Date(q.createdAt).toLocaleString('en-PK')} • internet aane par khud sync hoga</p>
                  {q.lastError && <p className="text-[10px] text-red-500 truncate">Sync fail: {q.lastError}</p>}
                </div>
                <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[9px] shrink-0">Pending Sync</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs font-semibold text-slate-500">AAJ KI BOOKED ORDERS ({todayOrders.length})</p>
      {todayOrders.map((o) => (
        <Card key={o.id} className="border-slate-200 shadow-sm">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
              <ShoppingCart className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-emerald-700 text-sm">{o.orderNo}</p>
              <p className="text-xs text-slate-500 truncate">{o.outletName} • {o.itemCount} items • {fmtDate(o.orderDate)}</p>
            </div>
            <div className="text-right shrink-0">
              {/* Task 77: bill ka final payable (Net − TO + GST + Adv Tax) — goods net nahi */}
              <p className="font-bold text-sm">{fmtPKR(orderGrandPayable(o))}</p>
              <div className="flex items-center gap-1 justify-end">
                {o.unplanned && <Badge variant="outline" className="border-violet-300 text-violet-600 bg-violet-50 text-[8px] px-1 py-0">Unplanned</Badge>}
                <Badge variant="outline" className={`${STATUS_STYLES[o.status]} text-[9px]`}>{statusLabel(o.status)}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {todayOrders.length === 0 && queuedOrders.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-slate-400">Aaj ki koi booking nahi — Shops page par shop pr tap karein aur Order punch karein</CardContent></Card>}
      {queuedRecoveries.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-800">⏳ {queuedRecoveries.length} offline recovery entries bhi queue mein hain — internet aane par sync hongi</p>
        </div>
      )}
    </div>
  )
}

/* ================= PROFILE ================= */
function MeTab() {
  const user = useDMS((s) => s.user)
  const { setUser } = useDMS()
  // Task 67: booker ko APNA month target + live progress nazar — distributor jo set karta hai
  const [perf, setPerf] = useState<SalesmanPerfDTO | null>(null)

  useEffect(() => {
    if (!user) return
    api<{ salesmen: SalesmanPerfDTO[] }>(`/api/field-force?userId=${user.id}`)
      .then((r) => setPerf(r.salesmen[0] ?? null))
      .catch(() => { /* offline — target card skip */ })
  }, [user])

  return (
    <div className="space-y-3">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-5 text-center">
          <div className="h-16 w-16 rounded-full bg-emerald-100 mx-auto flex items-center justify-center text-emerald-700 text-xl font-bold">
            {user?.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
          </div>
          <p className="font-bold text-lg mt-3">{user?.name}</p>
          <p className="text-sm text-slate-500">{user?.email}</p>
          <Badge className="mt-2 bg-emerald-600">Order Booker / Salesman</Badge>
          <div className="grid grid-cols-2 gap-2 mt-4 text-left">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">Region</p>
              <p className="text-sm font-semibold">{user?.region ?? 'Lahore'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">Phone</p>
              <p className="text-sm font-semibold">{user?.phone ?? '—'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Task 67: apna month target + live progress — distributor Field Force se jo set karta hai */}
      {perf && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 flex items-center gap-1"><Target className="h-3.5 w-3.5 text-amber-600" /> Is Month ka Target</p>
              {perf.monthTarget > 0 && (
                <span className={`text-xs font-bold ${perf.achievement >= 100 ? 'text-emerald-600' : perf.achievement >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                  {perf.achievement}% achieved
                </span>
              )}
            </div>
            {perf.monthTarget > 0 ? (
              <>
                <div className="flex items-baseline justify-between">
                  <p className="text-lg font-bold text-slate-900">{fmtPKR(perf.monthSales)}</p>
                  <p className="text-xs text-slate-400">target {fmtPKR(perf.monthTarget)}</p>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${perf.achievement >= 100 ? 'bg-emerald-500' : perf.achievement >= 60 ? 'bg-amber-500' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(perf.achievement, 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  {perf.monthOrders} orders • {perf.achievement >= 100 ? 'Target achieve ho gaya — shabash! 🎉' : `${fmtPKR(Math.max(perf.monthTarget - perf.monthSales, 0))} baqi hain`}
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-400">Is month ka target abhi set nahi hua — distributor target set karega to yahan progress nazar aayega</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-500 flex items-center gap-1"><Wallet className="h-3.5 w-3.5" /> TIPS</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            • Har din field se pehle <b>My Day se Route Start</b> karein — us din ki shops download hongi<br />
            • Route ab <b>AUTO</b> hai — shop pe booker + din assign hote hi wo shop usi din nazar aayegi (manual plan ki zaroorat nahi)<br />
            • <b>Order place karte waqt GPS lazmi</b> hai — location ke bagair order create nahi hoga<br />
            • Route ki bahar shop? <b>Shops tab mein "Unplanned Shop"</b> button se order karein (admin ON rakhe to)<br />
            • <b>Offline bhi kaam hota hai</b> — order/recovery queue mein save hota hai, internet aane par khud sync<br />
            • <b>Route End</b> par din ka report khulega — total bills, total sale aur total recovery ka khulasa<br />
            • Shop pr tap karein — Recovery ya Order ka popup khulega; pehle udhaar recovery, phir order<br />
            • Recovery admin approve karega tab shop ledger update hogi
          </p>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="w-full border-red-200 text-red-500 hover:bg-red-50"
        onClick={() => {
          if (typeof window !== 'undefined') localStorage.removeItem('dms_session')
          setUser(null)
        }}
      >
        Logout
      </Button>
    </div>
  )
}
