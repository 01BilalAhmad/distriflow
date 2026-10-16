'use client'

// ============================================================
// Task 66 — REPORTS & ANALYTICS — 11 REPORTS MODULE
// Pehle sirf ek basic analytics page tha — ab poora reports suite:
//   1. Overview (charts — pehle wala analytics)
//   2. Sales & Profit (product/booker/company breakdown, COGS, scheme claim)
//   3. Zero Purchase (month-wise — har shop ko mahine 1 bill lazmi)
//   4. Tax (GST + WHT 236H filer/non-filer + FBR annex print)
//   5. Recovery (outstanding + collection history)
//   6. Targets (booker/brand vs achievement)
//   7. Stock (value + low + slow-moving + expiring)
//   8. Booker Performance (productivity + wasooli)
//   9. Company Purchases & Payables
//  10. Returns & Claims (loss control)
//  11. Top Shops (ABC Pareto)
// Har report: date range + booker/company filters, KPIs, detailed table,
// CSV download aur print (distributor header ke sath).
// ============================================================

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtNum } from '@/lib/dms-api'
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import {
  BarChart3, TrendingUp, Percent, ShoppingCart, Receipt, HandCoins, Target,
  Boxes, Users, Building2, Undo2, Store,
} from 'lucide-react'
import { SalesProfitTab } from './reports/sales-profit-tab'
import { ZeroPurchaseTab } from './reports/zero-purchase-tab'
import { TaxTab } from './reports/tax-tab'
import { RecoveryTab } from './reports/recovery-tab'
import { TargetsTab } from './reports/targets-tab'
import { StockTab } from './reports/stock-tab'
import { BookerPerformanceTab } from './reports/booker-performance-tab'
import { CompanyPurchaseTab } from './reports/company-purchase-tab'
import { ReturnsClaimsTab } from './reports/returns-claims-tab'
import { TopShopsTab } from './reports/top-shops-tab'

const COLORS = ['#059669', '#10b981', '#34d399', '#6ee7b7', '#f59e0b', '#a7f3d0']

const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'sales-profit', label: 'Sales & Profit', icon: TrendingUp },
  { key: 'zero-purchase', label: 'Zero Purchase', icon: ShoppingCart },
  { key: 'tax', label: 'Tax (GST/WHT)', icon: Receipt },
  { key: 'recovery', label: 'Recovery', icon: HandCoins },
  { key: 'targets', label: 'Targets', icon: Target },
  { key: 'stock', label: 'Stock', icon: Boxes },
  { key: 'booker-perf', label: 'Booker Perf', icon: Users },
  { key: 'company-purchase', label: 'Purchases', icon: Building2 },
  { key: 'returns-claims', label: 'Returns', icon: Undo2 },
  { key: 'top-shops', label: 'Top Shops', icon: Store },
] as const

type TabKey = (typeof TABS)[number]['key']

export function ReportsView() {
  const [tab, setTab] = useState<TabKey>('overview')

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="shrink-0">
        <h2 className="text-xl font-bold text-slate-900">Reports & Analytics</h2>
        <p className="text-sm text-slate-500">Business ka poora hisaab — 11 detailed reports, filters ke sath</p>
      </div>

      {/* Report tabs — scrollable pill row */}
      <div className="shrink-0 overflow-x-auto pb-0.5 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-100">
        <div className="flex w-max gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                tab === t.key
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-md shadow-emerald-600/25'
                  : 'border border-slate-200 bg-white text-slate-500 hover:border-emerald-200 hover:text-emerald-700'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active report — internal scroll */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'sales-profit' && <SalesProfitTab />}
        {tab === 'zero-purchase' && <ZeroPurchaseTab />}
        {tab === 'tax' && <TaxTab />}
        {tab === 'recovery' && <RecoveryTab />}
        {tab === 'targets' && <TargetsTab />}
        {tab === 'stock' && <StockTab />}
        {tab === 'booker-perf' && <BookerPerformanceTab />}
        {tab === 'company-purchase' && <CompanyPurchaseTab />}
        {tab === 'returns-claims' && <ReturnsClaimsTab />}
        {tab === 'top-shops' && <TopShopsTab />}
      </div>
    </div>
  )
}

// ============================================================
// OVERVIEW TAB — pehle wala analytics dashboard (charts)
// ============================================================
interface ReportsData {
  summary: { totalSales: number; totalDiscount: number; totalOrders: number; avgOrderValue: number }
  monthlyTrend: { month: string; sales: number }[]
  channelBreakdown: { channel: string; value: number }[]
  topOutlets: { name: string; value: number }[]
  brandPerf: { name: string; value: number }[]
  cityPerf: { city: string; value: number }[]
}

function OverviewTab() {
  const user = useDMS((s) => s.user)
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    api<ReportsData>(`/api/reports?userId=${user.id}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user])

  if (loading || !data) return <div className="space-y-4"><Skeleton className="h-24 rounded-xl" /><div className="grid gap-4 lg:grid-cols-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}</div></div>

  const s = data.summary
  const cards = [
    { t: 'Total Sales (6 mo)', v: fmtPKR(s.totalSales), i: TrendingUp },
    { t: 'Total Orders', v: fmtNum(s.totalOrders), i: ShoppingCart },
    { t: 'Scheme Discounts', v: fmtPKR(s.totalDiscount), i: Percent },
    { t: 'Avg Order Value', v: fmtPKR(s.avgOrderValue), i: Receipt },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.t} className="border-slate-200 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 font-medium">{c.t}</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">{c.v}</p>
                </div>
                <c.i className="h-8 w-8 text-emerald-600 bg-emerald-100 rounded-lg p-1.5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base">Monthly Sales Trend</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(v) => Math.round(Number(v)).toLocaleString('en-US')} />
                <Tooltip formatter={(v) => [fmtPKR(Number(v)), 'Sales']} contentStyle={{ borderRadius: 10, border: '1px solid #d1fae5' }} />
                <Line type="monotone" dataKey="sales" stroke="#059669" strokeWidth={2.5} dot={{ fill: '#059669', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base">Channel-wise Sales</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.channelBreakdown} dataKey="value" nameKey="channel" outerRadius={90} label={(e: { channel?: string; percent?: number }) => `${e.channel} ${((e.percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                  {data.channelBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtPKR(Number(v))} contentStyle={{ borderRadius: 10, border: '1px solid #d1fae5' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base">Top Outlets by Sales</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topOutlets} layout="vertical" margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => fmtPKR(Number(v))} contentStyle={{ borderRadius: 10, border: '1px solid #d1fae5', fontSize: 12 }} />
                <Bar dataKey="value" fill="#10b981" radius={[0, 6, 6, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base">Brand Performance</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.brandPerf}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => Math.round(v).toLocaleString('en-US')} />
                <Tooltip formatter={(v) => [fmtPKR(Number(v)), 'Sales']} contentStyle={{ borderRadius: 10, border: '1px solid #d1fae5' }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={34}>
                  {data.brandPerf.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
