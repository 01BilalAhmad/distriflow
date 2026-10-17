'use client'

// Task 70 — PROFESSIONAL DARK TOP BAR (user-selected Mockup B, Shopify/ClickUp style):
// Pehla 3-row light top bar tha (brand row + module pills + icon tiles) — ab EK dark bar:
//   1) DARK BAR (h-14, slate-900): brand + ERP tag | module tabs (hover par MEGA-DROPDOWN
//      jo module ke sab pages icons + 1-line desc ke sath dikhata hai) | right: ⌘K quick
//      search + user menu (role, business, logout)
//   2) BREADCRUMB STRIP (h-11, white): Module / Page trail + date chip
//   3) SUB-NAV CHIPS sirf <lg screens par (mega-dropdown hover-based hai, touch ke liye
//      chips fallback) — active module ke pages horizontal scrollable pills mein
// - Emerald/teal brand wahi rahega (user choice). Active module = white text + emerald
//   gradient underline (mockup B jaisa).
// - Task 65-b rule INTACT: har nav item REAL <Link> hai — right-click copy link, middle
//   click new tab, Ctrl/Cmd click sab native browser behavior karta hai.
// - Task 49 rule INTACT: purchase-entry ke adhoore draft par navigation confirm guard.
// - Mega-dropdown pure CSS hover hai (group-hover) — koi JS state nahi, is liye kabhi
//   stuck-open nahi hota. Panels `hidden lg:block` (chhoti screens par chips strip).
// - ⌘K / Ctrl+K se QuickNav dialog khulta hai — saare sections fuzzy search + keyboard
//   navigation (↑ ↓ ↵ esc). Yahan bhi purchase-draft guard apply hota hai.
// Role model wahi (Task 22): MEGA_ADMIN = sirf Distributor Accounts, SALESMAN = apna app.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useDMS, loadSession, saveSession } from '@/lib/dms-store'
import { VIEW_PATH, viewFromPath } from '@/lib/dms-nav'
import { SalesmanApp } from './salesman-app'
import { QuickNav } from './quick-nav'
import {
  LayoutDashboard, ShoppingCart, Warehouse, Package, Store, Network, Route,
  Users, Gift, Undo2, BarChart3, Package2, LogOut, Building2,
  ClipboardList, FileStack, Wallet, BookText, HandCoins, Landmark,
  Database, Map as MapIcon, TrendingUp, Receipt, Target, Boxes,
  ChevronDown, ChevronRight, Search, Calendar,
} from 'lucide-react'

