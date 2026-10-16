'use client'

// Task 66 — Top Shops (ABC analysis) tab — Pareto 80/20

import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, CSVButton, PrintButton,
  downloadCSV, printReport, useReport, fmtDay, rangeLabel, type Col,
} from './reports-kit'

interface ShopRow extends Record<string, unknown> {
  shop: string; code: string; city: string; channel: string; booker: string
  orders: number; sales: number; avgOrder: number; lastOrderDate: string | null
  sharePct: number; cumPct: number; abc: 'A' | 'B' | 'C'
}
interface Resp extends Record<string, unknown> {
  summary: { shops: number; totalSales: number; aShops: number; aSales: number; bShops: number; bSales: number; cShops: number; cSales: number; paretoNote: string }
  rows: ShopRow[]
}

const ABC_BADGE: Record<string, string> = {
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  B: 'bg-blue-50 text-blue-700 border-blue-200',
  C: 'bg-slate-100 text-slate-600 border-slate-200',
}

export function TopShopsTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()

  const { data, loading, refresh } = useReport<Resp>(async () => {
    return api<Resp>(`/api/reports/top-shops?userId=${user!.id}&from=${range.from}&to=${range.to}`)
  }, [user?.id, range.from, range.to])

  const cols: Col<ShopRow>[] = [
    { key: 'shop', label: 'Shop', render: (r) => (
      <span>
        <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold" style={undefined}>
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${ABC_BADGE[r.abc]}`}>{r.abc}</span>
        </span>
        <span className="font-semibold text-slate-800">{r.shop}</span>
        <span className="ml-1.5 text-[10px] text-slate-400">{r.code}</span>
      </span>
    ) },
    { key: 'city', label: 'City' },
    { key: 'channel', label: 'Channel' },
    { key: 'booker', label: 'Booker' },
    { key: 'orders', label: 'Orders', align: 'right', total: true },
    { key: 'sales', label: 'Net Sales', align: 'right', money: true, total: true, cls: 'font-semibold' },
    { key: 'avgOrder', label: 'Avg Order', align: 'right', money: true },
    { key: 'lastOrderDate', label: 'Last Order', align: 'right', render: (r) => fmtDay(r.lastOrderDate) },
    { key: 'sharePct', label: 'Share %', align: 'right', render: (r) => `${r.sharePct.toFixed(1)}%` },
    { key: 'cumPct', label: 'Cumulative %', align: 'right', render: (r) => `${r.cumPct.toFixed(1)}%` },
  ]

  return (
    <div className="space-y-3">
      <FilterBar
        range={range} setRange={setRange} preset={preset} setPreset={setPreset}
        onRefresh={refresh} loading={loading}
      />
      {data && (
        <KpiRow
          items={[
            { label: 'A Class Shops', value: String(data.summary.aShops), sub: `Rs ${fmt0(data.summary.aSales)} (${data.summary.totalSales > 0 ? ((data.summary.aSales / data.summary.totalSales) * 100).toFixed(0) : 0}% sales) — focus!`, tone: 'emerald' },
            { label: 'B Class', value: String(data.summary.bShops), sub: `Rs ${fmt0(data.summary.bSales)}`, tone: 'blue' },
            { label: 'C Class (Tail)', value: String(data.summary.cShops), sub: `Rs ${fmt0(data.summary.cSales)}`, tone: 'slate' },
            { label: 'Total Sales', value: `Rs ${fmt0(data.summary.totalSales)}`, sub: `${data.summary.shops} shops`, tone: 'blue' },
          ]}
        />
      )}
      <SectionCard
        title="ABC Ranking (sales ke hisab se)"
        right={
          <div className="flex items-center gap-2">
            <CSVButton onClick={() => downloadCSV(`top-shops-${range.from}_${range.to}`, cols.map((c) => c.label), (data?.rows ?? []).map((r) => [r.abc, r.shop, r.city, r.channel, r.booker, r.orders, r.sales, r.avgOrder, r.lastOrderDate ?? '', r.sharePct, r.cumPct]))} />
            <PrintButton onClick={() => printReport({
              title: 'Top Shops Report (ABC Analysis)',
              subtitle: 'A = top 80% cumulative sales • B = 80-95% • C = tail',
              distributor: user?.profile?.businessName ?? '—',
              period: rangeLabel(range),
              cols: cols.map((c) => ({ label: c.label, align: c.align })),
              rows: (data?.rows ?? []).map((r) => [r.abc, r.shop, r.city, r.channel, r.booker, r.orders, r.sales, r.avgOrder, r.lastOrderDate ? fmtDay(r.lastOrderDate) : '—', `${r.sharePct}%`, `${r.cumPct}%`]),
              totalsRow: ['TOTAL', '', '', '', '', data?.rows.reduce((t, x) => t + x.orders, 0) ?? 0, data?.summary.totalSales ?? 0, '', '', '100%', '100%'],
            })} />
          </div>
        }
      >
        <DataTable cols={cols} rows={data?.rows ?? []} empty="Is period mein koi sales nahi" />
      </SectionCard>
      <p className="text-[11px] text-slate-400">
        Pareto principle: A-class shops aapki 80% sales deti hain — inki service/stock priority sab se upar rakhein. C-class shops par growth potential ya drop decision lene ka mauqa hai.
      </p>
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
