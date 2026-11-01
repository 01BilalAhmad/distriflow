'use client'

// Task 66 — Stock Report tab (value + low stock + slow-moving + expiring)

import { useState } from 'react'
import { Boxes } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  KpiRow, DataTable, SectionCard, ExportButtons, useReportGate, ReportEmptyGate, GateRefreshButton,
  type ReportExportOpts, fmtDay, type Col,
} from './reports-kit'

interface StockRow extends Record<string, unknown> {
  productName: string; sku: string; company: string; qtyUnits: number; qtyCtns: number
  unitCost: number; costValue: number; tradeValue: number
  expSoonQty: number; expSoonDate: string | null
  lastSoldDate: string | null; daysSinceSold: number | null
  // Task 131 — velocity + reorder
  soldVelDays: number; avgDaily: number; coverDays: number | null; suggestedUnits: number; suggestedCtns: number
}
interface Resp extends Record<string, unknown> {
  params: { lowCtns: number; slowDays: number; expDays: number; velDays: number; reorderDays: number }
  summary: { skus: number; inStockSkus: number; outOfStockSkus: number; totalCostValue: number; totalTradeValue: number; lowCount: number; slowCount: number; expCount: number; expQtyValue: number; reorderSkus: number; reorderUnits: number; reorderCostValue: number }
  stock: StockRow[]; lowStock: StockRow[]; slowMoving: StockRow[]; expiring: StockRow[]; outOfStock: StockRow[]
  reorder: StockRow[]
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
  // Task 131 — reorder params
  const [velDays, setVelDays] = useState(30)
  const [reorderDays, setReorderDays] = useState(14)

  // Task 74 — filter-first: data sirf "Report Load Karein" par load hota hai
  const gate = useReportGate<Resp>({
    fetcher: async () => {
      return api<Resp>(`/api/reports/stock?userId=${user!.id}&lowCtns=${lowCtns}&slowDays=${slowDays}&expDays=${expDays}&velDays=${velDays}&reorderDays=${reorderDays}`)
    },
    filtersKey: `${lowCtns}|${slowDays}|${expDays}|${velDays}|${reorderDays}`,
  })
  const { data, loading } = gate

