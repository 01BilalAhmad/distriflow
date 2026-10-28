'use client'

// Task 66 — Sales & Profit tab (product / booker / company breakdown)

import { useMemo, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, useFilterOptions, ReportEmptyGate, fmtMoney, rangeLabel, type Col,
} from './reports-kit'

interface ProdRow extends Record<string, unknown> {
  productName: string; sku: string; company: string; qtySold: number; freeQty: number; retQty: number
  grossSales: number; discountTotal: number; tradeOfferTotal: number; netSales: number; returnsValue: number
  netAfterReturns: number; unitCost: number; cogs: number; profitSelf: number; claimPotential: number
  profitWithClaim: number; marginPct: number
}
interface BookerRow extends Record<string, unknown> {
  bookerName: string; orders: number; shops: number; grossSales: number; discountTotal: number
  tradeOfferTotal: number; netSales: number; cogs: number; profitSelf: number; claimPotential: number
  profitWithClaim: number; marginPct: number
}
interface CompanyRow extends Record<string, unknown> {
  company: string; grossSales: number; discountTotal: number; tradeOfferTotal: number; netSales: number
  returnsValue: number; netAfterReturns: number; cogs: number; profitSelf: number; claimPotential: number
  profitWithClaim: number; marginPct: number
}
interface Resp extends Record<string, unknown> {
  summary: { grossSales: number; discountTotal: number; tradeOfferTotal: number; netSales: number; returnsValue: number; netAfterReturns: number; cogs: number; profitSelf: number; claimPotential: number; profitWithClaim: number; orders: number; products: number }
  productWise: ProdRow[]; bookerWise: BookerRow[]; companyWise: CompanyRow[]
}

const VIEW = ['product', 'booker', 'company'] as const

