'use client'

// Task 66 — Tax Report tab (Sales Tax GST + WHT 236H Filer/Non-Filer + FBR annex print)

import { useState } from 'react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, CSVButton, PrintButton,
  downloadCSV, printReport, useReport, fmtDay, rangeLabel, type Col, type Option,
} from './reports-kit'

interface ShopRow extends Record<string, unknown> {
  shop: string; code: string; city: string; filerStatus: string; ntn: string | null; cnic: string | null
  taxable: number; gst: number; wht: number; grand: number; orders: number
}
interface AnnexRow extends Record<string, unknown> {
  orderNo: string; date: string; shop: string; city: string; filerStatus: string
  ntn: string | null; cnic: string | null; taxable: number; gst: number; wht: number; whtRate: number | null; grand: number
}
interface Resp extends Record<string, unknown> {
  output: {
    summary: { taxable: number; gst: number; wht: number; grand: number; orders: number; shops: number }
    filerSummary: { filerStatus: string; taxable: number; gst: number; wht: number; orders: number; shops: number }[]
    shopWise: ShopRow[]; annex: AnnexRow[]
  }
  input: { invoices: number; netPurchase: number; gst: number; wht: number; rows: { invoiceNo: string; date: string; company: string; netPurchase: number; gst: number; wht: number; total: number }[] }
  netStatement: { outputGst: number; inputGst: number; netGstPayable: number; outputWht: number; inputWht: number; netWht: number }
  meta: { bookers: Option[] }
}

