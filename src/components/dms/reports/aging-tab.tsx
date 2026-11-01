'use client'

// Task 131 — RECEIVABLES AGING (30/60/90+) — kis shop ka udhaar kitna purana:
// FIFO buckets 0-30 / 31-60 / 61-90 / 90+ din, oldest unpaid invoice date,
// bucket summary chart (amount + shops). As-of aaj.

import { useState } from 'react'
import { Hourglass } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR } from '@/lib/dms-api'
import {
  FilterBar, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, useFilterOptions, ReportEmptyGate, fmtDay, fmtMoney, type Col,
} from './reports-kit'

interface Row extends Record<string, unknown> {
  shop: string; code: string; city: string; booker: string; creditDays: number
  balance: number; b0_30: number; b31_60: number; b61_90: number; b90plus: number
  oldestUnpaidDate: string | null; oldestDays: number | null; overdue: boolean
}
interface Resp extends Record<string, unknown> {
  summary: { shops: number; totalOutstanding: number; overdueShops: number; risk90Plus: number; risk90PlusShops: number }
  buckets: { bucket: string; amount: number; shops: number }[]
  rows: Row[]
}

const BUCKET_COLORS: Record<string, string> = { '0-30': '#10b981', '31-60': '#f59e0b', '61-90': '#f97316', '90+': '#dc2626' }

export function AgingTab() {
  const { user } = useDMS()
  const [booker, setBooker] = useState('')
  const [city, setCity] = useState('')
  const fopts = useFilterOptions(user?.id)

  const gate = useReportGate<Resp>({
    fetcher: async () => {
      const p = new URLSearchParams({ userId: user!.id })
      if (booker) p.set('bookerId', booker)
      if (city) p.set('city', city)
      return api<Resp>(`/api/reports/aging?${p}`)
    },
    filtersKey: `${booker}|${city}`,
  })
  const { data, loading } = gate

  const cols: Col<Row>[] = [
    { key: 'shop', label: 'Shop', render: (r) => (
      <span>
        <span className="font-semibold text-slate-800">{r.shop}</span>
        {r.overdue && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600">OVERDUE</span>}
      </span>
    ) },
    { key: 'city', label: 'City' },
    { key: 'booker', label: 'Booker' },
    { key: 'creditDays', label: 'Cr Days', align: 'center' },
    { key: 'balance', label: 'Balance', align: 'right', money: true, total: true, cls: 'font-bold text-slate-900' },
    { key: 'b0_30', label: '0-30', align: 'right', money: true, total: true, render: (r) => r.b0_30 > 0 ? fmtMoney(r.b0_30) : '—' },
    { key: 'b31_60', label: '31-60', align: 'right', money: true, total: true, cls: 'text-amber-600', render: (r) => r.b31_60 > 0 ? fmtMoney(r.b31_60) : '—' },
    { key: 'b61_90', label: '61-90', align: 'right', money: true, total: true, cls: 'text-orange-600', render: (r) => r.b61_90 > 0 ? fmtMoney(r.b61_90) : '—' },
    { key: 'b90plus', label: '90+', align: 'right', money: true, total: true, cls: 'font-bold text-red-600', render: (r) => r.b90plus > 0 ? fmtMoney(r.b90plus) : '—' },
    { key: 'oldestUnpaidDate', label: 'Oldest Unpaid', align: 'right', render: (r) => (
      <span>
        {fmtDay(r.oldestUnpaidDate)}
        {r.oldestDays != null && <span className="ml-1 text-[10px] text-slate-400">({r.oldestDays}d)</span>}
      </span>
    ) },
  ]

  return (
    <div className="space-y-3">
      <FilterBar
        booker={booker} setBooker={setBooker} bookers={fopts.bookers}
        city={city} setCity={setCity} cities={fopts.cities}
        onRefresh={gate.load} loading={loading} armed={gate.armed} stale={gate.stale}
      />
      {!gate.armed ? (
        <ReportEmptyGate
          icon={Hourglass}
          title="Udhaar Aging — 30 / 60 / 90+ Din"
          desc="Kis shop ka paisa kitna PURANA ho gaya — FIFO hisaab se har shop ka balance 0-30, 31-60, 61-90 aur 90+ din ke buckets mein toota hua. Sab se purani unpaid invoice ki date ke sath."
          steps={[
            'Booker / City filter chunein (optional)',
            "'Report Load Karein' dabayen — aging abhi ki date par banti hai",
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
        <>
          {data && (
            <KpiRow
              items={[
                { label: 'Total Outstanding', value: fmtPKR(data.summary.totalOutstanding), sub: `${data.summary.shops} shops`, tone: 'blue' },
                { label: '0-30 Din', value: fmtPKR(data.buckets.find((b) => b.bucket === '0-30')?.amount ?? 0), sub: 'normal chalta hai', tone: 'emerald' },
                { label: '31-90 Din', value: fmtPKR((data.buckets.find((b) => b.bucket === '31-60')?.amount ?? 0) + (data.buckets.find((b) => b.bucket === '61-90')?.amount ?? 0)), sub: 'follow-up zaroori', tone: 'amber' },
                { label: '90+ Din (Risk)', value: fmtPKR(data.summary.risk90Plus), sub: `${data.summary.risk90PlusShops} shops — khatarnak`, tone: 'red' },
              ]}
            />
          )}
          {data && data.buckets.length > 0 && (
            <SectionCard title="Aging Buckets — Kitna Paisa Kitna Purana">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.buckets}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => Math.round(v).toLocaleString('en-US')} />
                    <Tooltip formatter={(v, _n, p) => [fmtPKR(Number(v)), `${(p?.payload as { shops?: number })?.shops ?? 0} shops`]} contentStyle={{ borderRadius: 10, border: '1px solid #d1fae5' }} />
                    <Bar dataKey="amount" radius={[6, 6, 0, 0]} barSize={52}>
                      {data.buckets.map((b) => <Cell key={b.bucket} fill={BUCKET_COLORS[b.bucket] ?? '#94a3b8'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}
          <SectionCard
            title="Shop-wise Aging (Oldest Invoice FIFO)"
            right={
              <ExportButtons
                opts={{
                  title: 'Udhaar Aging Report (30/60/90+)',
                  distributor: user?.profile?.businessName ?? '—',
                  period: 'Aaj ki date par',
                  filename: `aging-${new Date().toISOString().slice(0, 10)}`,
                  cols: cols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
                  rows: (data?.rows ?? []).map((r) => [r.shop, r.city, r.booker, r.creditDays, r.balance, r.b0_30, r.b31_60, r.b61_90, r.b90plus, r.oldestUnpaidDate ? fmtDay(r.oldestUnpaidDate) : '—']),
                  totalsRow: ['TOTAL', '', '', '', data?.summary.totalOutstanding ?? 0,
                    data?.rows.reduce((t, r) => t + r.b0_30, 0) ?? 0, data?.rows.reduce((t, r) => t + r.b31_60, 0) ?? 0,
                    data?.rows.reduce((t, r) => t + r.b61_90, 0) ?? 0, data?.rows.reduce((t, r) => t + r.b90plus, 0) ?? 0, ''],
                }}
              />
            }
          >
            <DataTable cols={cols} rows={data?.rows ?? []} empty="Kisi shop ka outstanding nahi — sab clear ✓" />
          </SectionCard>
        </>
      )}
    </div>
  )
}
