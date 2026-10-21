'use client'

// Task 86 — SKU Profit tab — har SKU ka seedha profit hisaab:
// Kitny ka Aya (cost) | Kitny ka Sale Kia (sale) | Kitna Profit | Kitny % (margin)

import { useMemo, useState } from 'react'
import { Coins } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, useFilterOptions, ReportEmptyGate, fmtMoney, rangeLabel, type Col,
} from './reports-kit'

interface Row extends Record<string, unknown> {
  productName: string; sku: string; company: string
  qtySold: number; freeQty: number; retQty: number
  costRate: number; saleRate: number; costCtn: number; saleCtn: number
  costTotal: number; saleTotal: number; profit: number; marginPct: number
}
interface Resp extends Record<string, unknown> {
  summary: {
    costTotal: number; saleTotal: number; profit: number; marginPct: number
    qtySold: number; freeQty: number; retQty: number; orders: number; skus: number
  }
  rows: Row[]
}

export function SkuProfitTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()
  const fopts = useFilterOptions(user?.id)
  // Task 86: booker/company filter bhi — kisi ek booker ya company ka profit alag dekhna ho
  const [booker, setBooker] = useState('')
  const [company, setCompany] = useState('')

  const gate = useReportGate<Resp>({
    fetcher: async () => {
      const p = new URLSearchParams({ userId: user!.id, from: range.from, to: range.to })
      if (booker) p.set('bookerId', booker)
      if (company) p.set('companyId', company)
      return api<Resp>(`/api/reports/sku-profit?${p}`)
    },
    filtersKey: `${range.from}|${range.to}|${booker}|${company}`,
  })
  const { data, loading } = gate

  const s = data?.summary
  const cols: Col<Row>[] = useMemo(() => [
    { key: 'productName', label: 'Product (SKU)', render: (r) => <span><span className="font-semibold text-slate-800">{r.productName}</span><span className="ml-1.5 text-[10px] text-slate-400">{r.sku}</span></span> },
    { key: 'company', label: 'Company' },
    { key: 'qtySold', label: 'Qty (Pcs)', align: 'right', total: true },
    { key: 'freeQty', label: 'Free', align: 'right', total: true, cls: 'text-emerald-600' },
    { key: 'retQty', label: 'Ret Pcs', align: 'right', total: true, cls: 'text-red-500' },
    { key: 'costRate', label: 'Cost/pc', align: 'right', money: true },
    { key: 'saleRate', label: 'Sale/pc', align: 'right', money: true },
    { key: 'costTotal', label: 'Kitny ka Aya (Cost)', align: 'right', money: true, total: true, cls: 'text-rose-700' },
    { key: 'saleTotal', label: 'Kitny ka Sale (Bikri)', align: 'right', money: true, total: true },
    { key: 'profit', label: 'Profit', align: 'right', money: true, total: true, render: (r) => <span className={r.profit < 0 ? 'font-bold text-red-600' : 'font-bold text-emerald-700'}>{fmtMoney(r.profit)}</span> },
    { key: 'marginPct', label: 'Margin %', align: 'right', render: (r) => <span className={r.marginPct < 0 ? 'font-semibold text-red-600' : r.marginPct >= 15 ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-600'}>{r.marginPct.toFixed(1)}%</span> },
  ], [])

  const rows = data?.rows ?? []

  const exportOpts = {
    title: 'SKU Profit Report',
    subtitle: 'Cost vs Sale vs Profit — har SKU wise',
    distributor: user?.profile?.businessName ?? '—',
    period: rangeLabel(range),
    filename: `sku-profit-${range.from}_${range.to}`,
    cols: cols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
    rows: rows.map((r) => cols.map((c) => ((r as Record<string, unknown>)[c.key] ?? '') as string | number)),
    totalsRow: cols.map((c, i) => {
      if (i === 0) return 'TOTAL'
      if (!c.total) return ''
      const sum = rows.reduce((t, r) => t + (Number((r as Record<string, unknown>)[c.key]) || 0), 0)
      return c.money ? fmtMoney(sum) : String(sum)
    }),
    footerNote: 'Cost = weighted-avg purchase cost (free units included, returns minus) • Sale = net billing (discounts + returns minus) • Margin % = Profit ÷ Sale × 100',
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
          icon={Coins}
          title="SKU Profit Report"
          desc="Har SKU ka seedha profit hisaab — kitny ka maal aya, kitny ki bikri hui, kitna profit bana aur kitny percentage margin bachi."
          steps={[
            'Date range select karein — preset ya custom',
            "'Report Load Karein' dabayen — SKU wise profit table ban jayega",
            'Excel / PDF / CSV download ya print — sab mojood hai',
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
      <>
      {s && (
        <KpiRow
          items={[
            { label: 'Total Sale (Bikri)', value: `Rs ${fmtMoney(s.saleTotal)}`, sub: `${s.orders} orders • ${s.skus} SKUs`, tone: 'blue' },
            { label: 'Total Cost (Aya)', value: `Rs ${fmtMoney(s.costTotal)}`, sub: `${s.qtySold.toLocaleString()} pcs • free ${s.freeQty.toLocaleString()}`, tone: 'amber' },
            { label: 'Total Profit', value: `Rs ${fmtMoney(s.profit)}`, sub: 'Sale − Cost (returns minus)', tone: s.profit >= 0 ? 'emerald' : 'red' },
            { label: 'Margin %', value: `${s.marginPct.toFixed(1)}%`, sub: 'Profit ÷ Sale × 100', tone: s.marginPct >= 15 ? 'emerald' : s.marginPct > 0 ? 'amber' : 'red' },
          ]}
        />
      )}
      <SectionCard
        title="SKU-wise Profit"
        right={<ExportButtons opts={exportOpts} />}
      >
        <DataTable cols={cols} rows={rows} />
      </SectionCard>
      <p className="text-[11px] text-slate-400">
        <b>Kitny ka Aya (Cost)</b> = jo maal becha (qty + free − returns) uski weighted-average purchase cost — free units ki cost bhi aap ne uthai thi.
        <b> Kitny ka Sale</b> = net billing (scheme/manual discount minus) aur approved returns minus.
        <b> Margin %</b> = Profit ÷ Sale × 100 — 15% se upar emerald (healthy), 0–15% amber (patla), negative red (nuqsaan).
      </p>
      </>
      )}
    </div>
  )
}
