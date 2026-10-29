'use client'

// Task 66 — Returns & Claims tab (loss control)

import { Undo2 } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, ReportEmptyGate, rangeLabel, type Col,
} from './reports-kit'

interface ShopRow extends Record<string, unknown> {
  shop: string; code: string; city: string; booker: string; returnsCount: number
  returnsValue: number; salesInPeriod: number; returnRatePct: number
  damaged: number; expired: number; unsold: number; pending: number; approved: number; rejected: number
}
interface ProdRow extends Record<string, unknown> { name: string; sku: string; qty: number; value: number }
// Task 29 — Damage & Expiry floor stock (inventory mein NAHI gaya maal ka hisaab)
interface FloorRow extends Record<string, unknown> {
  name: string; sku: string; qty: number; value: number; damagedQty: number; expiredQty: number; lastDate: string
}
interface Resp extends Record<string, unknown> {
  summary: { returnsCount: number; approvedValue: number; pendingCount: number; pendingValue: number; totalSales: number; returnRatePct: number; claimsAmount: number }
  typeSummary: { type: string; count: number; value: number }[]
  shopWise: ShopRow[]; productWise: ProdRow[]
  floorStock: FloorRow[]
  floorSummary: { qty: number; value: number; damagedValue: number; expiredValue: number; returnsCount: number }
  claimsByType: { type: string; count: number; amount: number; approved: number; pending: number }[]
  claimsList: { claimNo: string; type: string; amount: number; status: string; reason: string | null; createdAt: string }[]
}

