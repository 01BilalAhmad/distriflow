'use client'

// Task 66 — Target vs Achievement tab (booker + brand, month-wise)

import { useState } from 'react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  KpiRow, DataTable, SectionCard, ExportButtons, useReport,
  type Col,
} from './reports-kit'

interface BookerRow extends Record<string, unknown> {
  bookerId: string; bookerName: string; target: number; achieved: number
  achievementPct: number; gap: number; orders: number
}
interface BrandRow extends Record<string, unknown> { booker: string; brand: string; target: number; achieved: number; achievementPct: number; gap: number }
interface Resp extends Record<string, unknown> {
  month: string; monthLabel: string
  summary: { totalTarget: number; totalAchieved: number; achievementPct: number; bookersWithTarget: number; onTrack: number }
  bookers: BookerRow[]; brandRows: BrandRow[]
}

export function TargetsTab() {
  const { user } = useDMS()
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)

  const { data, loading, refresh } = useReport<Resp>(async () => {
    return api<Resp>(`/api/reports/targets?userId=${user!.id}&month=${month}`)
  }, [user?.id, month])

  const bar = (pct: number) => (
    <div className="flex items-center justify-end gap-1.5">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={`w-12 text-right font-bold tabular-nums ${pct >= 100 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{pct.toFixed(0)}%</span>
    </div>
  )

  const cols: Col<BookerRow>[] = [
    { key: 'bookerName', label: 'Order Booker', render: (r) => <span className="font-semibold text-slate-800">{r.bookerName}</span> },
    { key: 'orders', label: 'Orders', align: 'right', total: true },
    { key: 'target', label: 'Target', align: 'right', money: true, total: true },
    { key: 'achieved', label: 'Achieved', align: 'right', money: true, total: true, cls: 'text-emerald-700' },
    { key: 'gap', label: 'Gap', align: 'right', money: true, total: true, cls: 'text-red-500' },
    { key: 'achievementPct', label: 'Achievement', align: 'right', render: (r) => bar(r.achievementPct) },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white/80 p-2.5 shadow-sm">
        <input
          type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700"
        />
        <button onClick={refresh} disabled={loading} className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          Refresh
        </button>
      </div>
      {data && (
        <KpiRow
          items={[
            { label: `${data.monthLabel} Target`, value: `Rs ${fmt0(data.summary.totalTarget)}`, sub: `${data.summary.bookersWithTarget} bookers ke targets`, tone: 'blue' },
            { label: 'Achieved', value: `Rs ${fmt0(data.summary.totalAchieved)}`, sub: 'Poore month ki sales', tone: 'emerald' },
            { label: 'Achievement', value: `${data.summary.achievementPct}%`, sub: data.summary.achievementPct >= 100 ? 'Target complete ✓' : 'Target se peeche', tone: data.summary.achievementPct >= 100 ? 'emerald' : 'amber' },
            { label: 'On Track Bookers', value: `${data.summary.onTrack}/${data.summary.bookersWithTarget}`, sub: '100%+ wale', tone: 'emerald' },
          ]}
        />
      )}
      <SectionCard
        title={`Booker-wise Target vs Achievement — ${data?.monthLabel ?? ''}`}
        right={
          <ExportButtons
            opts={{
              title: 'Target vs Achievement Report',
              distributor: user?.profile?.businessName ?? '—',
              period: data?.monthLabel ?? month,
              filename: `targets-${month}`,
              cols: [{ label: 'Booker' }, { label: 'Orders', align: 'right' }, { label: 'Target', align: 'right', money: true }, { label: 'Achieved', align: 'right', money: true }, { label: 'Gap', align: 'right', money: true }, { label: 'Achv %', align: 'right' }],
              rows: (data?.bookers ?? []).map((r) => [r.bookerName, r.orders, r.target, r.achieved, r.gap, `${r.achievementPct}%`]),
              totalsRow: ['TOTAL', data?.bookers.reduce((t, x) => t + x.orders, 0) ?? 0, data?.summary.totalTarget ?? 0, data?.summary.totalAchieved ?? 0, (data?.summary.totalTarget ?? 0) - (data?.summary.totalAchieved ?? 0), `${data?.summary.achievementPct ?? 0}%`],
            }}
          />
        }
      >
        <DataTable cols={cols} rows={data?.bookers ?? []} empty="Is month ke targets set nahi hue" />
      </SectionCard>
      {(data?.brandRows.length ?? 0) > 0 && (
        <SectionCard title="Brand-wise Targets">
          <DataTable
            cols={[
              { key: 'booker', label: 'Booker' },
              { key: 'brand', label: 'Brand' },
              { key: 'target', label: 'Target', align: 'right', money: true, total: true },
              { key: 'achieved', label: 'Achieved', align: 'right', money: true, total: true, cls: 'text-emerald-700' },
              { key: 'gap', label: 'Gap', align: 'right', money: true, total: true, cls: 'text-red-500' },
              { key: 'achievementPct', label: 'Achievement', align: 'right', render: (r: BrandRow) => bar(r.achievementPct) },
            ] as Col<BrandRow>[]}
            rows={data!.brandRows}
          />
        </SectionCard>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
