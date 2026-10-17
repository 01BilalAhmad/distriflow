'use client'

// Task 66 — Company Purchase & Payables tab

import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReport, rangeLabel, type Col,
} from './reports-kit'

interface CompRow extends Record<string, unknown> {
  company: string; invoices: number; units: number; subtotal: number; discount: number
  netPurchase: number; gst: number; wht: number; tradeOffer: number; total: number
  paid: number; outstanding: number; ledgerBalance: number
}
interface Resp extends Record<string, unknown> {
  summary: { companies: number; invoices: number; netPurchase: number; gstInput: number; totalPayable: number; paid: number }
  rows: CompRow[]
  unpaidRows: { invoiceNo: string; company: string; total: number; paid: number; outstanding: number; status: string }[]
}

export function CompanyPurchaseTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()

  const { data, loading, refresh } = useReport<Resp>(async () => {
    return api<Resp>(`/api/reports/company-purchase?userId=${user!.id}&from=${range.from}&to=${range.to}`)
  }, [user?.id, range.from, range.to])

  const cols: Col<CompRow>[] = [
    { key: 'company', label: 'Company', render: (r) => <span className="font-semibold text-slate-800">{r.company}</span> },
    { key: 'invoices', label: 'Invoices', align: 'right', total: true },
    { key: 'units', label: 'Units (Pcs)', align: 'right', total: true },
    { key: 'subtotal', label: 'Gross', align: 'right', money: true, total: true },
    { key: 'discount', label: 'Discount', align: 'right', money: true, total: true, cls: 'text-amber-600' },
    { key: 'netPurchase', label: 'Net Purchase', align: 'right', money: true, total: true, cls: 'font-semibold' },
    { key: 'gst', label: 'Input GST', align: 'right', money: true, total: true },
    { key: 'wht', label: 'Adv Tax', align: 'right', money: true, total: true },
    { key: 'tradeOffer', label: 'Trade Offer', align: 'right', money: true, total: true, cls: 'text-blue-600' },
    { key: 'total', label: 'Invoice Total', align: 'right', money: true, total: true },
    { key: 'paid', label: 'Paid', align: 'right', money: true, total: true, cls: 'text-emerald-600' },
    { key: 'outstanding', label: 'Payable (Baqi)', align: 'right', money: true, total: true, cls: 'font-bold text-red-600' },
    { key: 'ledgerBalance', label: 'Ledger Balance', align: 'right', money: true },
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
            { label: 'Net Purchase', value: `Rs ${fmt0(data.summary.netPurchase)}`, sub: `${data.summary.invoices} invoices • ${data.summary.companies} companies`, tone: 'blue' },
            { label: 'Input GST', value: `Rs ${fmt0(data.summary.gstInput)}`, sub: 'Tax report mein net hoga', tone: 'slate' },
            { label: 'Paid', value: `Rs ${fmt0(data.summary.paid)}`, tone: 'emerald' },
            { label: 'Total Payable', value: `Rs ${fmt0(data.summary.totalPayable)}`, sub: 'Companies ko dena hai', tone: 'red' },
          ]}
        />
      )}
      <SectionCard
        title="Company-wise Purchase & Payables"
        right={
          <div className="flex items-center gap-2">
            <ExportButtons
              opts={{
                title: 'Company-wise Purchase & Payables Report',
                distributor: user?.profile?.businessName ?? '—',
                period: rangeLabel(range),
                filename: `company-purchase-${range.from}_${range.to}`,
                cols: cols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
                rows: (data?.rows ?? []).map((r) => [r.company, r.invoices, r.units, r.subtotal, r.discount, r.netPurchase, r.gst, r.wht, r.tradeOffer, r.total, r.paid, r.outstanding, r.ledgerBalance]),
                totalsRow: ['TOTAL', data?.rows.reduce((t, x) => t + x.invoices, 0) ?? 0, data?.rows.reduce((t, x) => t + x.units, 0) ?? 0, data?.rows.reduce((t, x) => t + x.subtotal, 0) ?? 0, data?.rows.reduce((t, x) => t + x.discount, 0) ?? 0, data?.summary.netPurchase ?? 0, data?.summary.gstInput ?? 0, data?.rows.reduce((t, x) => t + x.wht, 0) ?? 0, data?.rows.reduce((t, x) => t + x.tradeOffer, 0) ?? 0, data?.rows.reduce((t, x) => t + x.total, 0) ?? 0, data?.summary.paid ?? 0, data?.summary.totalPayable ?? 0, ''],
              }}
            />
          </div>
        }
      >
        <DataTable cols={cols} rows={data?.rows ?? []} empty="Is period mein koi purchase nahi" />
      </SectionCard>
      {(data?.unpaidRows.length ?? 0) > 0 && (
        <SectionCard title="Unpaid Invoices (Audit)">
          <DataTable
            cols={[
              { key: 'invoiceNo', label: 'Invoice #' },
              { key: 'company', label: 'Company' },
              { key: 'total', label: 'Total', align: 'right', money: true, total: true },
              { key: 'paid', label: 'Paid', align: 'right', money: true, total: true },
              { key: 'outstanding', label: 'Outstanding', align: 'right', money: true, total: true, cls: 'font-bold text-red-600' },
              { key: 'status', label: 'Status', align: 'center' },
            ] as Col<Record<string, unknown>>[]}
            rows={(data!.unpaidRows) as unknown as Record<string, unknown>[]}
            maxH="max-h-[35vh]"
          />
        </SectionCard>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