export function SalesProfitTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()
  const [booker, setBooker] = useState('')
  const [company, setCompany] = useState('')
  const [view, setView] = useState<(typeof VIEW)[number]>('product')
  const fopts = useFilterOptions(user?.id)

  // Task 74 — filter-first: data sirf "Report Load Karein" par load hota hai
  const gate = useReportGate<Resp>({
    fetcher: async () => {
      const p = new URLSearchParams({ userId: user!.id, from: range.from, to: range.to })
      if (booker) p.set('bookerId', booker)
      if (company) p.set('companyId', company)
      return api<Resp>(`/api/reports/sales-profit?${p}`)
    },
    filtersKey: `${range.from}|${range.to}|${booker}|${company}`,
  })
  const { data, loading } = gate

  const s = data?.summary
  const cols: Record<string, Col<ProdRow>[] | Col<BookerRow>[] | Col<CompanyRow>[]> = useMemo(() => ({
    product: [
      { key: 'productName', label: 'Product', render: (r) => <span><span className="font-semibold text-slate-800">{r.productName}</span><span className="ml-1.5 text-[10px] text-slate-400">{r.sku}</span></span> },
      { key: 'company', label: 'Company' },
      { key: 'qtySold', label: 'Qty (Pcs)', align: 'right', total: true },
      { key: 'freeQty', label: 'Free', align: 'right', total: true, cls: 'text-emerald-600' },
      { key: 'retQty', label: 'Ret Pcs', align: 'right', total: true, cls: 'text-red-500' },
      { key: 'grossSales', label: 'Gross Sales', align: 'right', money: true, total: true },
      { key: 'discountTotal', label: 'Scheme/Discount', align: 'right', money: true, total: true, cls: 'text-amber-600' },
      { key: 'netSales', label: 'Net Sales', align: 'right', money: true, total: true },
      { key: 'returnsValue', label: 'Returns', align: 'right', money: true, total: true, cls: 'text-red-500' },
      { key: 'netAfterReturns', label: 'Net (after Ret)', align: 'right', money: true, total: true },
      { key: 'unitCost', label: 'Cost/pc', align: 'right', money: true },
      { key: 'cogs', label: 'COGS', align: 'right', money: true, total: true },
      { key: 'profitSelf', label: 'Profit (Self)', align: 'right', money: true, total: true, cls: 'font-bold text-emerald-700' },
      { key: 'claimPotential', label: 'Claim Potential', align: 'right', money: true, total: true, cls: 'text-blue-600' },
      { key: 'profitWithClaim', label: 'Profit (If Claimed)', align: 'right', money: true, total: true, cls: 'font-bold text-teal-700' },
      { key: 'marginPct', label: 'Margin %', align: 'right', render: (r) => `${r.marginPct.toFixed(1)}%` },
    ] as Col<ProdRow>[],
    booker: [
      { key: 'bookerName', label: 'Order Booker', render: (r: BookerRow) => <span className="font-semibold text-slate-800">{r.bookerName}</span> },
      { key: 'orders', label: 'Orders', align: 'right', total: true },
      { key: 'shops', label: 'Shops', align: 'right', total: true },
      { key: 'grossSales', label: 'Gross Sales', align: 'right', money: true, total: true },
      { key: 'discountTotal', label: 'Scheme/Discount', align: 'right', money: true, total: true, cls: 'text-amber-600' },
      { key: 'netSales', label: 'Net Sales', align: 'right', money: true, total: true },
      { key: 'cogs', label: 'COGS', align: 'right', money: true, total: true },
      { key: 'profitSelf', label: 'Profit (Self)', align: 'right', money: true, total: true, cls: 'font-bold text-emerald-700' },
      { key: 'claimPotential', label: 'Claim Potential', align: 'right', money: true, total: true, cls: 'text-blue-600' },
      { key: 'profitWithClaim', label: 'Profit (If Claimed)', align: 'right', money: true, total: true, cls: 'font-bold text-teal-700' },
      { key: 'marginPct', label: 'Margin %', align: 'right', render: (r: BookerRow) => `${r.marginPct.toFixed(1)}%` },
    ] as Col<BookerRow>[],
    company: [
      { key: 'company', label: 'Company', render: (r: CompanyRow) => <span className="font-semibold text-slate-800">{r.company}</span> },
      { key: 'grossSales', label: 'Gross Sales', align: 'right', money: true, total: true },
      { key: 'discountTotal', label: 'Scheme/Discount', align: 'right', money: true, total: true, cls: 'text-amber-600' },
      { key: 'netSales', label: 'Net Sales', align: 'right', money: true, total: true },
      { key: 'returnsValue', label: 'Returns', align: 'right', money: true, total: true, cls: 'text-red-500' },
      { key: 'netAfterReturns', label: 'Net (after Ret)', align: 'right', money: true, total: true },
      { key: 'cogs', label: 'COGS', align: 'right', money: true, total: true },
      { key: 'profitSelf', label: 'Profit (Self)', align: 'right', money: true, total: true, cls: 'font-bold text-emerald-700' },
      { key: 'claimPotential', label: 'Claim Potential', align: 'right', money: true, total: true, cls: 'text-blue-600' },
      { key: 'profitWithClaim', label: 'Profit (If Claimed)', align: 'right', money: true, total: true, cls: 'font-bold text-teal-700' },
      { key: 'marginPct', label: 'Margin %', align: 'right', render: (r: CompanyRow) => `${r.marginPct.toFixed(1)}%` },
    ] as Col<CompanyRow>[],
  }), [])

  const rows = view === 'product' ? (data?.productWise ?? []) : view === 'booker' ? (data?.bookerWise ?? []) : (data?.companyWise ?? [])
  const curCols = cols[view] as Col<Record<string, unknown>>[]

  // Task 69: ek hi export opts — Excel + PDF + CSV + Print sab isi se bante hain
  const exportOpts = {
    title: 'Sales & Profit Report',
    subtitle: `View: ${view.toUpperCase()}${booker ? ' • Filtered' : ''}`,
    distributor: user?.profile?.businessName ?? '—',
    period: rangeLabel(range),
    filename: `sales-profit-${view}-${range.from}_${range.to}`,
    cols: curCols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
    rows: rows.map((r) => curCols.map((c) => ((r as Record<string, unknown>)[c.key] ?? '') as string | number)),
    totalsRow: curCols.map((c, i) => (i === 0 ? 'TOTAL' : c.total ? fmtTotal(rows as Record<string, unknown>[], c.key) : '')),
    footerNote: 'NET vs NET: Net Sales = gross − discounts − trade offer • COGS = purchase net − trade offer (weighted avg) • Free units ki cost included • Returns net effect included',
  }

  return (
    <div className="space-y-3">
      <FilterBar
        range={range} setRange={setRange} preset={preset} setPreset={setPreset}
        booker={booker} setBooker={setBooker} bookers={fopts.bookers}
        company={company} setCompany={setCompany} companies={fopts.companies}
        onRefresh={gate.load} loading={loading} armed={gate.armed} stale={gate.stale}
      />
      {!gate.armed ? (
        <ReportEmptyGate
          icon={TrendingUp}
          title="Sales & Profit Report"
          desc="Product, booker aur company wise breakdown — gross/net sales, scheme discount, COGS, profit (self) aur claim potential ke sath."
          steps={[
            'Date range select karein — preset ya custom',
            'Order booker / company filter chunein (optional)',
            "'Report Load Karein' dabayen — sirf selected data load hoga",
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
      <>
      {s && (
        <KpiRow
          items={[
            { label: 'Net Sales', value: `Rs ${fmt(s.netSales)}`, sub: `${s.orders} orders • ${s.products} products`, tone: 'emerald' },
            { label: 'Gross Sales', value: `Rs ${fmt(s.grossSales)}`, sub: 'Return se pehle', tone: 'blue' },
            { label: 'Scheme/Discount', value: `Rs ${fmt(s.discountTotal)}`, sub: `Trade offer Rs ${fmt(s.tradeOfferTotal)}`, tone: 'amber' },
            { label: 'COGS (cost)', value: `Rs ${fmt(s.cogs)}`, sub: 'Weighted avg purchase cost', tone: 'slate' },
            { label: 'Profit (Self)', value: `Rs ${fmt(s.profitSelf)}`, sub: `Margin ${s.netSales > 0 ? ((s.profitSelf / s.netSales) * 100).toFixed(1) : 0}%`, tone: 'emerald' },
            { label: 'Profit (If Claimed)', value: `Rs ${fmt(s.profitWithClaim)}`, sub: `Claim potential Rs ${fmt(s.claimPotential)}`, tone: 'blue' },
          ]}
        />
      )}
      <SectionCard
        title="Breakdown"
        right={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {VIEW.map((v) => (
                <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize transition-colors ${view === v ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-emerald-700'}`}>
                  {v === 'product' ? 'Product-wise' : v === 'booker' ? 'Booker-wise' : 'Company-wise'}
                </button>
              ))}
            </div>
            <ExportButtons opts={exportOpts} />
          </div>
        }
      >
        <DataTable cols={curCols} rows={rows} />
      </SectionCard>
      <p className="text-[11px] text-slate-400">
        Profit (Self) = Net Sales (returns ke baad) − COGS — scheme cost aap khud bear karte ho.
        Profit (If Claimed) = Profit (Self) + scheme/discount + trade offer — agar company claim de.
        COGS = (qty + free − returns) × weighted-avg purchase cost/pc.
      </p>
      </>
      )}
    </div>
  )
}

function fmt(n: number): string {
  return n.toLocaleString('en-PK', { maximumFractionDigits: 0 })
}
function fmtTotal(rows: Record<string, unknown>[], key: string): string {
  const s = rows.reduce((t, r) => t + (Number(r[key]) || 0), 0)
  return Math.abs(s % 1) > 0.001 ? fmtMoney(s) : fmt(s)
}
