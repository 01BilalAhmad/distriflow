'use client'

// Task 131 — FILL RATE (Order vs Delivery) — shop ne kitna manga vs kitna mila:
// product-wise supply gap + order-wise fill %, perfect orders, short SKUs.

import { useState } from 'react'
import { PackageCheck } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, useFilterOptions, ReportEmptyGate, fmtDay, rangeLabel, fmtQty, type Col,
} from './reports-kit'

interface PRow extends Record<string, unknown> {
  productName: string; sku: string; company: string; orderedUnits: number; deliveredUnits: number; shortUnits: number; fillPct: number
}
interface ORow extends Record<string, unknown> {
  orderNo: string; date: string; shop: string; city: string; booker: string
  bookedUnits: number; deliveredUnits: number; bookedValue: number; deliveredValue: number; fillPct: number; status: string
}
interface Resp extends Record<string, unknown> {
  summary: { orders: number; perfectOrders: number; orderedUnits: number; deliveredUnits: number; fillPctUnits: number; bookedValue: number; deliveredValue: number; fillPctValue: number; shortSkus: number }
  products: PRow[]
  orders: ORow[]
}

function fillCls(pct: number): string {
  if (pct >= 95) return 'bg-emerald-50 text-emerald-700'
  if (pct >= 70) return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-700'
}

export function FillRateTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()
  const [booker, setBooker] = useState('')
  const [city, setCity] = useState('')
  const fopts = useFilterOptions(user?.id)

  const gate = useReportGate<Resp>({
    fetcher: async () => {
      const p = new URLSearchParams({ userId: user!.id, from: range.from, to: range.to })
      if (booker) p.set('bookerId', booker)
      if (city) p.set('city', city)
      return api<Resp>(`/api/reports/fill-rate?${p}`)
    },
    filtersKey: `${range.from}|${range.to}|${booker}|${city}`,
  })
  const { data, loading } = gate

  const pcols: Col<PRow>[] = [
    { key: 'productName', label: 'Product' },
    { key: 'sku', label: 'SKU' },
    { key: 'company', label: 'Company' },
    { key: 'orderedUnits', label: 'Manga (pcs)', align: 'right', total: true },
    { key: 'deliveredUnits', label: 'Mila (pcs)', align: 'right', total: true, cls: 'text-emerald-700' },
    { key: 'shortUnits', label: 'Kami (pcs)', align: 'right', total: true, cls: 'text-red-600' },
    { key: 'fillPct', label: 'Fill %', align: 'right', render: (r) => (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${fillCls(r.fillPct)}`}>{r.fillPct}%</span>
    ) },
  ]

  const ocols: Col<ORow>[] = [
    { key: 'orderNo', label: 'Order #' },
    { key: 'date', label: 'Date', render: (r) => fmtDay(r.date) },
    { key: 'shop', label: 'Shop' },
    { key: 'booker', label: 'Booker' },
    { key: 'bookedUnits', label: 'Manga (pcs)', align: 'right', total: true },
    { key: 'deliveredUnits', label: 'Mila (pcs)', align: 'right', total: true },
    { key: 'bookedValue', label: 'Order Value', align: 'right', money: true, total: true },
    { key: 'deliveredValue', label: 'Delivered Value', align: 'right', money: true, total: true, cls: 'text-emerald-700' },
    { key: 'fillPct', label: 'Fill %', align: 'right', render: (r) => (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${fillCls(r.fillPct)}`}>{r.fillPct}%</span>
    ) },
    { key: 'status', label: 'Status', align: 'center' },
  ]

  return (
    <div className="space-y-3">
      <FilterBar
        range={range} setRange={setRange} preset={preset} setPreset={setPreset}
        booker={booker} setBooker={setBooker} bookers={fopts.bookers}
        city={city} setCity={setCity} cities={fopts.cities}
        onRefresh={gate.load} loading={loading} armed={gate.armed} stale={gate.stale}
      />
      {!gate.armed ? (
        <ReportEmptyGate
          icon={PackageCheck}
          title="Fill Rate — Order vs Delivery"
          desc="Demand kitni puri ho pai: har order/product par kitne units mange gaye vs kitne deliver hue (stock kami, partial loads sab shamil). Fill % value aur units dono par."
          steps={[
            'Date range select karein',
            'Booker / City filter chunein (optional)',
            "'Report Load Karein' dabayen",
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
        <>
          {data && (
            <KpiRow
              items={[
                { label: 'Fill % (Units)', value: `${data.summary.fillPctUnits}%`, sub: `${fmtQty(data.summary.deliveredUnits)} / ${fmtQty(data.summary.orderedUnits)} pcs`, tone: data.summary.fillPctUnits >= 90 ? 'emerald' : 'amber' },
                { label: 'Fill % (Value)', value: `${data.summary.fillPctValue}%`, sub: `Rs ${fmt0(data.summary.deliveredValue)} / Rs ${fmt0(data.summary.bookedValue)}`, tone: 'blue' },
                { label: 'Perfect Orders', value: String(data.summary.perfectOrders), sub: `${data.summary.orders} orders mein se`, tone: 'emerald' },
                { label: 'Short SKUs', value: String(data.summary.shortSkus), sub: 'jin products ki kami hui', tone: 'red' },
              ]}
            />
          )}
          <SectionCard
            title="Product-wise Supply Gap (sab se kam fill pehle)"
            right={
              <ExportButtons
                opts={{
                  title: 'Fill Rate — Product-wise Supply Gap',
                  distributor: user?.profile?.businessName ?? '—',
                  period: rangeLabel(range),
                  filename: `fill-rate-products-${range.from}_${range.to}`,
                  cols: pcols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
                  rows: (data?.products ?? []).map((r) => [r.productName, r.sku, r.company, r.orderedUnits, r.deliveredUnits, r.shortUnits, `${r.fillPct}%`]),
                  totalsRow: ['TOTAL', '', '', data?.summary.orderedUnits ?? 0, data?.summary.deliveredUnits ?? 0, (data?.summary.orderedUnits ?? 0) - (data?.summary.deliveredUnits ?? 0), `${data?.summary.fillPctUnits ?? 100}%`],
                }}
              />
            }
          >
            <DataTable cols={pcols} rows={data?.products ?? []} empty="Is period mein koi order nahi" />
          </SectionCard>
          <SectionCard
            title={`Order-wise Fill (${rangeLabel(range)})`}
            right={
              <ExportButtons
                opts={{
                  title: 'Fill Rate — Order-wise',
                  distributor: user?.profile?.businessName ?? '—',
                  period: rangeLabel(range),
                  filename: `fill-rate-orders-${range.from}_${range.to}`,
                  cols: ocols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
                  rows: (data?.orders ?? []).map((r) => [r.orderNo, r.date.slice(0, 10), r.shop, r.booker, r.bookedUnits, r.deliveredUnits, r.bookedValue, r.deliveredValue, `${r.fillPct}%`, r.status]),
                }}
              />
            }
          >
            <DataTable cols={ocols} rows={data?.orders ?? []} empty="Is period mein koi order nahi" maxH="max-h-[45vh]" />
          </SectionCard>
        </>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
