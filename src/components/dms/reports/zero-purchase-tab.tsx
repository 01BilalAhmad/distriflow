'use client'

// Task 66 — Zero Purchase tab (month-wise: har shop ko mahine mein 1 bill lazmi)

import { useState } from 'react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, KpiRow, DataTable, SectionCard, CSVButton, PrintButton,
  downloadCSV, printReport, useReport, fmtMoney, fmtDay, type Col, type Option,
} from './reports-kit'

interface ZeroRow extends Record<string, unknown> {
  shop: string; code: string; city: string; channel: string; booker: string
  lastOrderDate: string | null; lastOrderValue: number; daysSinceLastOrder: number | null
  avg3m: number; everOrdered: boolean
}
interface BookerSum extends Record<string, unknown> { booker: string; total: number; active: number; zero: number; coveragePct: number }
interface Resp extends Record<string, unknown> {
  month: string; monthLabel: string
  summary: { totalShops: number; activeShops: number; zeroShops: number; zeroPct: number; monthSalesValue: number; newShops: number }
  zeroRows: ZeroRow[]; bookerSummary: BookerSum[]; meta: { bookers: Option[] }
}

export function ZeroPurchaseTab() {
  const { user } = useDMS()
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [booker, setBooker] = useState('')

  const { data, loading, refresh } = useReport<Resp>(async () => {
    const p = new URLSearchParams({ userId: user!.id, month })
    if (booker) p.set('bookerId', booker)
    return api<Resp>(`/api/reports/zero-purchase?${p}`)
  }, [user?.id, month, booker])

  const cols: Col<ZeroRow>[] = [
    { key: 'shop', label: 'Shop', render: (r) => <span><span className="font-semibold text-slate-800">{r.shop}</span><span className="ml-1.5 text-[10px] text-slate-400">{r.code}</span></span> },
    { key: 'city', label: 'City' },
    { key: 'channel', label: 'Channel' },
    { key: 'booker', label: 'Order Booker' },
    { key: 'lastOrderDate', label: 'Last Order', align: 'right', render: (r) => r.lastOrderDate ? fmtDay(r.lastOrderDate) : <span className="font-semibold text-red-500">Kabhi nahi</span> },
    { key: 'daysSinceLastOrder', label: 'Din se', align: 'right', render: (r) => r.daysSinceLastOrder != null ? `${r.daysSinceLastOrder} din` : '—' },
    { key: 'lastOrderValue', label: 'Last Order Value', align: 'right', money: true },
    { key: 'avg3m', label: 'Avg 3 Month', align: 'right', money: true, total: true },
  ]

  const bcols: Col<BookerSum>[] = [
    { key: 'booker', label: 'Order Booker', render: (r) => <span className="font-semibold text-slate-800">{r.booker}</span> },
    { key: 'total', label: 'Total Shops', align: 'right', total: true },
    { key: 'active', label: 'Ordered (is month)', align: 'right', total: true, cls: 'text-emerald-600' },
    { key: 'zero', label: 'Zero Purchase', align: 'right', total: true, cls: 'text-red-500' },
    { key: 'coveragePct', label: 'Coverage %', align: 'right', render: (r) => `${r.coveragePct.toFixed(1)}%` },
  ]

  return (
    <div className="space-y-3">
      <FilterBar
        booker={booker} setBooker={setBooker} bookers={data?.meta.bookers}
        onRefresh={refresh} loading={loading}
        extra={
          <input
            type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        }
      />
      {data && (
        <KpiRow
          items={[
            { label: `${data.monthLabel} — Total Shops`, value: String(data.summary.totalShops), sub: 'Active shops', tone: 'slate' },
            { label: 'Ordered (bill bana)', value: String(data.summary.activeShops), sub: 'Is month', tone: 'emerald' },
            { label: 'Zero Purchase', value: String(data.summary.zeroShops), sub: `${data.summary.zeroPct}% shops ne bill nahi banaya`, tone: 'red' },
            { label: 'Kabhi Order Nahi', value: String(data.summary.newShops), sub: 'New/never-ordered shops', tone: 'amber' },
            { label: 'Is Month Sales', value: `Rs ${fmtMoney(data.summary.monthSalesValue)}`, tone: 'blue' },
          ]}
        />
      )}
      <SectionCard
        title={`Zero Purchase Shops — ${data?.monthLabel ?? ''}`}
        right={
          <div className="flex items-center gap-2">
            <CSVButton onClick={() => downloadCSV(`zero-purchase-${month}`, cols.map((c) => c.label), data?.zeroRows.map((r) => [r.shop, r.code, r.city, r.channel, r.booker, r.lastOrderDate ?? 'Kabhi nahi', r.daysSinceLastOrder ?? '', r.lastOrderValue, r.avg3m]) ?? [])} />
            <PrintButton onClick={() => printReport({
              title: 'Zero Purchase Report (Month-wise)',
              subtitle: 'Rule: har shop ko month mein kam az kam 1 bill',
              distributor: user?.profile?.businessName ?? '—',
              period: data?.monthLabel ?? month,
              cols: cols.map((c) => ({ label: c.label, align: c.align })),
              rows: data?.zeroRows.map((r) => [r.shop, r.city, r.channel, r.booker, r.lastOrderDate ? fmtDay(r.lastOrderDate) : 'Kabhi nahi', r.daysSinceLastOrder != null ? `${r.daysSinceLastOrder}` : '—', fmtMoney(r.lastOrderValue), fmtMoney(r.avg3m)]) ?? [],
              totalsRow: ['TOTAL', '', '', '', '', '', '', fmtMoney(data?.zeroRows.reduce((t, r) => t + r.avg3m, 0) ?? 0)],
            })} />
          </div>
        }
      >
        <DataTable cols={cols} rows={data?.zeroRows ?? []} empty="Mubarak ho — sab shops ne is month bill banaya ✓" />
      </SectionCard>
      <SectionCard title="Booker-wise Coverage Summary">
        <DataTable cols={bcols} rows={data?.bookerSummary ?? []} />
      </SectionCard>
    </div>
  )
}
