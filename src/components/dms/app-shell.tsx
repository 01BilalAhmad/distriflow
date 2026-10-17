'use client'

// Task 31 — TOP NAVIGATION REDESIGN (Salesflo-style, lekin unique):
// Pehle sidebar folders the — ab teen-row top bar hai:
//   1) Top strip: logo + business name | date | user chip + logout
//   2) PRIMARY NAV: module tabs (Sales / Finance / Catalog...) — active tab gradient pill
//      + diamond notch jo neeche sub-nav ki taraf point karta hai (unique connector)
//   3) SUB-NAV: active module ke pages icon-tiles ke tor par (Salesflo jaisa, magar
//      rounded-2xl lift-effect cards + gradient icon box)
// Task 31b — CENTERED: module tabs + sub-nav tiles dono page ke CENTER mein (Saleflo
// jaisa). Technique: inner w-max + mx-auto — content chhota ho to center, overflow ho
// to left-align + scrollable (justify-center + overflow ka left-clipping bug avoid).
// Role model wahi (Task 22): MEGA_ADMIN = sirf Distributor Accounts, SALESMAN = apna app.
//
// Task 65 — HAR SECTION KA APNA ALAG SECURE PAGE:
//   - Pehle activeView zustand in-memory state thi → refresh par dashboard par wapas.
//     Ab har section ka apna URL route hai — activeView URL (pathname) se derive hota hai.
//   - Navigation router.push se hoti hai → URL badalta hai → refresh par WAHI section
//     milta hai, dashboard redirect khatam. Browser back/forward bhi kaam karta hai.
// Task 65-b — NAV ITEMS AB REAL LINKS: <button> ko <Link> banaya — right-click par
//   browser menu "Copy link address" / "Open in new tab" deta hai, middle-click bhi.
//   (URL to router.push se bhi badalta tha, lekin button ka browser ko href nahi pata
//   tha is liye copy-link option nahi aata tha.)
//   - Session ab double-layered: localStorage cache + httpOnly signed cookie (middleware
//     server-side gate). Shell mount par /api/auth/session se cookie verify/refresh —
//     401 aaye to force logout (localStorage stale na rahe).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useDMS, loadSession, saveSession } from '@/lib/dms-store'
import { VIEW_PATH, viewFromPath } from '@/lib/dms-nav'
import { SalesmanApp } from './salesman-app'
import {
  LayoutDashboard, ShoppingCart, Warehouse, Package, Store, Network, Route,
  Users, Gift, Undo2, BarChart3, Package2, LogOut, Building2,
  ClipboardList, FileStack, Wallet, BookText, HandCoins, Landmark,
  Database, Map as MapIcon, TrendingUp, Receipt, Target, Boxes,
} from 'lucide-react'

