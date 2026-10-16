'use client'

// Task 66 — Stock Report tab (value + low stock + slow-moving + expiring)

import { useState } from 'react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  KpiRow, DataTable, SectionCard, CSVButton, PrintButton, downloadCSV, printReport, useReport,
  fmtMoney, fmtDay, type Col,
} from './reports-kit'

interface StockRow extends Record<string, unknown> {
  productName: string; sku: string; company: string; qtyUnits: number; qtyCtns: number
  unitCost: number; costValue: number; tradeValue: number
  expSoonQty: number; expSoonDate: string | null
  lastSoldDate: string | null; daysSinceSold: number | null
}
interface Resp extends Record<string, unknown> {
  params: { lowCtns: number; slowDays: number; expDays: number }
  summary: { skus: number; inStockSkus: number; outOfStockSkus: number; totalCostValue: number; totalTradeValue: number; lowCount: number; slowCount: number; expCount: number; expQtyValue: number }
  stock: StockRow[]; lowStock: StockRow[]; slowMoving: StockRow[]; expiring: StockRow[]; outOfStock: StockRow[]
}

const COLS: Col<StockRow>[] = [
  { key: 'productName', label: 'Product', render: (r) => <span><span className="font-semibold text-slate-800">{r.productName}</span><span className="ml-1.5 text-[10px] text-slate-400">{r.sku}</span></span> },
  { key: 'company', label: 'Company' },
  { key: 'qtyCtns', label: 'Qty (Ctn)', align: 'right', total: true },
  { key: 'qtyUnits', label: 'Qty (Pcs)', align: 'right', total: true },
  { key: 'unitCost', label: 'Cost/pc', align: 'right', money: true },
  { key: 'costValue', label: 'Cost Value', align: 'right', money: true, total: true, cls: 'font-semibold' },
  { key: 'tradeValue', label: 'Trade Value', align: 'right', money: true, total: true },
  { key: 'lastSoldDate', label: 'Last Sold', align: 'right', render: (r) => r.lastSoldDate ? fmtDay(r.lastSoldDate) : <span className="text-amber-600">Kabhi nahi</span> },
]

export function StockTab() {
  const { user } = useDMS()
  const [lowCtns, setLowCtns] = useState(5)
  const [slowDays, setSlowDays] = useState(30)
  const [expDays, setExpDays] = useState(60)

  const { data, loading, refresh } = useReport<Resp>(async () => {
    return api<Resp>(`/api/reports/stock?userId=${user!.id}&lowCtns=${lowCtns}&slowDays=${slowDays}&expDays=${expDays}`)
  }, [user?.id, lowCtns, slowDays, expDays])

  const sel = 'h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700'
  const printSection = (heading: string, rows: StockRow[]) => printReport({
    title: `Stock Report — ${heading}`,
    distributor: user?.profile?.businessName ?? '—',
    period: `Thresholds: low ≤ ${lowCtns} ctn, slow ≥ ${slowDays} din, expiry ≤ ${expDays} din`,
    cols: COLS.map((c) => ({ label: c.label, align: c.align })),
    rows: rows.map((r) => [r.productName, r.company, r.qtyCtns, r.qtyUnits, r.unitCost, r.costValue, r.tradeValue, r.lastSoldDate ? fmtDay(r.lastSoldDate) : 'Kabhi nahi']),
    totalsRow: ['TOTAL', '', '', rows.reduce((t, r) => t + r.qtyUnits, 0), '', rows.reduce((t, r) => t + r.costValue, 0), rows.reduce((t, r) => t + r.tradeValue, 0), ''],
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white/80 p-2.5 shadow-sm">
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          Low ≤ <input type="number" min={1} value={lowCtns} onChange={(e) => setLowCtns(Math.max(1, Number(e.target.value)))} className={`${sel} w-16`} /> Ctn
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          Slow ≥ <input type="number" min={1} value={slowDays} onChange={(e) => setSlowDays(Math.max(1, Number(e.target.value)))} className={`${sel} w-16`} /> din
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          Expiry ≤ <input type="number" min={1} value={expDays} onChange={(e) => setExpDays(Math.max(1, Number(e.target.value)))} className={`${sel} w-16`} /> din
        </label>
        <button onClick={refresh} disabled={loading} className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          Refresh
        </button>
      </div>
      {data && (
        <KpiRow
          items={[
            { label: 'Stock Value (Cost)', value: `Rs ${fmt0(data.summary.totalCostValue)}`, sub: `${data.summary.inStockSkus} SKUs in stock`, tone: 'emerald' },
            { label: 'Stock Value (Trade)', value: `Rs ${fmt0(data.summary.totalTradeValue)}`, sub: `Margin potential Rs ${fmt0(data.summary.totalTradeValue - data.summary.totalCostValue)}`, tone: 'blue' },
            { label: 'Low Stock SKUs', value: String(data.summary.lowCount), sub: `≤ ${lowCtns} carton`, tone: 'amber' },
            { label: 'Slow Moving', value: String(data.summary.slowCount), sub: `${slowDays}+ din se nahi bika`, tone: 'slate' },
            { label: 'Expiring Soon', value: String(data.summary.expCount), sub: `Rs ${fmt0(data.summary.expQtyValue)} cost at risk`, tone: 'red' },
            { label: 'Out of Stock', value: String(data.summary.outOfStockSkus), sub: `${data.summary.skus} total SKUs`, tone: 'red' },
          ]}
        />
      )}
      <SectionCard
        title="Product-wise Stock"
        right={<CSVButton onClick={() => downloadCSV('stock-report', COLS.map((c) => c.label), (data?.stock ?? []).map((r) => [r.productName, r.company, r.qtyCtns, r.qtyUnits, r.unitCost, r.costValue, r.tradeValue, r.lastSoldDate ?? '']))} />}
      >
        <DataTable cols={COLS} rows={data?.stock ?? []} empty="Stock khaali hai" />
      </SectionCard>
      {(data?.lowStock.length ?? 0) > 0 && (
        <SectionCard title={`⚠ Low Stock (≤ ${lowCtns} carton)`} right={<PrintButton onClick={() => printSection('Low Stock', data!.lowStock)} />}>
          <DataTable cols={COLS} rows={data!.lowStock} maxH="max-h-[35vh]" />
        </SectionCard>
      )}
      {(data?.slowMoving.length ?? 0) > 0 && (
        <SectionCard title={`🐢 Slow Moving (${slowDays}+ din se nahi bika)`} right={<PrintButton onClick={() => printSection('Slow Moving', data!.slowMoving)} />}>
          <DataTable cols={COLS} rows={data!.slowMoving} maxH="max-h-[35vh]" />
        </SectionCard>
      )}
      {(data?.expiring.length ?? 0) > 0 && (
        <SectionCard title={`⏳ Expiring Soon (≤ ${expDays} din)`} right={<PrintButton onClick={() => printSection('Expiring Soon', data!.expiring)} />}>
          <DataTable
            cols={[...COLS, { key: 'expSoonDate', label: 'Nearest Expiry', align: 'right', render: (r: StockRow) => r.expSoonDate ? fmtDay(r.expSoonDate) : '—' }, { key: 'expSoonQty', label: 'At Risk (Pcs)', align: 'right', total: true, cls: 'text-red-500' }] as Col<StockRow>[]}
            rows={data!.expiring}
            maxH="max-h-[35vh]"
          />
        </SectionCard>
      )}
      {(data?.outOfStock.length ?? 0) > 0 && (
        <SectionCard title="❌ Out of Stock">
          <DataTable cols={COLS} rows={data!.outOfStock} maxH="max-h-[30vh]" />
        </SectionCard>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
