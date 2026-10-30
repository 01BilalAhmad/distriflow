'use client'

// Task 30 — DAMAGE & EXPIRY FLOOR REPORT — apna dedicated report (user: "Damage &
// Expiry Floor Report kahin nazar nai aa rahi, reports waly page main add kro").
// Task 29 mein ye Returns tab ke andar chhupa section tha — ab sidebar Reports group
// mein apni tile + apna URL (/reports/floor-stock). Data wohi returns-claims API se
// (floorStock + floorSummary already computed): sirf APPROVED DAMAGED/EXPIRED returns —
// ye maal inventory mein NAHI gaya (category-gated restock), floor par para hai.

import { PackageX } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, ReportEmptyGate, rangeLabel, type Col,
} from './reports-kit'

// Task 29 — Damage & Expiry floor stock (inventory mein NAHI gaya maal ka hisaab)
interface FloorRow extends Record<string, unknown> {
  name: string; sku: string; qty: number; value: number; damagedQty: number; expiredQty: number; lastDate: string
}
interface Resp extends Record<string, unknown> {
  floorStock: FloorRow[]
  floorSummary: { qty: number; value: number; damagedValue: number; expiredValue: number; returnsCount: number }
}

export function FloorStockTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()

  // Task 74 — filter-first: data sirf "Report Load Karein" par load hota hai
  const gate = useReportGate<Resp>({
    fetcher: async () => {
      return api<Resp>(`/api/reports/returns-claims?userId=${user!.id}&from=${range.from}&to=${range.to}`)
    },
    filtersKey: `${range.from}|${range.to}`,
  })
  const { data, loading } = gate

  const floorCols: Col<FloorRow>[] = [
    { key: 'name', label: 'Product', render: (r) => <span><span className="font-semibold text-slate-800">{r.name}</span><span className="ml-1.5 text-[10px] text-slate-400">{r.sku}</span></span> },
    { key: 'damagedQty', label: 'Damaged Qty (Pcs)', align: 'right', total: true, cls: 'text-amber-700' },
    { key: 'expiredQty', label: 'Expired Qty (Pcs)', align: 'right', total: true, cls: 'text-red-600' },
    { key: 'qty', label: 'Total Qty (Pcs)', align: 'right', total: true, cls: 'font-bold' },
    { key: 'value', label: 'Floor Value', align: 'right', money: true, total: true, cls: 'font-bold text-red-600' },
    { key: 'lastDate', label: 'Last Return', render: (r) => <span className="text-[11px] text-slate-500">{new Date(r.lastDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}</span> },
  ]

  return (
    <div className="space-y-3">
      <FilterBar
        range={range} setRange={setRange} preset={preset} setPreset={setPreset}
        onRefresh={gate.load} loading={loading} armed={gate.armed} stale={gate.stale}
      />
      {!gate.armed ? (
        <ReportEmptyGate
          icon={PackageX}
          title="Damage & Expiry Floor Report"
          desc="Floor par para damage/expired maal — jo shops se wapas aaya magar inventory (stock) mein shamil NAHI hua kyunke ye dobara sale nahi ho sakta. Company claim / disposal ka hisaab isi se hoga."
          steps={[
            'Date range select karein — preset ya custom',
            "'Report Load Karein' dabayen — selected period ke approved damage/expired returns load honge",
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
      <>
      {data && (
        <KpiRow
          items={[
            { label: 'Floor Value (D&E)', value: `Rs ${fmt0(data.floorSummary?.value ?? 0)}`, sub: 'Inventory mein shamil NAHI', tone: 'red' },
            { label: 'Floor Qty', value: `${fmt0(data.floorSummary?.qty ?? 0)} pcs`, sub: `${data.floorSummary?.returnsCount ?? 0} approved returns`, tone: 'slate' },
            { label: 'Damaged Value', value: `Rs ${fmt0(data.floorSummary?.damagedValue ?? 0)}`, sub: 'Damage claim stock', tone: 'amber' },
            { label: 'Expired Value', value: `Rs ${fmt0(data.floorSummary?.expiredValue ?? 0)}`, sub: 'Expiry claim stock', tone: 'red' },
            { label: 'SKUs on Floor', value: String(data.floorStock?.length ?? 0), sub: 'Product-wise breakdown neeche', tone: 'blue' },
          ]}
        />
      )}
      <SectionCard
        title="Damage & Expiry Stock (Floor) — inventory mein shamil NAHI"
        right={
          <ExportButtons
            opts={{
              title: 'Damage & Expiry Floor Stock Report',
              distributor: user?.profile?.businessName ?? '—',
              period: rangeLabel(range),
              filename: `damage-expiry-floor-${range.from}_${range.to}`,
              cols: floorCols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
              rows: (data?.floorStock ?? []).map((r) => [r.name, r.damagedQty, r.expiredQty, r.qty, r.value, new Date(r.lastDate).toLocaleDateString('en-PK')]),
              totalsRow: ['TOTAL', data?.floorStock.reduce((t, x) => t + x.damagedQty, 0) ?? 0, data?.floorStock.reduce((t, x) => t + x.expiredQty, 0) ?? 0, data?.floorSummary.qty ?? 0, data?.floorSummary.value ?? 0, ''],
            }}
          />
        }
      >
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5 mb-2">
          Ye <b>damage/expired</b> maal jo shops se wapas aaya — inventory (stock) mein <b>shamil NAHI</b> kiya gaya kyunke ye dobara sale nahi ho sakta. Floor par isi liye para hai — company claim / disposal ka hisaab isi se hoga. (Damaged Rs {fmt0(data?.floorSummary?.damagedValue ?? 0)} • Expired Rs {fmt0(data?.floorSummary?.expiredValue ?? 0)} — {data?.floorSummary?.returnsCount ?? 0} approved returns)
        </p>
        <DataTable cols={floorCols} rows={data?.floorStock ?? []} empty="Floor par koi damage/expired stock nahi — sab inventory mein chala gaya ✓" maxH="max-h-[45vh]" />
      </SectionCard>
      </>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