// group = module ka naam (primary tab) — items us module ke sub-nav tiles isi order mein
// Task 22 role model: MEGA_ADMIN = sirf Distributor Accounts console (business data locked);
// DISTRIBUTOR = poora business portal (apne data par), SALESMAN = field app.
const NAV: { key: string; label: string; icon: typeof LayoutDashboard; roles: string[]; group: string }[] = [
  // Mega Admin — sirf account management, koi business view nahi
  { key: 'mega-accounts', label: 'Distributor Accounts', icon: Landmark, roles: ['MEGA_ADMIN'], group: 'Overview' },
  { key: 'backup', label: 'Backup & Safety', icon: Database, roles: ['MEGA_ADMIN'], group: 'Overview' },
  // Overview
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['DISTRIBUTOR'], group: 'Overview' },
  // Sales — rozana cycle order: booking → bills → van → cash settlement
  { key: 'orders', label: 'Orders', icon: ShoppingCart, roles: ['DISTRIBUTOR'], group: 'Sales' },
  { key: 'unprocessed', label: 'Unprocessed Bills', icon: ClipboardList, roles: ['DISTRIBUTOR'], group: 'Sales' },
  { key: 'summaries', label: 'Delivery Summaries', icon: FileStack, roles: ['DISTRIBUTOR'], group: 'Sales' },
  { key: 'settlement', label: 'Settlement', icon: Wallet, roles: ['DISTRIBUTOR'], group: 'Sales' },
  // Finance — khata / wapasi / returns
  { key: 'ledgers', label: 'Shop Ledgers', icon: BookText, roles: ['DISTRIBUTOR'], group: 'Finance' },
  { key: 'recovery', label: 'Recovery (Wasooli)', icon: HandCoins, roles: ['DISTRIBUTOR'], group: 'Finance' },
  { key: 'returns', label: 'Returns & Claims', icon: Undo2, roles: ['DISTRIBUTOR'], group: 'Finance' },
  // Task 69 — Reports APNA POORA MODULE (pehle Finance ke andar tha) — har report ka apna URL
  { key: 'reports', label: 'Overview', icon: BarChart3, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-sales-profit', label: 'Sales & Profit', icon: TrendingUp, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-zero-purchase', label: 'Zero Purchase', icon: ShoppingCart, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-tax', label: 'Tax (GST/WHT)', icon: Receipt, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-recovery', label: 'Recovery', icon: HandCoins, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-targets', label: 'Targets', icon: Target, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-stock', label: 'Stock', icon: Boxes, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-booker-perf', label: 'Booker Perf', icon: Users, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-company-purchase', label: 'Purchases', icon: Building2, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-returns-claims', label: 'Returns', icon: Undo2, roles: ['DISTRIBUTOR'], group: 'Reports' },
  { key: 'reports-top-shops', label: 'Top Shops', icon: Store, roles: ['DISTRIBUTOR'], group: 'Reports' },
  // Stock & Catalog — stock aur items
  { key: 'inventory', label: 'Inventory', icon: Warehouse, roles: ['DISTRIBUTOR'], group: 'Stock & Catalog' },
  { key: 'products', label: 'Products', icon: Package, roles: ['DISTRIBUTOR'], group: 'Stock & Catalog' },
  { key: 'schemes', label: 'Schemes & Promotions', icon: Gift, roles: ['DISTRIBUTOR'], group: 'Stock & Catalog' },
  // Field Operations — routes / dukaanein / team
  { key: 'pjp', label: 'PJP / Routes', icon: Route, roles: ['DISTRIBUTOR', 'SALESMAN'], group: 'Field Operations' },
  { key: 'outlets', label: 'Outlets', icon: Store, roles: ['DISTRIBUTOR', 'SALESMAN'], group: 'Field Operations' },
  { key: 'field-force', label: 'Field Force', icon: Users, roles: ['DISTRIBUTOR'], group: 'Field Operations' },
  { key: 'visit-map', label: 'Visit Map', icon: MapIcon, roles: ['DISTRIBUTOR'], group: 'Field Operations' },
  // Business Network — company aur distribution tree
  { key: 'companies', label: 'Companies (Procurement)', icon: Building2, roles: ['DISTRIBUTOR'], group: 'Business Network' },
  { key: 'distributors', label: 'My Network', icon: Network, roles: ['DISTRIBUTOR'], group: 'Business Network' },
  // SALESMAN top nav tak pohanchta hi nahi (SalesmanApp render hota hai) — sirf type fallback
  { key: 'sales-app', label: 'Order Booker App', icon: Package2, roles: ['SALESMAN'], group: 'Overview' },
]

type NavKey = string & keyof typeof VIEW_PATH

// Modules (primary tabs) — upar se neeche yahi order; icon = tab icon
const MODULES: { name: string; icon: typeof LayoutDashboard }[] = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Sales', icon: ShoppingCart },
  { name: 'Finance', icon: Wallet },
  { name: 'Reports', icon: BarChart3 },
  { name: 'Stock & Catalog', icon: Package },
  { name: 'Field Operations', icon: Route },
  { name: 'Business Network', icon: Network },
]

