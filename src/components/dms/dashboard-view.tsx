'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtNum } from '@/lib/dms-api'
import { fmtQty } from '@/components/dms/unit-qty'
import type { DashboardData } from '@/lib/dms-types'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  TrendingUp, ShoppingCart, Store, Package, AlertTriangle, Truck,
  MapPin, Wallet, BadgeCheck, Boxes,
} from 'lucide-react'

const PIE_COLORS = ['#059669', '#10b981', '#34d399', '#6ee7b7', '#f59e0b']

export function DashboardView() {
  const user = useDMS((s) => s.user)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let active = true
    api<DashboardData>(`/api/dashboard?userId=${user.id}`)
      .then((d) => { if (active) { setData(d); setLoading(false) } })
      .catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user])

  if (loading || !data) {
    return (
      <div className="h-full overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    )
  }

  const k = data.kpis
  const kpiCards = [
    { title: "Aaj ki Sales", value: fmtPKR(k.todaySales), sub: `${k.todayOrders} orders aaj`, icon: TrendingUp, color: 'text-emerald-600 bg-emerald-100' },
    { title: 'Month Sales', value: fmtPKR(k.monthSales), sub: 'Month-to-date', icon: Wallet, color: 'text-teal-600 bg-teal-100' },
    { title: 'Active Outlets', value: fmtNum(k.activeOutlets), sub: 'Retailers being served', icon: Store, color: 'text-cyan-600 bg-cyan-100' },
    { title: 'Stock Value', value: fmtPKR(k.stockValue), sub: `${k.lowStockItems} low stock items`, icon: Package, color: 'text-amber-600 bg-amber-100' },
  ]

  return (
    <div className="space-y-5">
      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((c) => (
          <Card key={c.title} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">{c.title}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{c.value}</p>
                <p className="text-xs text-slate-400 mt-1">{c.sub}</p>
              </div>
              <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Action alerts */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/orders" className="text-left rounded-xl border border-blue-100 bg-blue-50/60 p-4 hover:border-blue-300 transition-colors">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-blue-600" />
            <p className="text-sm font-semibold text-blue-800">{k.pendingOrders} Orders Pending Delivery</p>
          </div>
          <p className="text-xs text-blue-600 mt-1">Deliver karne ke liye Orders module mein jayein</p>
        </Link>
        <Link href="/returns" className="text-left rounded-xl border border-amber-100 bg-amber-50/60 p-4 hover:border-amber-300 transition-colors">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">{k.pendingReturns} Returns + {k.pendingClaims} Claims Pending</p>
          </div>
          <p className="text-xs text-amber-600 mt-1">Approvals pending hain — review karein</p>
        </Link>
        <Link href="/pjp" className="text-left rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 hover:border-emerald-300 transition-colors">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold text-emerald-800">{k.salesmenOnField} Salesmen on Field</p>
          </div>
          <p className="text-xs text-emerald-600 mt-1">Live PJP tracking — Field Force mein dekhein</p>
        </Link>
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Sales Trend — Last 14 Days</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.salesTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => Math.round(v).toLocaleString('en-US')} />
                <Tooltip formatter={(v) => [fmtPKR(Number(v)), 'Sales']} labelStyle={{ fontWeight: 600 }} contentStyle={{ borderRadius: 10, border: '1px solid #d1fae5' }} />
                <Area type="monotone" dataKey="sales" stroke="#059669" strokeWidth={2.5} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Channel Mix — This Month</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {data.channelMix.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.channelMix} dataKey="value" nameKey="channel" innerRadius={55} outerRadius={85} paddingAngle={3}>
                    {data.channelMix.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtPKR(Number(v))} contentStyle={{ borderRadius: 10, border: '1px solid #d1fae5' }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Top Products — 30 Days</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topProducts} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v, n) => [n === 'value' ? fmtPKR(Number(v)) : v, n === 'value' ? 'Value' : 'Qty (pcs)']} contentStyle={{ borderRadius: 10, border: '1px solid #d1fae5', fontSize: 12 }} />
                <Bar dataKey="value" fill="#10b981" radius={[0, 6, 6, 0]} barSize={16} name="value" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Low Stock Alerts</CardTitle>
            <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50">FIFO/FEFO</Badge>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-60 overflow-y-auto">
            {data.lowStock.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Sab stock levels theek hain ✓</p>}
            {data.lowStock.map((l, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{l.product}</p>
                  <p className="text-xs text-slate-400">{l.warehouse}</p>
                </div>
                <Badge variant="outline" className={l.qty < 10 ? 'border-red-200 text-red-600 bg-red-50' : 'border-amber-200 text-amber-600 bg-amber-50'}>
                  {fmtQty(l.qty, l.unitsPerCarton)}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-600" /> Aaj ka PJP Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.pjpToday.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Aaj koi journey plan nahi</p>}
            {data.pjpToday.map((p, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-slate-800">{p.salesman}</p>
                  <span className="text-xs text-slate-500">{p.completed}/{p.total} visits</span>
                </div>
                <Progress value={p.total ? (p.completed / p.total) * 100 : 0} className="h-2" />
                <div className="flex items-center justify-between mt-1">
                  <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 border-0">{p.status.replaceAll('_', ' ')}</Badge>
                </div>
              </div>
            ))}
            {data.distributorPerf.length > 0 && data.distributorPerf[0].name && (
              <div className="pt-2 border-t mt-2">
                <p className="text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1"><Boxes className="h-3 w-3" /> NETWORK (This Month)</p>
                {data.distributorPerf.slice(0, 3).map((d, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-xs text-slate-600 truncate">{d.name}</span>
                    <span className="text-xs font-semibold text-emerald-700">{fmtPKR(d.sales)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