export function ReturnsClaimsTab() {
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

  const shopCols: Col<ShopRow>[] = [
    { key: 'shop', label: 'Shop', render: (r) => <span><span className="font-semibold text-slate-800">{r.shop}</span><span className="ml-1.5 text-[10px] text-slate-400">{r.code}</span></span> },
    { key: 'city', label: 'City' },
    { key: 'booker', label: 'Booker' },
    { key: 'returnsCount', label: 'Returns', align: 'right', total: true },
    { key: 'returnsValue', label: 'Return Value', align: 'right', money: true, total: true, cls: 'font-bold text-red-600' },
    { key: 'salesInPeriod', label: 'Sales (Period)', align: 'right', money: true, total: true },
    { key: 'returnRatePct', label: 'Return %', align: 'right', render: (r) => (
      <span className={`font-bold ${r.returnRatePct > 10 ? 'text-red-500' : r.returnRatePct > 5 ? 'text-amber-600' : 'text-slate-600'}`}>{r.returnRatePct.toFixed(1)}%</span>
    ) },
    { key: 'damaged', label: 'Damaged', align: 'center', total: true },
    { key: 'expired', label: 'Expired', align: 'center', total: true },
    { key: 'unsold', label: 'Unsold', align: 'center', total: true },
    { key: 'pending', label: 'Pending', align: 'center', total: true, cls: 'text-amber-600' },
    { key: 'approved', label: 'Approved', align: 'center', total: true, cls: 'text-emerald-600' },
    { key: 'rejected', label: 'Rejected', align: 'center', total: true },
  ]

  const prodCols: Col<ProdRow>[] = [
    { key: 'name', label: 'Product', render: (r) => <span><span className="font-semibold text-slate-800">{r.name}</span><span className="ml-1.5 text-[10px] text-slate-400">{r.sku}</span></span> },
    { key: 'qty', label: 'Return Qty (Pcs)', align: 'right', total: true },
    { key: 'value', label: 'Return Value', align: 'right', money: true, total: true, cls: 'font-bold text-red-600' },
  ]

  // Task 29 — floor stock: jo damage/expired maal inventory mein nahi gaya, floor par para hai
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
          icon={Undo2}
          title="Returns & Claims Report (Loss Control)"
          desc="Shop-wise aur product-wise returns, return rate %, damaged/expired/unsold breakdown aur company claims ki status."
          steps={[
            'Date range select karein — preset ya custom',
            "'Report Load Karein' dabayen — sirf selected period ke returns load honge",
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
      <>
      {data && (
        <KpiRow
          items={[
            { label: 'Returns (Period)', value: String(data.summary.returnsCount), sub: `Approved Rs ${fmt0(data.summary.approvedValue)}`, tone: 'red' },
            { label: 'Pending Returns', value: String(data.summary.pendingCount), sub: `Rs ${fmt0(data.summary.pendingValue)}`, tone: 'amber' },
            { label: 'Return Rate', value: `${data.summary.returnRatePct}%`, sub: `Sales Rs ${fmt0(data.summary.totalSales)}`, tone: data.summary.returnRatePct > 10 ? 'red' : 'slate' },
            { label: 'Floor Stock (D&E)', value: `Rs ${fmt0(data.floorSummary?.value ?? 0)}`, sub: `${data.floorSummary?.qty ?? 0} pcs damage/expired — inventory mein NAHI`, tone: 'red' },
            { label: 'Claims (Period)', value: `Rs ${fmt0(data.summary.claimsAmount)}`, sub: 'Sab types', tone: 'blue' },
          ]}
        />
      )}
      <SectionCard
        title="Shop-wise Returns (Loss Control)"
        right={
          <div className="flex items-center gap-2">
            <ExportButtons
              opts={{
                title: 'Returns & Claims Report — Shop-wise',
                distributor: user?.profile?.businessName ?? '—',
                period: rangeLabel(range),
                filename: `returns-shopwise-${range.from}_${range.to}`,
                cols: shopCols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
                rows: (data?.shopWise ?? []).map((r) => [r.shop, r.city, r.booker, r.returnsCount, r.returnsValue, r.salesInPeriod, `${r.returnRatePct}%`, r.damaged, r.expired, r.unsold, r.pending, r.approved, r.rejected]),
                totalsRow: ['TOTAL', '', '', data?.shopWise.reduce((t, x) => t + x.returnsCount, 0) ?? 0, data?.shopWise.reduce((t, x) => t + x.returnsValue, 0) ?? 0, data?.shopWise.reduce((t, x) => t + x.salesInPeriod, 0) ?? 0, `${data?.summary.returnRatePct ?? 0}%`, '', '', '', '', '', ''],
              }}
            />
          </div>
        }
      >
        <DataTable cols={shopCols} rows={data?.shopWise ?? []} empty="Is period mein koi return nahi — zabardast ✓" />
      </SectionCard>
      <SectionCard title="Product-wise Returns (kaunsa SKU wapas aa raha hai)">
        <DataTable cols={prodCols} rows={data?.productWise ?? []} empty="Koi product return nahi hua" maxH="max-h-[35vh]" />
      </SectionCard>
      {/* Task 29 — Damage & Expiry floor stock report (alag report — user ki requirement) */}
      <SectionCard
        title="Damage & Expiry Stock (Floor) — inventory mein shamil NAHI"
        right={
          <ExportButtons
            opts={{
              title: 'Damage & Expiry Floor Stock',
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
        <DataTable cols={floorCols} rows={data?.floorStock ?? []} empty="Floor par koi damage/expired stock nahi — sab inventory mein chala gaya ✓" maxH="max-h-[35vh]" />
      </SectionCard>
      {(data?.claimsByType.length ?? 0) > 0 && (
        <SectionCard title="Claims Summary (Company Claims)">
          <DataTable
            cols={[
              { key: 'type', label: 'Claim Type' },
              { key: 'count', label: 'Claims', align: 'right', total: true },
              { key: 'amount', label: 'Amount', align: 'right', money: true, total: true },
              { key: 'approved', label: 'Approved', align: 'right', money: true, total: true, cls: 'text-emerald-600' },
              { key: 'pending', label: 'Pending', align: 'right', money: true, total: true, cls: 'text-amber-600' },
            ] as Col<Record<string, unknown>>[]}
            rows={(data!.claimsByType) as unknown as Record<string, unknown>[]}
            maxH="max-h-[30vh]"
          />
        </SectionCard>
      )}
      </>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
