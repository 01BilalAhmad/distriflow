'use client'

// ============================================================
// Task 134 — DASHBOARD v2 (Ops Dense redesign — selected mockup C)
// 8 KPI tiles + status sub-bar + Sales-vs-Recovery combo + Aging
// 30-60-90 + Order Booker matrix + Top Overdue / Pending / No-Visit
// panels + Day Book footer. Compact ERP look: white cards, hairline
// borders, 11px uppercase section headers, tabular numbers.
// ============================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Skeleton } from '@/components/ui/skeleton'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR } from '@/lib/dms-api'
import type { DashboardData } from '@/lib/dms-types'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

const C = {
  blue: '#1d4ed8', green: '#15803d', amber: '#b45309', red: '#b91c1c',
  ink: '#151a26', mut: '#586073', line: '#e2e5ec', hair: '#edf0f5',
}

/** compact paisa — Rs 8.42M style (>=10 lakh par), warna full fmtPKR */
function fmtM(v: number): string {
  if (Math.abs(v) >= 1e6) {
    const m = (v / 1e6).toFixed(2).replace(/\.?0+$/, '')
    return `Rs ${m}M`
  }
  return fmtPKR(v)
}
const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`)

/** trend triangle — improving (green down) / worsening (red up) / flat (dash) */
function TrendArrow({ now, prev }: { now: number; prev: number }) {
  if (Math.abs(now - prev) < 0.005) return <span className="text-[10px] text-slate-400">—</span>
  const improving = now < prev
  return improving ? (
    <svg aria-label="improving" width="10" height="10" viewBox="0 0 10 10" className="inline">
      <path d="M5 8.8.8 1.6h8.4Z" fill={C.green} />
    </svg>
  ) : (
    <svg aria-label="worsening" width="10" height="10" viewBox="0 0 10 10" className="inline">
      <path d="M5 1.2 9.2 8.4H.8Z" fill={C.red} />
    </svg>
  )
}

function DaysBadge({ days }: { days: number | null }) {
  const cls = days == null
    ? 'bg-slate-100 text-slate-500'
    : days > 60
      ? 'bg-red-50 text-red-700'
      : days > 30
        ? 'bg-amber-50 text-amber-700'
        : 'bg-emerald-50 text-emerald-700'
  return <span className={`inline-block rounded-full px-2 py-[1px] text-[10.5px] font-bold ${cls}`}>{days == null ? '—' : `${days}d`}</span>
}

function CardHead({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-b px-3 py-2" style={{ borderColor: C.hair }}>
      <span className="flex text-slate-400">{icon}</span>
      <h2 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#3f4757' }}>{title}</h2>
      {right && <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">{right}</div>}
    </div>
  )
}

// chhote stroke icons (lucide paths, 14px)
const I = {
  trend: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17.5 9 11l4 4 8-8.5" /><path d="M15.5 6.5H21V12" /></svg>,
  layers: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5 21 8l-9 4.5L3 8z" /><path d="M4.5 12.2 12 16l7.5-3.8" /><path d="M4.5 16.2 12 20l7.5-3.8" /></svg>,
  team: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8.2" r="3.4" /><path d="M3.2 19.5c.6-3.6 2.8-5.5 5.8-5.5s5.2 1.9 5.8 5.5" /><circle cx="17" cy="9.4" r="2.6" /><path d="M16.4 14.2c2.3.4 3.8 2 4.3 4.8" /></svg>,
  alert: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5 21 19.5H3z" /><path d="M12 10v4.2" /><path d="M12 17.2h.01" /></svg>,
  check: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M8.3 12.4l2.5 2.5 4.9-5.2" /></svg>,
  pin: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-6.5-5.4-6.5-10.2a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21z" /><circle cx="12" cy="10.6" r="2.3" /></svg>,
  book: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
  cash: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6.5" width="19" height="11" rx="1.5" /><circle cx="12" cy="12" r="2.6" /><path d="M5.8 9.8h.01" /><path d="M18.2 14.2h.01" /></svg>,
  doc: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.5h6.5L18 8v12.5H7z" /><path d="M13.5 3.5V8H18" /><path d="M9.8 12.5h4.4" /><path d="M9.8 15.8h4.4" /></svg>,
  undo: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 9.5h10a5 5 0 1 1 0 10H9" /><path d="M8 5.5 4.5 9.5 8 13.5" /></svg>,
}

export function DashboardView() {
  const user = useDMS((s) => s.user)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let active = true
    api<DashboardData>('/api/dashboard')
      .then((d) => { if (active) { setData(d); setLoading(false) } })
      .catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user])

  if (loading || !data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-[74px] rounded-lg" />)}
        </div>
        <Skeleton className="h-10 rounded-lg" />
        <div className="grid gap-3 lg:grid-cols-12">
          <Skeleton className="h-[420px] rounded-lg lg:col-span-7" />
          <Skeleton className="h-[420px] rounded-lg lg:col-span-5" />
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  }

  const k = data.kpis
  const bestSales = Math.max(...data.bookers.map((b) => b.sales), 0)
  const bestFill = Math.max(...data.bookers.map((b) => b.fillPct), 0)
  const OVERDUE_TINT = 400000
  const agingColors: Record<string, string> = { '0-30': C.blue, '31-60': C.amber, '61-90': '#ea580c', '90+': C.red }
  const agingTotal = Math.max(1, data.aging.total)

  const tiles: { label: string; value: React.ReactNode; sub: React.ReactNode }[] = [
    {
      label: 'Aaj ki Sales', value: fmtPKR(k.todaySales),
      sub: k.salesDeltaPct == null
        ? <span className="text-slate-400">vs yesterday —</span>
        : <span className={k.salesDeltaPct >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-red-700'}>
            {k.salesDeltaPct >= 0 ? '▲' : '▼'} {pct(k.salesDeltaPct)} <span className="font-normal text-slate-400">vs kal</span>
          </span>,
    },
    { label: 'Recovery Today', value: fmtPKR(k.recoveryToday), sub: <span>{k.recoveryCount} receipts (Wasooli)</span> },
    { label: 'Month Sales (MTD)', value: fmtM(k.monthSales), sub: <span>Month-to-date</span> },
    {
      label: 'Total Udhaar', value: fmtM(k.totalUdhaar),
      sub: <span>{k.udhaarShops} shops <span className="mx-0.5 text-slate-300">·</span>
        {k.udhaarDeltaPct == null
          ? <span className="text-slate-400">week —</span>
          : <span className={k.udhaarDeltaPct <= 0 ? 'font-bold text-emerald-700' : 'font-bold text-red-700'}>
              {k.udhaarDeltaPct <= 0 ? '▼' : '▲'} {pct(k.udhaarDeltaPct)} week
            </span>}
      </span>,
    },
    { label: 'Overdue 31+', value: fmtM(k.overdue31), sub: <span className="text-amber-700">{k.overdue31Shops} shops</span> },
    { label: 'Stock Value', value: fmtM(k.stockValue), sub: <span className="text-amber-700">{k.lowStockItems} low stock</span> },
    {
      label: 'PJP Today', value: <>{k.pjpDone}/{k.pjpTotal} <small className="text-[12px] font-semibold text-slate-500">({k.pjpTotal ? Math.round((k.pjpDone / k.pjpTotal) * 100) : 0}%)</small></>,
      sub: <span>{k.salesmenOnField} on field</span>,
    },
    { label: 'Avg Order Value', value: fmtPKR(k.avgOrderValue), sub: <span>{k.todayOrders} orders</span> },
  ]

  return (
    <div className="space-y-3 text-[13px]" style={{ color: C.ink, fontVariantNumeric: 'tabular-nums' }}>
      {/* ============ KPI STRIP ============ */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8" aria-label="Key KPIs">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border bg-white p-3 shadow-sm" style={{ borderColor: C.line }}>
            <div className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-slate-500">{t.label}</div>
            <div className="mt-1 whitespace-nowrap text-[18px] font-bold leading-tight tracking-tight">{t.value}</div>
            <div className="mt-0.5 whitespace-nowrap text-[11px] text-slate-500">{t.sub}</div>
          </div>
        ))}
      </section>

      {/* ============ STATUS SUB BAR ============ */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-white px-3.5 py-2 text-xs shadow-sm" style={{ borderColor: C.line }}>
        <span className="flex text-emerald-600">{I.check}</span>
        <span className="text-slate-600">Order Fill Rate <b className="text-slate-900">{k.fillRate}%</b></span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-600">
          Pending: <Link href="/orders" className="font-bold text-blue-700 hover:underline">{k.pendingOrders} orders</Link>,
          <Link href="/recovery" className="font-bold text-blue-700 hover:underline"> {k.pendingRecovery} recovery requests</Link>,
          <Link href="/returns" className="font-bold text-blue-700 hover:underline"> {k.pendingReturns + k.pendingClaims} returns + claims</Link>
        </span>
        <span className="ml-auto text-[11.5px] text-slate-500">Aaj ka PJP Status · <b className="text-slate-700">{k.salesmenOnField} on field</b></span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* ============ SALES & RECOVERY — 14 DAYS ============ */}
        <section className="rounded-lg border bg-white shadow-sm lg:col-span-7" style={{ borderColor: C.line }}>
          <CardHead icon={I.trend} title="Sales & Recovery — Last 14 Days" right={<span>Daily · 22 Oct – aaj</span>} />
          <div className="p-3">
            <div className="h-[248px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.trend14} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke="#e6eaf1" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8a93a6' }} tickLine={false} axisLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 10, fill: '#8a93a6' }} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : String(v))} />
                  <Tooltip
                    formatter={(v, n) => [fmtPKR(Number(v)), n === 'sales' ? 'Sales' : 'Recovery (Wasooli)']}
                    labelStyle={{ fontWeight: 700 }}
                    contentStyle={{ borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12 }} />
                  <Bar dataKey="sales" fill={C.blue} radius={[3, 3, 0, 0]} maxBarSize={26} name="sales" />
                  <Line dataKey="recovery" stroke={C.green} strokeWidth={2.2} dot={{ r: 2.2, fill: C.green, strokeWidth: 0 }} name="recovery" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <table className="mt-2 w-full border-collapse">
              <thead>
                <tr>
                  <th className="border-b px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500" style={{ borderColor: C.line }}>Date</th>
                  <th className="border-b px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500" style={{ borderColor: C.line }}>
                    <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: C.blue }} />Sales
                  </th>
                  <th className="border-b px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500" style={{ borderColor: C.line }}>
                    <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: C.green }} />Recovery
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.mini5.map((d) => (
                  <tr key={d.date} className={d.today ? 'bg-blue-50/70' : ''}>
                    <td className={`border-b px-2 py-1.5 text-[12px] ${d.today ? 'font-bold text-blue-700' : 'text-slate-600'}`} style={{ borderColor: C.hair }}>{d.date}</td>
                    <td className={`border-b px-2 py-1.5 text-right text-[12px] ${d.today ? 'font-bold' : ''}`} style={{ borderColor: C.hair }}>{fmtPKR(d.sales)}</td>
                    <td className={`border-b px-2 py-1.5 text-right text-[12px] ${d.today ? 'font-bold' : ''}`} style={{ borderColor: C.hair }}>{fmtPKR(d.recovery)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ============ RECEIVABLE AGING 30-60-90 ============ */}
        <section className="rounded-lg border bg-white shadow-sm lg:col-span-5" style={{ borderColor: C.line }}>
          <CardHead icon={I.layers} title="Receivable Aging · 30-60-90"
            right={<>
              <TrendArrow now={-1} prev={0} /><span>improving</span>
              <TrendArrow now={1} prev={0} /><span>worsening</span>
            </>} />
          <div className="p-3">
            <div className="flex h-2.5 overflow-hidden rounded" role="img" aria-label="Aging distribution bar">
              {data.aging.buckets.map((b) => (
                <div key={b.bucket} style={{ width: `${(b.amount / agingTotal) * 100}%`, background: agingColors[b.bucket] }} />
              ))}
            </div>
            <table className="mt-3 w-full border-collapse">
              <thead>
                <tr>
                  <th className="border-b px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500" style={{ borderColor: C.line }}>Bucket</th>
                  <th className="border-b px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500" style={{ borderColor: C.line }}>Amount</th>
                  <th className="border-b px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500" style={{ borderColor: C.line }}>% of total</th>
                  <th className="border-b px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500" style={{ borderColor: C.line }}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.aging.buckets.map((b) => (
                  <tr key={b.bucket}>
                    <td className="border-b px-2 py-2 text-[12.5px]" style={{ borderColor: C.hair }}>
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: agingColors[b.bucket] }} />{b.bucket} days
                    </td>
                    <td className="border-b px-2 py-2 text-right text-[12.5px] font-semibold" style={{ borderColor: C.hair }}>{fmtM(b.amount)}</td>
                    <td className="border-b px-2 py-2 text-right text-[12.5px] text-slate-600" style={{ borderColor: C.hair }}>{Math.round((b.amount / agingTotal) * 100)}%</td>
                    <td className="border-b px-2 py-2 text-right" style={{ borderColor: C.hair }}><TrendArrow now={b.amount} prev={b.prev} /></td>
                  </tr>
                ))}
                <tr>
                  <td className="bg-slate-100 px-2 py-2 text-[12.5px] font-bold">TOTAL</td>
                  <td className="bg-slate-100 px-2 py-2 text-right text-[12.5px] font-bold">{fmtM(data.aging.total)}</td>
                  <td className="bg-slate-100 px-2 py-2" />
                  <td className="bg-slate-100 px-2 py-2" />
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-500">Total udhaar (receivables) · {data.aging.shops} shops · FIFO method — Aging report se match</p>
          </div>
        </section>

        {/* ============ ORDER BOOKER PERFORMANCE MATRIX ============ */}
        <section className="rounded-lg border bg-white shadow-sm lg:col-span-12" style={{ borderColor: C.line }}>
          <CardHead icon={I.team} title="Order Booker Performance — 30 Days"
            right={<>
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-100" /><span>best sales / fill %</span>
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-100" /><span>overdue &gt; Rs 4 lac</span>
            </>} />
          <div className="overflow-x-auto p-1">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr>
                  <th className="px-2.5 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Order Booker</th>
                  <th className="px-2.5 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Outlets</th>
                  <th className="px-2.5 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Orders</th>
                  <th className="px-2.5 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Sales</th>
                  <th className="px-2.5 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Recovery</th>
                  <th className="px-2.5 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Fill %</th>
                  <th className="px-2.5 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">PJP %</th>
                  <th className="px-2.5 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Overdue Carried</th>
                </tr>
              </thead>
              <tbody>
                {data.bookers.length === 0 && (
                  <tr><td colSpan={8} className="px-2.5 py-6 text-center text-slate-400">Abhi koi order booker add nahi hua</td></tr>
                )}
                {data.bookers.map((b) => (
                  <tr key={b.bookerId} className="odd:bg-[#f8fafc]">
                    <td className="px-2.5 py-1.5 font-semibold">{b.name}</td>
                    <td className="px-2.5 py-1.5 text-right">{b.outlets}</td>
                    <td className="px-2.5 py-1.5 text-right">{b.orders}</td>
                    <td className={`px-2.5 py-1.5 text-right font-semibold ${b.sales > 0 && b.sales === bestSales ? 'bg-emerald-50 font-bold text-emerald-700' : ''}`}>{fmtM(b.sales)}</td>
                    <td className="px-2.5 py-1.5 text-right">{fmtM(b.recovery)}</td>
                    <td className={`px-2.5 py-1.5 text-right ${b.fillPct > 0 && b.fillPct === bestFill ? 'bg-emerald-50 font-bold text-emerald-700' : ''}`}>{b.fillPct}%</td>
                    <td className="px-2.5 py-1.5 text-right">{b.pjpPct == null ? '—' : `${b.pjpPct}%`}</td>
                    <td className={`px-2.5 py-1.5 text-right ${b.overdue > OVERDUE_TINT ? 'bg-red-50 font-bold text-red-700' : ''}`}>{fmtM(b.overdue)}</td>
                  </tr>
                ))}
                {data.bookers.length > 0 && (
                  <tr>
                    <td className="bg-slate-100 px-2.5 py-1.5 font-bold">TOTAL</td>
                    <td className="bg-slate-100 px-2.5 py-1.5 text-right font-bold">{data.bookerTotals.outlets}</td>
                    <td className="bg-slate-100 px-2.5 py-1.5 text-right font-bold">{data.bookerTotals.orders}</td>
                    <td className="bg-slate-100 px-2.5 py-1.5 text-right font-bold">{fmtM(data.bookerTotals.sales)}</td>
                    <td className="bg-slate-100 px-2.5 py-1.5 text-right font-bold">{fmtM(data.bookerTotals.recovery)}</td>
                    <td className="bg-slate-100 px-2.5 py-1.5 text-right font-bold">{data.bookerTotals.fillPct}%</td>
                    <td className="bg-slate-100 px-2.5 py-1.5 text-right font-bold">{data.bookerTotals.pjpPct == null ? '—' : `${data.bookerTotals.pjpPct}%`}</td>
                    <td className="bg-slate-100 px-2.5 py-1.5 text-right font-bold">{fmtM(data.bookerTotals.overdue)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ============ TOP OVERDUE SHOPS ============ */}
        <section className="rounded-lg border bg-white shadow-sm lg:col-span-4" style={{ borderColor: C.line }}>
          <CardHead icon={I.alert} title="Top Overdue Shops" right={<Link href="/ledgers" className="font-bold text-blue-700 hover:underline">Shop Ledgers →</Link>} />
          <div className="p-1">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Shop</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Zone</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Amount</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Days</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Last Pay</th>
                </tr>
              </thead>
              <tbody>
                {data.topOverdue.length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-6 text-center text-slate-400">Koi udhaar baqi nahi — sab shops settle hen ✓</td></tr>
                )}
                {data.topOverdue.map((r) => (
                  <tr key={r.shop}>
                    <td className="px-2 py-1.5 text-[12px] font-semibold">{r.shop}</td>
                    <td className="px-2 py-1.5 text-[12px] text-slate-500">{r.zone}</td>
                    <td className="px-2 py-1.5 text-right text-[12px] font-semibold">{fmtPKR(r.amount)}</td>
                    <td className="px-2 py-1.5 text-right"><DaysBadge days={r.days} /></td>
                    <td className="px-2 py-1.5 text-right text-[12px] text-slate-500">{r.lastPay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ============ PENDING APPROVALS ============ */}
        <section className="rounded-lg border bg-white shadow-sm lg:col-span-4" style={{ borderColor: C.line }}>
          <CardHead icon={I.check} title="Pending Approvals" />
          <div className="p-3">
            {[
              { label: 'Recovery (Wasooli) requests', count: k.pendingRecovery, href: '/recovery', icon: I.cash },
              { label: 'Orders', count: k.pendingOrders, href: '/orders', icon: I.doc },
              { label: 'Returns + claims', count: k.pendingReturns + k.pendingClaims, href: '/returns', icon: I.undo },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2.5 border-b py-2.5 last:border-0" style={{ borderColor: C.hair }}>
                <span className="flex text-slate-400">{row.icon}</span>
                <b className="text-[12.5px] font-semibold">{row.label}</b>
                <span className="rounded-full bg-blue-50 px-2 py-[1px] text-[11px] font-bold text-blue-700">{row.count}</span>
                <Link href={row.href} className="ml-auto rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100">
                  Review →
                </Link>
              </div>
            ))}
            <p className="mt-2 text-[11px] text-slate-500">Approve/Reject module ke andar hota hai — review queue kholti hai</p>
          </div>
        </section>

        {/* ============ NO VISIT 7+ DAYS ============ */}
        <section className="rounded-lg border bg-white shadow-sm lg:col-span-4" style={{ borderColor: C.line }}>
          <CardHead icon={I.pin} title="No Visit — 7+ Days" right={<Link href="/pjp" className="font-bold text-blue-700 hover:underline">PJP →</Link>} />
          <div className="p-3">
            {data.noVisit.length === 0 && <p className="py-6 text-center text-slate-400">Sab shops cover ho rahi hain ✓</p>}
            {data.noVisit.map((r) => (
              <div key={r.shop} className="flex items-center gap-2 border-b py-2 last:border-0" style={{ borderColor: C.hair }}>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[12.5px] font-semibold">{r.shop}</b>
                  <span className="text-[11px] text-slate-500">{r.zone}</span>
                </div>
                <span className="whitespace-nowrap text-[11.5px] text-slate-500">{r.booker}</span>
                <DaysBadge days={r.days} />
              </div>
            ))}
          </div>
        </section>

        {/* ============ DAY BOOK FOOTER ============ */}
        <section className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-slate-50 px-3.5 py-2.5 font-mono text-xs text-slate-700 lg:col-span-12" style={{ borderColor: C.line }}>
          <span className="flex" style={{ color: C.blue }}>{I.book}</span>
          <b className="text-slate-900">Day Book — Aaj:</b>
          <span>Sales <b>{fmtM(data.daybook.sales)}</b></span><span className="text-slate-400">·</span>
          <span>Recovery <b>{fmtM(data.daybook.recovery)}</b></span><span className="text-slate-400">·</span>
          <span>Cash-In <b>{fmtM(data.daybook.cash)}</b></span><span className="text-slate-400">·</span>
          <span><b>{data.daybook.orders}</b> orders</span><span className="text-slate-400">·</span>
          <span><b>{data.daybook.receipts}</b> receipts</span><span className="text-slate-400">·</span>
          <span><b>{data.daybook.returns}</b> returns/claims</span>
          <Link href="/reports/day-book" className="ml-auto font-sans text-[11px] font-bold text-blue-700 hover:underline">Full Day Book →</Link>
        </section>
      </div>
    </div>
  )
}