// group = module ka naam (primary tab) — items us module ke mega-dropdown isi order mein
// desc = mega-dropdown item ke neeche 1-line explanation (Task 70)
// Task 22 role model: MEGA_ADMIN = sirf Distributor Accounts console (business data locked);
// DISTRIBUTOR = poora business portal (apne data par), SALESMAN = field app.
const NAV: { key: string; label: string; icon: typeof LayoutDashboard; roles: string[]; group: string; desc?: string }[] = [
  // Mega Admin — sirf account management, koi business view nahi
  { key: 'mega-accounts', label: 'Distributor Accounts', icon: Landmark, roles: ['MEGA_ADMIN'], group: 'Overview', desc: 'Sab distributors ke accounts' },
  { key: 'backup', label: 'Backup & Safety', icon: Database, roles: ['MEGA_ADMIN'], group: 'Overview', desc: 'Data safety & restore' },
  // Overview
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['DISTRIBUTOR'], group: 'Overview', desc: 'Aaj ka business snapshot' },
  // Sales — rozana cycle order: booking → bills → van → cash settlement
  { key: 'orders', label: 'Orders', icon: ShoppingCart, roles: ['DISTRIBUTOR'], group: 'Sales', desc: 'Order booking & history' },
  { key: 'unprocessed', label: 'Unprocessed Bills', icon: ClipboardList, roles: ['DISTRIBUTOR'], group: 'Sales', desc: 'Pending bills process karein' },
  { key: 'summaries', label: 'Delivery Summaries', icon: FileStack, roles: ['DISTRIBUTOR'], group: 'Sales', desc: 'Van delivery status' },
  { key: 'settlement', label: 'Settlement', icon: Wallet, roles: ['DISTRIBUTOR'], group: 'Sales', desc: 'Cash & udhaar hisaab' },
  // Finance — khata / wapasi / returns
  { key: 'ledgers', label: 'Shop Ledgers', icon: BookText, roles: ['DISTRIBUTOR'], group: 'Finance', desc: 'Har shop ka khata' },
  { key: 'recovery', label: 'Recovery (Wasooli)', icon: HandCoins, roles: ['DISTRIBUTOR'], group: 'Finance', desc: 'Wasooli & pending amounts' },
  { key: 'returns', label: 'Returns & Claims', icon: Undo2, roles: ['DISTRIBUTOR'], group: 'Finance', desc: 'Wapasi & claims' },
  // Task 69 — Reports APNA POORA MODULE — har report ka apna URL
  { key: 'reports', label: 'Overview', icon: BarChart3, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Sab reports ka KPI snapshot' },
  { key: 'reports-sales-profit', label: 'Sales & Profit', icon: TrendingUp, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Revenue vs profit analysis' },
  { key: 'reports-zero-purchase', label: 'Zero Purchase', icon: ShoppingCart, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Dead shops 30/60/90 din' },
  { key: 'reports-tax', label: 'Tax (GST/WHT)', icon: Receipt, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'GST summary & FBR annex' },
  { key: 'reports-recovery', label: 'Recovery', icon: HandCoins, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Wasooli performance report' },
  { key: 'reports-targets', label: 'Targets', icon: Target, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Booker targets & achievement' },
  { key: 'reports-stock', label: 'Stock', icon: Boxes, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Stock on hand & expiring' },
  { key: 'reports-booker-perf', label: 'Booker Perf', icon: Users, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Team scorecard' },
  { key: 'reports-company-purchase', label: 'Purchases', icon: Building2, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Company procurement report' },
  { key: 'reports-returns-claims', label: 'Returns', icon: Undo2, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Returns & claims report' },
  { key: 'reports-top-shops', label: 'Top Shops', icon: Store, roles: ['DISTRIBUTOR'], group: 'Reports', desc: 'Sab se baray buyers' },
  // Stock & Catalog — stock aur items
  { key: 'inventory', label: 'Inventory', icon: Warehouse, roles: ['DISTRIBUTOR'], group: 'Stock & Catalog', desc: 'Live stock levels' },
  { key: 'products', label: 'Products', icon: Package, roles: ['DISTRIBUTOR'], group: 'Stock & Catalog', desc: 'Items, rates & cartons' },
  { key: 'schemes', label: 'Schemes & Promotions', icon: Gift, roles: ['DISTRIBUTOR'], group: 'Stock & Catalog', desc: 'Promotions & offers' },
  // Field Operations — routes / dukaanein / team
  { key: 'pjp', label: 'PJP / Routes', icon: Route, roles: ['DISTRIBUTOR', 'SALESMAN'], group: 'Field Operations', desc: 'Routes & visit schedule' },
  { key: 'outlets', label: 'Outlets', icon: Store, roles: ['DISTRIBUTOR', 'SALESMAN'], group: 'Field Operations', desc: 'Shops & booker assignment' },
  { key: 'field-force', label: 'Field Force', icon: Users, roles: ['DISTRIBUTOR'], group: 'Field Operations', desc: 'Order bookers team' },
  { key: 'visit-map', label: 'Visit Map', icon: MapIcon, roles: ['DISTRIBUTOR'], group: 'Field Operations', desc: 'Live location tracking' },
  // Business Network — company aur distribution tree
  { key: 'companies', label: 'Companies (Procurement)', icon: Building2, roles: ['DISTRIBUTOR'], group: 'Business Network', desc: 'Procurement & purchase rates' },
  { key: 'distributors', label: 'My Network', icon: Network, roles: ['DISTRIBUTOR'], group: 'Business Network', desc: 'Distribution network tree' },
  // SALESMAN top nav tak pohanchta hi nahi (SalesmanApp render hota hai) — sirf type fallback
  { key: 'sales-app', label: 'Order Booker App', icon: Package2, roles: ['SALESMAN'], group: 'Overview', desc: 'Field app for bookers' },
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
  const [quickOpen, setQuickOpen] = useState(false)
  const [userMenu, setUserMenu] = useState(false)

  // Task 65: active view URL se — refresh/back/forward sab par sahi section milta hai
  const activeView = viewFromPath(pathname ?? '/')
  // Task 70: purchase-entry full-page form hai — nav highlight uske parent module
  // (Stock & Catalog) par rakhein, warna koi tab active nazar nahi aata.
  const highlightView = activeView === 'purchase-entry' ? 'products' : activeView

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

  // QuickNav (⌘K) navigation — router.push wala rasta; yahan bhi wahi draft guard.
  function quickNavigate(key: string) {
    if (activeView === 'purchase-entry' && key !== 'purchase-entry' && purchaseDraftDirty) {
      const ok = window.confirm('Purchase invoice form mein adhoora data hai — draft auto-save ho chuka hai, wapas aaoge to poora milega.\n\nPhir bhi page chhorein?')
      if (!ok) return
    }
    setQuickOpen(false)
    router.push(VIEW_PATH[key as NavKey] ?? '/')
  }

  // Task 70: ⌘K / Ctrl+K → QuickNav dialog
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQuickOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // QuickNav ke liye flat item list (sirf current user ke allowed sections)
  const quickItems = useMemo(() => {
    if (!user) return []
    return NAV.filter((n) => n.roles.includes(user.role)).map((n) => ({
      key: n.key, label: n.label, group: n.group, desc: n.desc ?? '', icon: n.icon,
    }))
  }, [user])

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
  const activeModule = modules.find((m) => m.items.some((i) => i.key === highlightView)) ?? modules[0]
  const activeItem = nav.find((n) => n.key === activeView) ?? null
  const initials = user.name.split(' ').map((w) => w[0]).slice(0, 2).join('')

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[#f6f8fb]">
      {/* ============ DARK TOP BAR (Mockup B) ============ */}
      <header className="relative z-40 shrink-0 bg-slate-900">
        <div className="flex h-14 items-stretch gap-1 pl-3 pr-3 sm:pl-4">
          {/* Brand */}
          <Link href="/" onClick={guardNavClick('dashboard')} className="mr-1 flex shrink-0 items-center gap-2.5 self-center">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-500 shadow-lg shadow-emerald-500/25">
              <Package2 className="h-4.5 w-4.5 text-white" />
            </span>
            <span className="text-[15px] font-bold tracking-tight text-white">DistriFlow</span>
            <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-emerald-300">ERP</span>
          </Link>
          <span className="my-3.5 w-px shrink-0 bg-white/10" />

          {/* Module tabs + mega dropdowns (hover, pure CSS) */}
          <nav className="flex min-w-0 flex-1 items-stretch overflow-x-auto lg:overflow-visible [&::-webkit-scrollbar]:h-0">
            {modules.map((m, mi) => {
              const on = m.name === activeModule.name
              // aakhri modules ka dropdown right-align — screen se bahar na nikle
              const alignRight = mi >= modules.length - 2
              const wide = m.items.length > 4
              return (
                <div key={m.name} className="group relative flex shrink-0 items-stretch">
                  <Link
                    href={VIEW_PATH[m.items[0].key as NavKey]}
                    onClick={guardNavClick(m.items[0].key)}
                    title={`${m.name} — ${m.items.length} pages`}
                    className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 text-[13px] transition-colors ${
                      on ? 'font-semibold text-white' : 'font-medium text-slate-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {m.name}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                    {on && <span className="absolute inset-x-2.5 bottom-0 h-[3px] rounded-t bg-gradient-to-r from-emerald-500 to-teal-400" />}
                  </Link>
                  {/* MEGA DROPDOWN — hover/focus par khulta hai; pt-2 bridge hai */}
                  <div className={`invisible absolute top-full z-50 translate-y-1 pt-2 opacity-0 transition-all duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 ${alignRight ? 'right-0' : 'left-0'} hidden lg:block`}>
                    <div className={`rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/25 ${wide ? 'w-[600px]' : 'w-[340px]'}`}>
                      <div className={wide ? 'grid grid-cols-2 gap-0.5' : 'flex flex-col gap-0.5'}>
                        {m.items.map((n) => {
                          const itemOn = n.key === highlightView
                          return (
                            <Link
                              key={n.key}
                              href={VIEW_PATH[n.key as NavKey]}
                              onClick={guardNavClick(n.key)}
                              className={`group/i flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors ${
                                itemOn ? 'bg-emerald-50' : 'hover:bg-slate-50'
                              }`}
                            >
                              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                                itemOn ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30' : 'bg-slate-100 text-slate-500 group-hover/i:bg-emerald-100 group-hover/i:text-emerald-700'
                              }`}>
                                <n.icon className="h-3.5 w-3.5" />
                              </span>
                              <span className="min-w-0">
                                <span className={`block whitespace-nowrap text-[12.5px] font-semibold ${itemOn ? 'text-emerald-800' : 'text-slate-800'}`}>{n.label}</span>
                                <span className="block whitespace-nowrap text-[10.5px] leading-tight text-slate-400">{n.desc}</span>
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </nav>

          {/* Right — quick search + user */}
          <div className="ml-auto flex shrink-0 items-center gap-2 self-center pl-2">
            <button
              onClick={() => setQuickOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200 md:flex"
              title="Quick search (Ctrl+K)"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="text-[12.5px]">Search…</span>
              <kbd className="rounded border border-white/10 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">⌘K</kbd>
            </button>
            <button
              onClick={() => setQuickOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white md:hidden"
              title="Search"
            >
              <Search className="h-4 w-4" />
            </button>
            {/* User chip + menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenu((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-2.5 transition-colors hover:bg-white/10"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-500 text-[10px] font-bold text-white">
                  {initials}
                </span>
                <span className="hidden max-w-[130px] truncate text-[12.5px] font-semibold text-slate-200 lg:block">{user.name}</span>
                <ChevronDown className={`h-3 w-3 text-slate-500 transition-transform ${userMenu ? 'rotate-180' : ''}`} />
              </button>
              {userMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} />
                  <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/25">
                    <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-500 text-[13px] font-bold text-white">
                        {initials}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-slate-900">{user.name}</span>
                        <span className="mt-0.5 inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9.5px] font-bold text-emerald-700">
                          {user.role.replaceAll('_', ' ')}
                        </span>
                      </span>
                    </div>
                    {user.role !== 'MEGA_ADMIN' && user.profile?.businessName && (
                      <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] font-medium text-slate-600">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{user.profile.businessName}</span>
                      </div>
                    )}
                    <div className="my-1.5 h-px bg-slate-100" />
                    <button
                      onClick={doLogout}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ============ BREADCRUMB STRIP ============ */}
      <div className="z-30 flex h-11 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 sm:px-5">
        <nav className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
          <Link href={VIEW_PATH[activeModule.items[0].key as NavKey]} onClick={guardNavClick(activeModule.items[0].key)} className="font-medium text-slate-500 transition-colors hover:text-emerald-700">
            {activeModule.name}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
          <span className="truncate font-semibold text-slate-900">{activeItem?.label ?? (activeView === 'purchase-entry' ? 'Purchase Entry' : 'Dashboard')}</span>
        </nav>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-500 md:inline-flex">
          <Calendar className="h-3.5 w-3.5 text-slate-400" />
          {new Date().toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>

      {/* ============ SUB-NAV CHIPS — sirf <lg (mega-dropdown hover-based hai) ============ */}
      <div className="z-20 flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden [&::-webkit-scrollbar]:h-0">
        {activeModule.items.map((n) => {
          const on = n.key === highlightView
          return (
            <Link
              key={n.key}
              href={VIEW_PATH[n.key as NavKey]}
              onClick={guardNavClick(n.key)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
                on ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/30' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              <n.icon className="h-3.5 w-3.5" />
              {n.label}
            </Link>
          )
        })}
      </div>

      {/* ============ MAIN — page scroll nahi, har view apna internal layout manage karta hai ============ */}
      <main className="mx-auto w-full max-w-[1500px] flex-1 min-h-0 overflow-hidden px-3 py-3 sm:px-5">
        {children}
      </main>

      {/* ⌘K QuickNav dialog */}
      <QuickNav open={quickOpen} onOpenChange={setQuickOpen} items={quickItems} onNavigate={quickNavigate} />
    </div>
  )
}
