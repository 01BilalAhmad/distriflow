'use client'

// Task 71 — PROFESSIONAL SIDEBAR NAVIGATION (user directive: "Navigation ko side pr kr do,
// upr acha nai lag rha") — Task 70 ka dark top bar ab LEFT SIDEBAR ban gaya hai:
//   1) DARK SIDEBAR (slate-900, w-264px): brand | module-wise grouped nav (sab pages hamesha
//      visible — hover-dropdown ki zaroorat khatam) | neeche user chip + logout
//   2) TOP STRIP (h-12, white): collapse toggle (desktop) / hamburger (mobile) + breadcrumb
//      Module / Page + ⌘K quick search + date chip
//   3) COLLAPSED RAIL (w-72px): sirf icons (title tooltip) — 1366px laptops ko content width
//      milta hai; choice localStorage mein persist hoti hai.
//   4) MOBILE (<lg): sidebar drawer ban kar slide-in hota hai (overlay click / Esc / item
//      click par band). Drawer mein nav hamesha full labels ke sath.
// - Emerald/teal brand wahi (user choice, Task 70 se continuity). Active item = emerald
//   gradient pill + white text; group headers uppercase slate.
// - Task 65-b rule INTACT: har nav item REAL <Link> hai — right-click copy link, middle
//   click new tab, Ctrl/Cmd click sab native browser behavior karta hai.
// - Task 49 rule INTACT: purchase-entry ke adhoore draft par navigation confirm guard.
// - ⌘K / Ctrl+K QuickNav dialog wahi (Task 70) — fuzzy search + keyboard nav + draft guard.
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
  ChevronRight, Search, Calendar, Menu, PanelLeftClose, PanelLeftOpen, X,
} from 'lucide-react'

// group = sidebar section header — items usi order mein neeche aate hain
// desc = QuickNav (⌘K) search ke liye 1-line explanation
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
type NavEntry = { key: string; label: string; icon: typeof LayoutDashboard }
type NavModule = { name: string; icon: typeof LayoutDashboard; items: NavEntry[] }

// Modules (sidebar sections) — upar se neeche yahi order
const MODULES: { name: string; icon: typeof LayoutDashboard }[] = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Sales', icon: ShoppingCart },
  { name: 'Finance', icon: Wallet },
  { name: 'Reports', icon: BarChart3 },
  { name: 'Stock & Catalog', icon: Package },
  { name: 'Field Operations', icon: Route },
  { name: 'Business Network', icon: Network },
]

