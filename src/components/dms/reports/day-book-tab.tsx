'use client'

// Task 131 — DAY BOOK (Roz Ka Hisaab) — date-wise poora business:
// bills, udhaar posted, cash in (RCP), wasooli (RCV), returns + booker summary

import { useState } from 'react'
import { NotebookPen } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, useFilterOptions, ReportEmptyGate, rangeLabel, type Col,
} from './reports-kit'

interface DayRow extends Record<string, unknown> {
  date: string; bills: number; salesValue: number; udhaarPosted: number
  cashCollected: number; wasooli: number; returnsValue: number
}
interface BookerRow extends Record<string, unknown> {
  booker: string; bills: number; salesValue: number; cashCollected: number; wasooli: number
}
interface Resp extends Record<string, unknown> {
  summary: { days: number; bills: number; salesValue: number; udhaarPosted: number; cashCollected: number; wasooli: number; returnsValue: number }
  days: DayRow[]
  bookers: BookerRow[]
}

export function DayBookTab() {
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
      return api<Resp>(`/api/reports/day-book?${p}`)
    },
    filtersKey: `${range.from}|${range.to}|${booker}|${city}`,
  })
  const { data, loading } = gate

  const dcols: Col<DayRow>[] = [
    { key: 'date', label: 'Date', render: (r) => new Date(r.date + 'T00:00:00').toLocaleDateString('en-PK', { weekday: 'short', day: '2-digit', month: 'short' }) },
    { key: 'bills', label: 'Bills', align: 'right', total: true },
    { key: 'salesValue', label: 'Bills Value', align: 'right', money: true, total: true, cls: 'font-semibold' },
    { key: 'udhaarPosted', label: 'Udhaar Posted', align: 'right', money: true, total: true, cls: 'text-red-600' },
    { key: 'cashCollected', label: 'Cash In (RCP)', align: 'right', money: true, total: true, cls: 'font-semibold text-emerald-700' },
    { key: 'wasooli', label: 'Wasooli (RCV)', align: 'right', money: true, total: true, cls: 'text-emerald-600' },
    { key: 'returnsValue', label: 'Returns', align: 'right', money: true, total: true, cls: 'text-amber-600' },
  ]

  const bcols: Col<BookerRow>[] = [
    { key: 'booker', label: 'Booker / Source' },
    { key: 'bills', label: 'Bills', align: 'right', total: true },
    { key: 'salesValue', label: 'Bills Value', align: 'right', money: true, total: true },
    { key: 'cashCollected', label: 'Cash In', align: 'right', money: true, total: true, cls: 'text-emerald-700' },
    { key: 'wasooli', label: 'Wasooli', align: 'right', money: true, total: true, cls: 'text-emerald-600' },
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
          icon={NotebookPen}
          title="Day Book — Roz Ka Hisaab"
          desc="Har din ka poora hisaab ek nazar mein: kitni bills bani, kitna udhaar post hua, kitna cash aaya (RCP receipts), kitni booker wasooli hui aur kitne returns aaye."
          steps={[
            'Date range select karein (Aaj / 7 Din / month)',
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
                { label: 'Bills', value: String(data.summary.bills), sub: `Rs ${fmt0(data.summary.salesValue)} value`, tone: 'blue' },
                { label: 'Cash In (RCP)', value: fmtPKR(data.summary.cashCollected), sub: `${data.summary.days} din`, tone: 'emerald' },
                { label: 'Udhaar Posted', value: fmtPKR(data.summary.udhaarPosted), sub: 'settle par posted', tone: 'red' },
                { label: 'Returns', value: fmtPKR(data.summary.returnsValue), sub: `Wasooli: Rs ${fmt0(data.summary.wasooli)}`, tone: 'amber' },
              ]}
            />
          )}
          <SectionCard
            title={`Day-wise Hisaab (${rangeLabel(range)})`}
            right={
              <ExportButtons
                opts={{
                  title: 'Day Book — Roz Ka Hisaab',
                  distributor: user?.profile?.businessName ?? '—',
                  period: rangeLabel(range),
                  filename: `day-book-${range.from}_${range.to}`,
                  cols: dcols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
                  rows: (data?.days ?? []).map((r) => [r.date, r.bills, r.salesValue, r.udhaarPosted, r.cashCollected, r.wasooli, r.returnsValue]),
                  totalsRow: ['TOTAL', data?.summary.bills ?? 0, data?.summary.salesValue ?? 0, data?.summary.udhaarPosted ?? 0, data?.summary.cashCollected ?? 0, data?.summary.wasooli ?? 0, data?.summary.returnsValue ?? 0],
                }}
              />
            }
          >
            <DataTable cols={dcols} rows={data?.days ?? []} empty="Is period mein koi transaction nahi" />
          </SectionCard>
          <SectionCard title="Booker / Source-wise (Period)">
            <DataTable cols={bcols} rows={data?.bookers ?? []} empty="Koi activity nahi" />
          </SectionCard>
        </>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
