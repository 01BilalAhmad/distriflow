'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtNum } from '@/lib/dms-api'
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp, Percent, ShoppingCart, Receipt } from 'lucide-react'

interface ReportsData {
  summary: { totalSales: number; totalDiscount: number; totalOrders: number; avgOrderValue: number }
  monthlyTrend: { month: string; sales: number }[]
  channelBreakdown: { channel: string; value: number }[]
  topOutlets: { name: string; value: number }[]
  brandPerf: { name: string; value: number }[]
  cityPerf: { city: string; value: number }[]
}

const COLORS = ['#059669', '#10b981', '#34d399', '#6ee7b7', '#f59e0b', '#a7f3d0']

export function ReportsView() {
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
    <div className="h-full overflow-y-auto pr-1">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Reports & Analytics</h2>
        <p className="text-sm text-slate-500">Business insights — sales, channels, brands aur outlets ki performance</p>
      </div>

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