export function DMSApp({ children }: { children: React.ReactNode }) {
  const { user, setUser, purchaseDraftDirty } = useDMS()
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)

  // Task 65: active view URL se — refresh/back/forward sab par sahi section milta hai
  const activeView = viewFromPath(pathname ?? '/')

  // Task 65-b: Link ke sath navigation khud <a href> karta hai — onClick sirf Task 49
  // ka purchase-draft confirm guard hai. Sirf plain left-click par chalta hai; Ctrl/Cmd
  // click, middle-click, right-click → native browser behavior (new tab / context menu).
  function guardNavClick(target: string) {
    return (e: React.MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (activeView === 'purchase-entry' && target !== 'purchase-entry' && purchaseDraftDirty) {
        const ok = window.confirm('Purchase invoice form mein adhoora data hai — draft auto-save ho chuka hai, wapas aaoge to poora milega.\n\nPhir bhi page chhorein?')
        if (!ok) e.preventDefault()
      }
    }
  }

  useEffect(() => {
    const s = loadSession()
    queueMicrotask(() => {
      if (s) setUser(s)
      setMounted(true)
    })
  }, [setUser])

  // Task 65 — cookie session verify/refresh: localStorage cache ke sath server-side
  // source of truth. 401 (cookie expire/gayab + DB mein user nahi) → force logout.
  useEffect(() => {
    if (!mounted) return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/auth/session', { method: 'POST' })
        if (!alive) return
        if (res.ok) {
          const data = (await res.json()) as { user: Parameters<typeof setUser>[0] }
          if (data.user) {
            setUser(data.user)
            saveSession(data.user)
          }
        } else {
          saveSession(null)
          setUser(null)
          router.replace('/login')
        }
      } catch { /* offline — localStorage session chalne do */ }
    })()
    return () => { alive = false }
  }, [mounted])

  // Task 24: doosre tab mein login/logout ho jaye to YE purana tab stale session ke
  // saath reh jata tha — phir us tab se banayi cheez galat distributor ke account mein
  // chali jati thi. storage event sirf DOOSRE tabs mein fire hota hai, isi liye
  // yahan reload karwa dete hain take session hamesha fresh rahe.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== 'dms_session') return
      window.location.reload()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Task 22: activeView role ke hisab se allowed nahi to allowed view par redirect
  // Task 49: 'purchase-entry' NAV mein nahi (full-page form hai) — DISTRIBUTOR ke liye
  // allowed list mein manually add.
  // Task 65: redirect ab router.replace se (URL bhi sahi rehta hai).
  const allowedViews = useMemo(() => {
    if (!user) return []
    const base = NAV.filter((n) => n.roles.includes(user.role)).map((n) => n.key)
    return user.role === 'DISTRIBUTOR' ? [...base, 'purchase-entry'] : base
  }, [user])
  useEffect(() => {
    if (user && allowedViews.length > 0 && (activeView === null || !allowedViews.includes(activeView))) {
      const home = VIEW_PATH[allowedViews[0] as NavKey] ?? '/'
      queueMicrotask(() => router.replace(home))
    }
  }, [user, allowedViews, activeView, router])

  // Task 65: user gayab (logout / stale session) → /login?next=<current section>.
  // RENDER ke andar router.replace forbidden tha (React setState-in-render error) —
  // is liye effect mein. Middleware normally pehle hi /login par bhej chuka hota hai —
  // ye belt & braces hai (next param se re-login par wapas isi section par).
  useEffect(() => {
    if (mounted && !user) {
      const next = encodeURIComponent(window.location.pathname)
      router.replace(`/login?next=${next}`)
    }
  }, [mounted, user, router])

  async function doLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
    saveSession(null)
    setUser(null)
    router.replace('/login')
  }

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-10 w-10 rounded-full border-4 border-emerald-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-10 w-10 rounded-full border-4 border-emerald-600 border-t-transparent animate-spin" />
      </div>
    )
  }
  if (user.role === 'SALESMAN') return <SalesmanApp />

  const nav = NAV.filter((n) => n.roles.includes(user.role))
  const modules = MODULES
    .map((m) => ({ ...m, items: nav.filter((n) => n.group === m.name) }))
    .filter((m) => m.items.length > 0)
  const activeModule = modules.find((m) => m.items.some((i) => i.key === activeView)) ?? modules[0]

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-gradient-to-br from-emerald-50/70 via-slate-50 to-teal-50/50">
      {/* ============ TOP NAV (3 rows, glass) ============ */}
      <header className="relative shrink-0 z-30 border-b border-emerald-100/80 bg-white/75 backdrop-blur-xl">
        {/* unique touch: upar gradient hairline */}
        <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-emerald-500 via-teal-400 to-transparent" />

        {/* Row 1 — brand | date | user */}
        <div className="flex items-center justify-between gap-3 px-3 sm:px-5 pt-2.5 pb-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 flex items-center justify-center shrink-0 shadow-md shadow-emerald-600/25">
              <Package2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-slate-900 leading-tight truncate">DistriFlow</p>
              <p className="text-[11px] text-emerald-700 font-medium truncate">
                {user.role === 'MEGA_ADMIN' ? 'Mega Admin Console' : user.profile?.businessName ?? 'Company HQ'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden lg:block text-[11px] text-slate-400">
              {new Date().toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span className="hidden sm:inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              {user.role.replaceAll('_', ' ')}
            </span>
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 pl-1 pr-1 py-1 shadow-sm">
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-emerald-600 to-teal-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {user.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
              </div>
              <span className="hidden md:block text-xs font-semibold text-slate-700 pr-1 max-w-[120px] truncate">{user.name}</span>
              <button
                onClick={doLogout}
                className="h-7 w-7 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Logout"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Row 2 — PRIMARY module tabs (active = gradient pill + diamond notch) — CENTERED */}
        <nav className="overflow-x-auto px-2 sm:px-4 pb-2.5 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-100">
          <div className="mx-auto flex w-max items-stretch gap-1">
          {modules.map((m) => {
            const on = m.name === activeModule.name
            return (
              <Link
                key={m.name}
                href={VIEW_PATH[m.items[0].key as NavKey]}
                onClick={guardNavClick(m.items[0].key)}
                title={`${m.name} module — ${m.items.length} pages`}
                className={`relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 ${
                  on
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'
                }`}
              >
                <m.icon className="h-4 w-4" />
                <span className="whitespace-nowrap">{m.name}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                  on ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'
                }`}>{m.items.length}</span>
                {/* diamond notch — active tab se sub-nav ki taraf ishara */}
                {on && (
                  <span className="absolute left-1/2 -translate-x-1/2 -bottom-[6px] h-2.5 w-2.5 rotate-45 rounded-[2px] bg-gradient-to-br from-emerald-600 to-teal-500" />
                )}
              </Link>
            )
          })}
          </div>
        </nav>

        {/* Row 3 — SUB-NAV icon tiles (active module ke pages) — CENTERED */}
        <div className="overflow-x-auto px-2 sm:px-4 pb-2 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-100">
          <div className="mx-auto flex w-max items-stretch gap-1.5">
          {activeModule.items.map((n) => {
            const on = n.key === activeView
            return (
              <Link
                key={n.key}
                href={VIEW_PATH[n.key as NavKey]}
                onClick={guardNavClick(n.key)}
                className={`group flex w-[104px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-1.5 pt-2 pb-1.5 transition-all duration-200 ${
                  on
                    ? 'border-emerald-200 bg-white shadow-md shadow-emerald-600/10 -translate-y-0.5'
                    : 'border-transparent hover:border-slate-200 hover:bg-white/70 hover:shadow-sm hover:-translate-y-0.5'
                }`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 ${
                  on
                    ? 'bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-sm shadow-emerald-600/30'
                    : 'bg-slate-100 text-slate-500 group-hover:bg-emerald-50 group-hover:text-emerald-600'
                }`}>
                  <n.icon className="h-4.5 w-4.5" />
                </span>
                <span className={`text-center text-[10px] leading-tight break-words ${on ? 'font-bold text-emerald-700' : 'font-medium text-slate-500'}`}>
                  {n.label}
                </span>
              </Link>
            )
          })}
          </div>
        </div>
      </header>

      {/* ============ MAIN — page scroll nahi, har view apna internal layout manage karta hai ============ */}
      <main className="flex-1 min-h-0 w-full max-w-[1500px] mx-auto overflow-hidden px-3 sm:px-5 py-3">
        {children}
      </main>
    </div>
  )
}