export function TaxTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()
  const [booker, setBooker] = useState('')

  const { data, loading, refresh } = useReport<Resp>(async () => {
    const p = new URLSearchParams({ userId: user!.id, from: range.from, to: range.to })
    if (booker) p.set('bookerId', booker)
    return api<Resp>(`/api/reports/tax?${p}`)
  }, [user?.id, range.from, range.to, booker])

  const cols: Col<ShopRow>[] = [
    { key: 'shop', label: 'Shop', render: (r) => <span><span className="font-semibold text-slate-800">{r.shop}</span><span className="ml-1.5 text-[10px] text-slate-400">{r.code}</span></span> },
    { key: 'city', label: 'City' },
    { key: 'filerStatus', label: 'Status', align: 'center', render: (r) => (
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.filerStatus === 'FILER' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{r.filerStatus}</span>
    ) },
    { key: 'ntn', label: 'NTN / CNIC', render: (r) => r.ntn ?? r.cnic ?? '—' },
    { key: 'orders', label: 'Bills', align: 'right', total: true },
    { key: 'taxable', label: 'Taxable Value', align: 'right', money: true, total: true },
    { key: 'gst', label: 'Sales Tax (GST)', align: 'right', money: true, total: true },
    { key: 'wht', label: 'Adv Tax 236H', align: 'right', money: true, total: true },
    { key: 'grand', label: 'Grand (all tax)', align: 'right', money: true, total: true },
  ]

  const annexCols: Col<AnnexRow>[] = [
    { key: 'orderNo', label: 'Invoice #', render: (r) => <span className="font-medium">{r.orderNo}</span> },
    { key: 'date', label: 'Date', render: (r) => fmtDay(r.date) },
    { key: 'shop', label: 'Buyer (Shop)' },
    { key: 'ntn', label: 'NTN/CNIC', render: (r) => r.ntn ?? r.cnic ?? '—' },
    { key: 'filerStatus', label: 'Status', align: 'center' },
    { key: 'taxable', label: 'Value excl. ST', align: 'right', money: true, total: true },
    { key: 'gst', label: 'Sales Tax', align: 'right', money: true, total: true },
    { key: 'wht', label: 'WHT 236H', align: 'right', money: true, total: true },
    { key: 'grand', label: 'Total', align: 'right', money: true, total: true },
  ]

  const o = data?.output
  const doAnnexPrint = () => {
    printReport({
      title: 'Sales Tax Invoice Annex (FBR Style)',
      subtitle: 'Output tax — shop-wise bills annex',
      distributor: user?.profile?.businessName ?? '—',
      period: rangeLabel(range),
      cols: annexCols.map((c) => ({ label: c.label, align: c.align })),
      rows: (o?.annex ?? []).map((r) => [r.orderNo, new Date(r.date).toLocaleDateString('en-PK'), r.shop, r.ntn ?? r.cnic ?? '—', r.filerStatus, r.taxable, r.gst, r.wht, r.grand]),
      totalsRow: ['TOTAL', '', '', '', '', o?.summary.taxable ?? 0, o?.summary.gst ?? 0, o?.summary.wht ?? 0, o?.summary.grand ?? 0],
      footerNote: `Output GST: Rs ${o?.summary.gst} • Input GST: Rs ${data?.input.gst} • Net GST Payable: Rs ${data?.netStatement.netGstPayable}`,
    })
  }

  return (
    <div className="space-y-3">
      <FilterBar
        range={range} setRange={setRange} preset={preset} setPreset={setPreset}
        booker={booker} setBooker={setBooker} bookers={data?.meta.bookers}
        onRefresh={refresh} loading={loading}
      />
      {o && (
        <KpiRow
          items={[
            { label: 'Taxable Value (Output)', value: `Rs ${fmt0(o.summary.taxable)}`, sub: `${o.summary.orders} bills • ${o.summary.shops} shops`, tone: 'blue' },
            { label: 'Sales Tax (GST)', value: `Rs ${fmt0(o.summary.gst)}`, sub: 'Output tax', tone: 'emerald' },
            { label: 'Adv Tax 236H (Output)', value: `Rs ${fmt0(o.summary.wht)}`, sub: 'Filer 0.5% / Non-filer 2.5%', tone: 'amber' },
            { label: 'Input GST (Purchases)', value: `Rs ${fmt0(data.input.gst)}`, sub: `${data.input.invoices} purchase invoices`, tone: 'slate' },
            { label: 'Net GST Payable', value: `Rs ${fmt0(data.netStatement.netGstPayable)}`, sub: 'Output − Input', tone: data.netStatement.netGstPayable >= 0 ? 'red' : 'emerald' },
            { label: 'Net WHT', value: `Rs ${fmt0(data.netStatement.netWht)}`, sub: 'Output − Input', tone: 'slate' },
          ]}
        />
      )}
      <SectionCard title="Filer / Non-Filer Summary (WHT 236H)">
        <DataTable
          cols={[
            { key: 'filerStatus', label: 'Tax Status', render: (r: Record<string, unknown>) => <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.filerStatus === 'FILER' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{String(r.filerStatus)}</span> },
            { key: 'shops', label: 'Shops', align: 'right', total: true },
            { key: 'orders', label: 'Bills', align: 'right', total: true },
            { key: 'taxable', label: 'Taxable Value', align: 'right', money: true, total: true },
            { key: 'gst', label: 'Sales Tax', align: 'right', money: true, total: true },
            { key: 'wht', label: 'Adv Tax 236H', align: 'right', money: true, total: true },
          ] as Col<Record<string, unknown>>[]}
          rows={(o?.filerSummary ?? []) as unknown as Record<string, unknown>[]}
        />
      </SectionCard>
      <SectionCard
        title="Shop-wise Tax Breakdown"
        right={
          <div className="flex items-center gap-2">
            <CSVButton onClick={() => downloadCSV(`tax-shopwise-${range.from}_${range.to}`, cols.map((c) => c.label), (o?.shopWise ?? []).map((r) => [r.shop, r.city, r.filerStatus, r.ntn ?? r.cnic ?? '', r.orders, r.taxable, r.gst, r.wht, r.grand]))} />
            <PrintButton onClick={doAnnexPrint} label="Print FBR Annex" />
          </div>
        }
      >
        <DataTable cols={cols} rows={o?.shopWise ?? []} />
      </SectionCard>
      <SectionCard
        title="Bill-wise Annex (Output Tax)"
        right={<CSVButton onClick={() => downloadCSV(`tax-annex-${range.from}_${range.to}`, annexCols.map((c) => c.label), (o?.annex ?? []).map((r) => [r.orderNo, r.date.slice(0, 10), r.shop, r.ntn ?? r.cnic ?? '', r.filerStatus, r.taxable, r.gst, r.wht, r.grand]))} />}
      >
        <DataTable cols={annexCols} rows={o?.annex ?? []} maxH="max-h-[45vh]" />
      </SectionCard>
      {data && data.input.rows.length > 0 && (
        <SectionCard title="Input Tax — Company Purchase Invoices">
          <DataTable
            cols={[
              { key: 'invoiceNo', label: 'Invoice #' },
              { key: 'company', label: 'Company' },
              { key: 'netPurchase', label: 'Net Purchase', align: 'right', money: true, total: true },
              { key: 'gst', label: 'Input GST', align: 'right', money: true, total: true },
              { key: 'wht', label: 'Input WHT', align: 'right', money: true, total: true },
              { key: 'total', label: 'Invoice Total', align: 'right', money: true, total: true },
            ] as Col<Record<string, unknown>>[]}
            rows={data.input.rows as unknown as Record<string, unknown>[]}
            maxH="max-h-[40vh]"
          />
        </SectionCard>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