  const sel = 'h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700'
  // Task 69: har section ka apna export opts — Excel + PDF + CSV + Print
  const exportSection = (heading: string, rows: StockRow[], extraCols: Col<StockRow>[] = []): ReportExportOpts => {
    const ec = [...COLS, ...extraCols]
    return {
      title: `Stock Report — ${heading}`,
      distributor: user?.profile?.businessName ?? '—',
      period: `Thresholds: low ≤ ${lowCtns} ctn, slow ≥ ${slowDays} din, expiry ≤ ${expDays} din`,
      filename: `stock-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      cols: ec.map((c) => ({ label: c.label, align: c.align, money: c.money })),
      rows: rows.map((r) => ec.map((c): string | number => c.key === 'lastSoldDate' ? (r.lastSoldDate ? fmtDay(r.lastSoldDate) : 'Kabhi nahi') : c.key === 'expSoonDate' ? (r.expSoonDate ? fmtDay(r.expSoonDate) : '—') : ((r as Record<string, unknown>)[c.key] ?? '') as string | number)),
      totalsRow: ec.map((c) => {
        if (c.key === 'productName') return 'TOTAL'
        if (c.key === 'qtyUnits') return rows.reduce((t, r) => t + r.qtyUnits, 0)
        if (c.key === 'costValue') return rows.reduce((t, r) => t + r.costValue, 0)
        if (c.key === 'tradeValue') return rows.reduce((t, r) => t + r.tradeValue, 0)
        if (c.key === 'expSoonQty') return rows.reduce((t, r) => t + r.expSoonQty, 0)
        return ''
      }),
    }
  }

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
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          Velocity <input type="number" min={7} value={velDays} onChange={(e) => setVelDays(Math.max(7, Number(e.target.value)))} className={`${sel} w-16`} /> din
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          Reorder cover <input type="number" min={1} value={reorderDays} onChange={(e) => setReorderDays(Math.max(1, Number(e.target.value)))} className={`${sel} w-16`} /> din
        </label>
        <GateRefreshButton armed={gate.armed} stale={gate.stale} loading={loading} onClick={gate.load} />
      </div>
      {!gate.armed ? (
        <ReportEmptyGate
          icon={Boxes}
          title="Stock Report (Value + Alerts)"
          desc="Product-wise stock value (cost/trade), low stock, slow-moving, expiring soon aur out-of-stock SKUs — sab thresholds aap set karte hain."
          steps={[
            'Thresholds set karein — low cartons, slow din, expiry din',
            "'Report Load Karein' dabayen — sirf selected thresholds par stock load hoga",
            'Har section ka alag Excel/PDF/Print mojood hai',
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
      <>
      {data && (
        <KpiRow
          items={[
            { label: 'Stock Value (Cost)', value: `Rs ${fmt0(data.summary.totalCostValue)}`, sub: `${data.summary.inStockSkus} SKUs in stock`, tone: 'emerald' },
            { label: 'Stock Value (Trade)', value: `Rs ${fmt0(data.summary.totalTradeValue)}`, sub: `Margin potential Rs ${fmt0(data.summary.totalTradeValue - data.summary.totalCostValue)}`, tone: 'blue' },
            { label: 'Low Stock SKUs', value: String(data.summary.lowCount), sub: `≤ ${lowCtns} carton`, tone: 'amber' },
            { label: 'Slow Moving', value: String(data.summary.slowCount), sub: `${slowDays}+ din se nahi bika`, tone: 'slate' },
            { label: 'Expiring Soon', value: String(data.summary.expCount), sub: `Rs ${fmt0(data.summary.expQtyValue)} cost at risk`, tone: 'red' },
            { label: 'Out of Stock', value: String(data.summary.outOfStockSkus), sub: `${data.summary.skus} total SKUs`, tone: 'red' },
            { label: 'Reorder Suggestions', value: String(data.summary.reorderSkus), sub: `${fmt0(data.summary.reorderUnits)} pcs — Rs ${fmt0(data.summary.reorderCostValue)} cost`, tone: 'blue' },
          ]}
        />
      )}
      <SectionCard
        title="Product-wise Stock"
        right={<ExportButtons opts={exportSection('Full Stock', data?.stock ?? [])} />}
      >
        <DataTable cols={COLS} rows={data?.stock ?? []} empty="Stock khaali hai" />
      </SectionCard>
      {(data?.lowStock.length ?? 0) > 0 && (
        <SectionCard title={`⚠ Low Stock (≤ ${lowCtns} carton)`} right={<ExportButtons opts={exportSection('Low Stock', data!.lowStock)} />}>
          <DataTable cols={COLS} rows={data!.lowStock} maxH="max-h-[35vh]" />
        </SectionCard>
      )}
      {(data?.slowMoving.length ?? 0) > 0 && (
        <SectionCard title={`🐢 Slow Moving (${slowDays}+ din se nahi bika)`} right={<ExportButtons opts={exportSection('Slow Moving', data!.slowMoving)} />}>
          <DataTable cols={COLS} rows={data!.slowMoving} maxH="max-h-[35vh]" />
        </SectionCard>
      )}
      {(data?.expiring.length ?? 0) > 0 && (
        <SectionCard title={`⏳ Expiring Soon (≤ ${expDays} din)`} right={<ExportButtons opts={exportSection('Expiring Soon', data!.expiring, EXPIRY_COLS)} />}>
          <DataTable
            cols={[...COLS, ...EXPIRY_COLS] as Col<StockRow>[]}
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
      {/* Task 131 — reorder suggestions */}
      {(data?.reorder.length ?? 0) > 0 && (
        <SectionCard
          title={`🛒 Reorder Suggestions (velocity ${velDays}d • cover ${reorderDays}d)`}
          right={<ExportButtons opts={{
            title: `Stock Report — Reorder Suggestions`,
            distributor: user?.profile?.businessName ?? '—',
            period: `Sale velocity last ${velDays} din • cover target ${reorderDays} din`,
            filename: 'stock-reorder-suggestions',
            cols: reorderCols(velDays).map((c) => ({ label: c.label, align: c.align, money: c.money })),
            rows: data!.reorder.map((r) => [r.productName, r.sku, r.company, r.qtyUnits, r.soldVelDays, r.avgDaily, r.coverDays ?? '—', r.suggestedUnits, r.suggestedCtns, r2(r.suggestedUnits * r.unitCost)]),
            totalsRow: ['TOTAL', '', '', data!.reorder.reduce((t, r) => t + r.qtyUnits, 0), data!.reorder.reduce((t, r) => t + r.soldVelDays, 0), '', '', data!.reorder.reduce((t, r) => t + r.suggestedUnits, 0), data!.reorder.reduce((t, r) => t + r.suggestedCtns, 0), r2(data!.reorder.reduce((t, r) => t + r.suggestedUnits * r.unitCost, 0))],
          }} />}
        >
          <DataTable cols={reorderCols(velDays) as Col<StockRow>[]} rows={data!.reorder} maxH="max-h-[40vh]" />
        </SectionCard>
      )}
      </>
      )}
    </div>
  )
}

// Expiring section ke 2 extra columns (table + export dono use karte hain)
const EXPIRY_COLS: Col<StockRow>[] = [
  { key: 'expSoonDate', label: 'Nearest Expiry', align: 'right', render: (r) => r.expSoonDate ? fmtDay(r.expSoonDate) : '—' },
  { key: 'expSoonQty', label: 'At Risk (Pcs)', align: 'right', total: true, cls: 'text-red-500' },
]

// Task 131 — reorder section columns (velocity window label ke liye function)
function reorderCols(velDays: number): Col<StockRow>[] {
  return [
    { key: 'productName', label: 'Product', render: (r) => <span><span className="font-semibold text-slate-800">{r.productName}</span><span className="ml-1.5 text-[10px] text-slate-400">{r.sku}</span></span> },
    { key: 'company', label: 'Company' },
    { key: 'qtyUnits', label: 'Stock (Pcs)', align: 'right', total: true },
    { key: 'soldVelDays', label: `Sold (${velDays}d)`, align: 'right', total: true },
    { key: 'avgDaily', label: 'Avg/Din', align: 'right' },
    { key: 'coverDays', label: 'Cover (din)', align: 'right', render: (r) => (r.coverDays == null ? '∞' : r.coverDays) },
    { key: 'suggestedUnits', label: 'Mangwao (Pcs)', align: 'right', total: true, cls: 'font-bold text-emerald-700' },
    { key: 'suggestedCtns', label: 'Mangwao (Ctn)', align: 'right', total: true },
    { key: 'estCost', label: 'Est. Cost', align: 'right', money: true, total: true, render: (r) => r2(r.suggestedUnits * r.unitCost) },
  ]
}

function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