// Task 71 — sidebar ki grouped list (desktop expanded / collapsed rail / mobile drawer
// teeno isi ek component se render hote hain — markup duplicate nahi hota).
function SidebarNav({ modules, activeKey, collapsed, itemClick }: {
  modules: NavModule[]
  activeKey: string
  collapsed: boolean
  itemClick: (key: string) => (e: React.MouseEvent) => void
}) {
  return (
    <>
      {modules.map((m) => (
        <div key={m.name}>
          {collapsed ? (
            <div className="mx-4 my-2 h-px bg-white/10" aria-hidden />
          ) : (
            <div className="px-2.5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">{m.name}</div>
          )}
          {m.items.map((n) => {
            const on = n.key === activeKey
            if (collapsed) {
              // Icon-only rail — native title tooltip se label milta hai
              return (
                <Link
                  key={n.key}
                  href={VIEW_PATH[n.key as NavKey]}
                  onClick={itemClick(n.key)}
                  title={n.label}
                  className={`mx-auto my-0.5 flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                    on
                      ? 'bg-gradient-to-br from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-600/25'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <n.icon className="h-4 w-4" />
                </Link>
              )
            }
            return (
              <Link
                key={n.key}
                href={VIEW_PATH[n.key as NavKey]}
                onClick={itemClick(n.key)}
                className={`group/i mt-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                  on
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 font-semibold text-white shadow-lg shadow-emerald-600/20'
                    : 'font-medium text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <n.icon className={`h-4 w-4 shrink-0 ${on ? 'text-white' : 'text-slate-500 group-hover/i:text-emerald-300'}`} />
                <span className="min-w-0 flex-1 truncate">{n.label}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </>
  )
}

// Brand block — sidebar/drawer dono use karte hain
function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-500 shadow-lg shadow-emerald-500/25">
        <Package2 className="h-4.5 w-4.5 text-white" />
      </span>
      {!collapsed && (
        <>
          <span className="text-[15px] font-bold tracking-tight text-white">DistriFlow</span>
          <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-emerald-300">ERP</span>
        </>
      )}
    </div>
  )
}

export function DMSApp({ children }: { children: React.ReactNode }) {
  const { user, setUser, purchaseDraftDirty } = useDMS()
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // Task 65: active view URL se — refresh/back/forward sab par sahi section milta hai
  const activeView = viewFromPath(pathname ?? '/')
  // Task 70: purchase-entry full-page form hai — nav highlight uske parent module
  // (Stock & Catalog) par rakhein, warna koi tab active nazar nahi aata.
  const highlightView = activeView === 'purchase-entry' ? 'products' : activeView

  // Task 71: collapsed rail ki choice persist — mount ke baad localStorage se (SSR safe).
  useEffect(() => {
    const saved = localStorage.getItem('dms_sidebar_collapsed') === '1'
    queueMicrotask(() => setCollapsed(saved))
  }, [])

  function toggleCollapsed() {
    setCollapsed((v) => {
      localStorage.setItem('dms_sidebar_collapsed', v ? '0' : '1')
      return !v
    })
  }

  // Drawer Esc par band (mobile)
  useEffect(() => {
    if (!drawerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

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

  // Drawer ke items par: wahi guard + navigation hue to drawer band
  function drawerNavClick(target: string) {
    return (e: React.MouseEvent) => {
      guardNavClick(target)(e)
      if (!e.defaultPrevented) setDrawerOpen(false)
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
  const modules: NavModule[] = MODULES
    .map((m) => ({ ...m, items: nav.filter((n) => n.group === m.name) }))
    .filter((m) => m.items.length > 0)
  const activeModule = modules.find((m) => m.items.some((i) => i.key === highlightView)) ?? modules[0]
  const activeItem = nav.find((n) => n.key === activeView) ?? null
  const initials = user.name.split(' ').map((w) => w[0]).slice(0, 2).join('')

  // Sidebar footer — user chip + logout (collapsed par sirf avatar + icon)
  function sidebarFooter(collapsedMode: boolean) {
    return (
      <div className={`shrink-0 border-t border-white/10 p-2.5 ${collapsedMode ? 'flex flex-col items-center gap-1' : 'flex items-center gap-2.5'}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-500 text-[11px] font-bold text-white">
          {initials}
        </span>
        {!collapsedMode && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-white">{user!.name}</span>
            <span className="block truncate text-[10px] font-medium text-emerald-400/90">{user!.role.replaceAll('_', ' ')}</span>
          </span>
        )}
        <button
          onClick={doLogout}
          title="Logout"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden flex bg-[#f6f8fb]">
      {/* ============ DARK SIDEBAR (desktop ≥lg) ============ */}
      <aside
        className={`df-sidebar hidden h-full shrink-0 flex-col bg-slate-900 transition-[width] duration-200 lg:flex ${collapsed ? 'w-[72px]' : 'w-[264px]'}`}
      >
        <SidebarBrand collapsed={collapsed} />
        <nav aria-label="Main navigation" className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
          <SidebarNav modules={modules} activeKey={highlightView ?? ''} collapsed={collapsed} itemClick={guardNavClick} />
        </nav>
        {sidebarFooter(collapsed)}
      </aside>

      {/* ============ MOBILE DRAWER (<lg) ============ */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="df-overlay absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="df-sidebar df-drawer absolute left-0 top-0 flex h-full w-[280px] flex-col bg-slate-900 shadow-2xl">
            <div className="relative">
              <SidebarBrand collapsed={false} />
              <button
                onClick={() => setDrawerOpen(false)}
                title="Band karein"
                className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav aria-label="Main navigation" className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
              <SidebarNav modules={modules} activeKey={highlightView ?? ''} collapsed={false} itemClick={drawerNavClick} />
            </nav>
            {sidebarFooter(false)}
          </aside>
        </div>
      )}

      {/* ============ RIGHT COLUMN — top strip + page ============ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:px-5">
          {/* Mobile hamburger */}
          <button
            onClick={() => setDrawerOpen(true)}
            title="Menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* Desktop collapse toggle */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Sidebar barhayein' : 'Sidebar chhota karein'}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 lg:flex"
          >
            {collapsed ? <PanelLeftOpen className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
          </button>
          {/* Breadcrumb */}
          <nav className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
            <Link
              href={VIEW_PATH[activeModule.items[0].key as NavKey]}
              onClick={guardNavClick(activeModule.items[0].key)}
              className="font-medium text-slate-500 transition-colors hover:text-emerald-700"
            >
              {activeModule.name}
            </Link>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
            <span className="truncate font-semibold text-slate-900">
              {activeItem?.label ?? (activeView === 'purchase-entry' ? 'Purchase Entry' : 'Dashboard')}
            </span>
          </nav>
          {/* Right — quick search + date */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() => setQuickOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-slate-500 transition-colors hover:border-emerald-300 hover:text-emerald-700 sm:flex"
              title="Quick search (Ctrl+K)"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="text-[12.5px]">Search…</span>
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">⌘K</kbd>
            </button>
            <button
              onClick={() => setQuickOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 sm:hidden"
              title="Search"
            >
              <Search className="h-4 w-4" />
            </button>
            <span className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-500 md:inline-flex">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              {new Date().toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </header>

        {/* ============ MAIN — page scroll nahi, har view apna internal layout manage karta hai ============ */}
        <main className="mx-auto w-full max-w-[1500px] flex-1 min-h-0 overflow-hidden px-3 py-3 sm:px-5">
          {children}
        </main>
      </div>

      {/* ⌘K QuickNav dialog */}
      <QuickNav open={quickOpen} onOpenChange={setQuickOpen} items={quickItems} onNavigate={quickNavigate} />
    </div>
  )
}
