'use client'

// Task 66 — Returns & Claims tab (loss control)

import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReport, rangeLabel, type Col,
} from './reports-kit'

interface ShopRow extends Record<string, unknown> {
  shop: string; code: string; city: string; booker: string; returnsCount: number
  returnsValue: number; salesInPeriod: number; returnRatePct: number
  damaged: number; expired: number; unsold: number; pending: number; approved: number; rejected: number
}
interface ProdRow extends Record<string, unknown> { name: string; sku: string; qty: number; value: number }
interface Resp extends Record<string, unknown> {
  summary: { returnsCount: number; approvedValue: number; pendingCount: number; pendingValue: number; totalSales: number; returnRatePct: number; claimsAmount: number }
  typeSummary: { type: string; count: number; value: number }[]
  shopWise: ShopRow[]; productWise: ProdRow[]
  claimsByType: { type: string; count: number; amount: number; approved: number; pending: number }[]
  claimsList: { claimNo: string; type: string; amount: number; status: string; reason: string | null; createdAt: string }[]
}

export function ReturnsClaimsTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()

  const { data, loading, refresh } = useReport<Resp>(async () => {
    return api<Resp>(`/api/reports/returns-claims?userId=${user!.id}&from=${range.from}&to=${range.to}`)
  }, [user?.id, range.from, range.to])

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

  return (
    <div className="space-y-3">
      <FilterBar
        range={range} setRange={setRange} preset={preset} setPreset={setPreset}
        onRefresh={refresh} loading={loading}
      />
      {data && (
        <KpiRow
          items={[
            { label: 'Returns (Period)', value: String(data.summary.returnsCount), sub: `Approved Rs ${fmt0(data.summary.approvedValue)}`, tone: 'red' },
            { label: 'Pending Returns', value: String(data.summary.pendingCount), sub: `Rs ${fmt0(data.summary.pendingValue)}`, tone: 'amber' },
            { label: 'Return Rate', value: `${data.summary.returnRatePct}%`, sub: `Sales Rs ${fmt0(data.summary.totalSales)}`, tone: data.summary.returnRatePct > 10 ? 'red' : 'slate' },
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
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
