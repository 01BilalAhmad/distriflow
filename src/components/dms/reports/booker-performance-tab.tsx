'use client'

// Task 66 — Order Booker Performance tab (productivity + recovery)

import { Users } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, ReportEmptyGate, fmtDay, rangeLabel, type Col,
} from './reports-kit'

interface PerfRow extends Record<string, unknown> {
  bookerName: string; phone: string | null; isActive: boolean
  orders: number; shopsServed: number; shopsAssigned: number; coveragePct: number
  netSales: number; discountGiven: number; avgOrderValue: number; linesPerDrop: number
  freeUnits: number; recoveryCollected: number; lastOrderDate: string | null
}
interface Resp extends Record<string, unknown> {
  summary: { bookers: number; activeBookers: number; orders: number; netSales: number; recoveryCollected: number; avgOrderValue: number }
  rows: PerfRow[]
}

export function BookerPerformanceTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()

  // Task 74 — filter-first: data sirf "Report Load Karein" par load hota hai
  const gate = useReportGate<Resp>({
    fetcher: async () => {
      return api<Resp>(`/api/reports/booker-performance?userId=${user!.id}&from=${range.from}&to=${range.to}`)
    },
    filtersKey: `${range.from}|${range.to}`,
  })
  const { data, loading } = gate

  const cols: Col<PerfRow>[] = [
    { key: 'bookerName', label: 'Order Booker', render: (r) => <span><span className="font-semibold text-slate-800">{r.bookerName}</span>{!r.isActive && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">INACTIVE</span>}</span> },
    { key: 'orders', label: 'Orders', align: 'right', total: true },
    { key: 'shopsServed', label: 'Shops Served', align: 'right', total: true },
    { key: 'shopsAssigned', label: 'Assigned', align: 'right', total: true },
    { key: 'coveragePct', label: 'Coverage', align: 'right', render: (r) => `${r.coveragePct.toFixed(0)}%` },
    { key: 'netSales', label: 'Net Sales', align: 'right', money: true, total: true, cls: 'font-semibold text-emerald-700' },
    { key: 'discountGiven', label: 'Discount Diya', align: 'right', money: true, total: true, cls: 'text-amber-600' },
    { key: 'avgOrderValue', label: 'Avg Order', align: 'right', money: true },
    { key: 'linesPerDrop', label: 'Lines/Drop', align: 'right', render: (r) => r.linesPerDrop.toFixed(1) },
    { key: 'freeUnits', label: 'Free Units', align: 'right', total: true, cls: 'text-emerald-600' },
    { key: 'recoveryCollected', label: 'Wasooli', align: 'right', money: true, total: true, cls: 'text-blue-600' },
    { key: 'lastOrderDate', label: 'Last Order', align: 'right', render: (r) => fmtDay(r.lastOrderDate) },
  ]

  return (
    <div className="space-y-3">
      <FilterBar
        range={range} setRange={setRange} preset={preset} setPreset={setPreset}
        onRefresh={gate.load} loading={loading} armed={gate.armed} stale={gate.stale}
      />
      {!gate.armed ? (
        <ReportEmptyGate
          icon={Users}
          title="Order Booker Performance Report"
          desc="Har booker ki productivity — orders, shops served, coverage %, net sales, discount, free units aur wasooli ek jagah."
          steps={[
            'Date range select karein — preset ya custom',
            "'Report Load Karein' dabayen — sirf selected period ki performance load hogi",
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
      <>
      {data && (
        <KpiRow
          items={[
            { label: 'Bookers', value: String(data.summary.bookers), sub: `${data.summary.activeBookers} ne orders kiye`, tone: 'blue' },
            { label: 'Total Orders', value: String(data.summary.orders), tone: 'slate' },
            { label: 'Net Sales', value: `Rs ${fmt0(data.summary.netSales)}`, tone: 'emerald' },
            { label: 'Avg Order Value', value: `Rs ${fmt0(data.summary.avgOrderValue)}`, tone: 'slate' },
            { label: 'Wasooli (Period)', value: `Rs ${fmt0(data.summary.recoveryCollected)}`, tone: 'blue' },
          ]}
        />
      )}
      <SectionCard
        title="Booker Performance Breakdown"
        right={
          <div className="flex items-center gap-2">
            <ExportButtons
              opts={{
                title: 'Order Booker Performance Report',
                distributor: user?.profile?.businessName ?? '—',
                period: rangeLabel(range),
                filename: `booker-performance-${range.from}_${range.to}`,
                cols: cols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
                rows: (data?.rows ?? []).map((r) => [r.bookerName, r.orders, r.shopsServed, r.shopsAssigned, `${r.coveragePct}%`, r.netSales, r.discountGiven, r.avgOrderValue, r.linesPerDrop, r.freeUnits, r.recoveryCollected, r.lastOrderDate ? fmtDay(r.lastOrderDate) : '—']),
                totalsRow: ['TOTAL', data?.rows.reduce((t, x) => t + x.orders, 0) ?? 0, '', '', '', data?.rows.reduce((t, x) => t + x.netSales, 0) ?? 0, data?.rows.reduce((t, x) => t + x.discountGiven, 0) ?? 0, '', '', data?.rows.reduce((t, x) => t + x.freeUnits, 0) ?? 0, data?.rows.reduce((t, x) => t + x.recoveryCollected, 0) ?? 0, ''],
              }}
            />
          </div>
        }
      >
        <DataTable cols={cols} rows={data?.rows ?? []} empty="Is period mein koi booker activity nahi" />
      </SectionCard>
      <p className="text-[11px] text-slate-400">
        Lines/Drop = har bill mein average kitne products (productivity signal) • Coverage = served ÷ assigned shops • Wasooli = APPROVED recovery vouchers (period).
      </p>
      </>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
