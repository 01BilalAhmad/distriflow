'use client'

// Task 131 — VISIT COMPLIANCE (PJP vs Actual) — booker ne plan ke mutabiq
// kitni shops visit ki: COMPLETED / MISSED / PENDING + GPS check-ins,
// booker-wise completion % aur visit detail list.

import { useState } from 'react'
import { MapPinned } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, useFilterOptions, ReportEmptyGate, fmtDay, fmtDT, rangeLabel, type Col,
} from './reports-kit'

interface BRow extends Record<string, unknown> {
  booker: string; days: number; planned: number; completed: number; missed: number; pending: number; gpsCheckIns: number; pct: number
}
interface VRow extends Record<string, unknown> {
  date: string; booker: string; shop: string; city: string; status: string; checkInAt: string | null; hasGps: boolean; notes: string | null
}
interface Resp extends Record<string, unknown> {
  summary: { days: number; planned: number; completed: number; missed: number; pending: number; gpsCheckIns: number; completionPct: number }
  bookers: BRow[]
  visits: VRow[]
}

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  MISSED: 'bg-red-50 text-red-700',
  CHECKED_IN: 'bg-blue-50 text-blue-700',
  PENDING: 'bg-slate-100 text-slate-600',
}
const STATUS_LABEL: Record<string, string> = { COMPLETED: 'Visit Hui', MISSED: 'Missed', CHECKED_IN: 'Check-in', PENDING: 'Nahi Hui' }

export function VisitsTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()
  const [booker, setBooker] = useState('')
  const [city, setCity] = useState('')
  const fopts = useFilterOptions(user?.id)

  const gate = useReportGate<Resp>({
    fetcher: async () => {
      const p = new URLSearchParams({ userId: user!.id, from: range.from, to: range.to })
      if (booker) p.set('bookerId', booker)
      if (city) p.set('city', city)
      return api<Resp>(`/api/reports/visits?${p}`)
    },
    filtersKey: `${range.from}|${range.to}|${booker}|${city}`,
  })
  const { data, loading } = gate

  const bcols: Col<BRow>[] = [
    { key: 'booker', label: 'Booker' },
    { key: 'days', label: 'Plan Days', align: 'right', total: true },
    { key: 'planned', label: 'Planned Visits', align: 'right', total: true },
    { key: 'completed', label: 'Completed', align: 'right', total: true, cls: 'text-emerald-700' },
    { key: 'missed', label: 'Missed', align: 'right', total: true, cls: 'text-red-600' },
    { key: 'pending', label: 'Nahi Hui', align: 'right', total: true, cls: 'text-slate-500' },
    { key: 'gpsCheckIns', label: 'GPS Check-ins', align: 'right', total: true, cls: 'text-blue-600' },
    { key: 'pct', label: 'Completion %', align: 'right', render: (r) => (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.pct >= 80 ? 'bg-emerald-50 text-emerald-700' : r.pct >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
        {r.pct}%
      </span>
    ) },
  ]

  const vcols: Col<VRow>[] = [
    { key: 'date', label: 'Plan Date', render: (r) => fmtDay(r.date) },
    { key: 'booker', label: 'Booker' },
    { key: 'shop', label: 'Shop' },
    { key: 'city', label: 'City' },
    { key: 'status', label: 'Status', align: 'center', render: (r) => (
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[r.status] ?? 'bg-slate-100 text-slate-600'}`}>
        {STATUS_LABEL[r.status] ?? r.status}
      </span>
    ) },
    { key: 'checkInAt', label: 'Check-in', align: 'right', render: (r) => (
      <span>
        {r.checkInAt ? fmtDT(r.checkInAt) : '—'}
        {r.hasGps && <span className="ml-1 text-[10px] font-bold text-blue-600" title="GPS check-in">📍GPS</span>}
      </span>
    ) },
  ]

  return (
    <div className="space-y-3">
      <FilterBar
        range={range} setRange={setRange} preset={preset} setPreset={setPreset}
        booker={booker} setBooker={setBooker} bookers={fopts.bookers}
        city={city} setCity={setCity} cities={fopts.cities}
        onRefresh={gate.load} loading={loading} armed={gate.armed} stale={gate.stale}
      />
      {!gate.armed ? (
        <ReportEmptyGate
          icon={MapPinned}
          title="Visit Compliance — Plan vs Actual"
          desc="Booker ne PJP plan ke mutabiq kitni shops visit ki, kitni MISSED hui, kitne GPS check-ins hue — team ki field discipline ka asli hisaab."
          steps={[
            'Date range select karein',
            'Booker / City filter chunein (optional)',
            "'Report Load Karein' dabayen",
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
        <>
          {data && (
            <KpiRow
              items={[
                { label: 'Planned Visits', value: String(data.summary.planned), sub: `${data.summary.days} plan days`, tone: 'blue' },
                { label: 'Completed', value: String(data.summary.completed), sub: `Missed: ${data.summary.missed}`, tone: 'emerald' },
                { label: 'Completion %', value: `${data.summary.completionPct}%`, sub: `GPS check-ins: ${data.summary.gpsCheckIns}`, tone: data.summary.completionPct >= 70 ? 'emerald' : 'amber' },
                { label: 'Nahi Hui', value: String(data.summary.pending), sub: 'plan tha par visit nahi', tone: 'slate' },
              ]}
            />
          )}
          <SectionCard title="Booker-wise Compliance (Period)">
            <DataTable cols={bcols} rows={data?.bookers ?? []} empty="Is period mein koi PJP plan nahi bana" />
          </SectionCard>
          <SectionCard
            title={`Visit Detail — Latest 500 (${rangeLabel(range)})`}
            right={
              <ExportButtons
                opts={{
                  title: 'Visit Compliance Report',
                  distributor: user?.profile?.businessName ?? '—',
                  period: rangeLabel(range),
                  filename: `visit-compliance-${range.from}_${range.to}`,
                  cols: vcols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
                  rows: (data?.visits ?? []).map((r) => [r.date.slice(0, 10), r.booker, r.shop, r.city, STATUS_LABEL[r.status] ?? r.status, r.checkInAt ? fmtDT(r.checkInAt) : '—', r.hasGps ? 'GPS' : '—']),
                }}
              />
            }
          >
            <DataTable cols={vcols} rows={data?.visits ?? []} empty="Is period mein koi visit record nahi" maxH="max-h-[45vh]" />
          </SectionCard>
        </>
      )}
    </div>
  )
}
