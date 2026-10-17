'use client'

// Task 66 — Recovery (wasooli) tab — outstanding + collection history dono

import { useState } from 'react'
import { HandCoins } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  FilterBar, useRangeFilter, KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, useFilterOptions, ReportEmptyGate, fmtDay, rangeLabel, type Col,
} from './reports-kit'

interface OutRow extends Record<string, unknown> {
  shop: string; code: string; city: string; channel: string; booker: string; creditDays: number
  balance: number; totalBilled: number; totalCollected: number
  lastPaymentDate: string | null; daysSinceLastPayment: number | null; overdue: boolean
}
interface HistRow extends Record<string, unknown> {
  date: string; kind: 'RECOVERY' | 'CASH'; refNo: string; shop: string; booker: string; amount: number; method: string; status: string
}
interface Resp extends Record<string, unknown> {
  summary: { outstandingShops: number; outstandingTotal: number; overdueShops: number; overdueTotal: number; collectedInPeriod: number; historyEntries: number }
  outstanding: OutRow[]; history: HistRow[]
  bookerSummary: { booker: string; collected: number; entries: number; shops: number }[]
}

export function RecoveryTab() {
  const { user } = useDMS()
  const { range, setRange, preset, setPreset } = useRangeFilter()
  const [booker, setBooker] = useState('')
  const [company, setCompany] = useState('')
  const fopts = useFilterOptions(user?.id)

  // Task 74 — filter-first: data sirf "Report Load Karein" par load hota hai
  const gate = useReportGate<Resp>({
    fetcher: async () => {
      const p = new URLSearchParams({ userId: user!.id, from: range.from, to: range.to })
      if (booker) p.set('bookerId', booker)
      if (company) p.set('companyId', company)
      return api<Resp>(`/api/reports/recovery?${p}`)
    },
    filtersKey: `${range.from}|${range.to}|${booker}|${company}`,
  })
  const { data, loading } = gate

  const ocols: Col<OutRow>[] = [
    { key: 'shop', label: 'Shop', render: (r) => <span><span className="font-semibold text-slate-800">{r.shop}</span>{r.overdue && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600">OVERDUE</span>}</span> },
    { key: 'city', label: 'City' },
    { key: 'booker', label: 'Booker' },
    { key: 'creditDays', label: 'Credit Days', align: 'center' },
    { key: 'balance', label: 'Outstanding', align: 'right', money: true, total: true, cls: 'font-bold text-red-600' },
    { key: 'totalBilled', label: 'Total Billed', align: 'right', money: true, total: true },
    { key: 'totalCollected', label: 'Total Collected', align: 'right', money: true, total: true, cls: 'text-emerald-600' },
    { key: 'lastPaymentDate', label: 'Last Payment', align: 'right', render: (r) => fmtDay(r.lastPaymentDate) },
    { key: 'daysSinceLastPayment', label: 'Din se', align: 'right', render: (r) => r.daysSinceLastPayment != null ? `${r.daysSinceLastPayment}` : '—' },
  ]

  const hcols: Col<HistRow>[] = [
    { key: 'date', label: 'Date', render: (r) => fmtDay(r.date) },
    { key: 'kind', label: 'Type', align: 'center', render: (r) => (
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.kind === 'RECOVERY' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>{r.kind === 'RECOVERY' ? 'Recovery Voucher' : 'Cash Receipt'}</span>
    ) },
    { key: 'refNo', label: 'Ref #' },
    { key: 'shop', label: 'Shop' },
    { key: 'booker', label: 'Booker' },
    { key: 'method', label: 'Method', align: 'center' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'amount', label: 'Amount', align: 'right', money: true, total: true, cls: 'font-semibold' },
  ]

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
          icon={HandCoins}
          title="Recovery Report (Wasooli)"
          desc="Shop-wise outstanding udhaar, overdue shops aur period ki collection history — booker-wise wasooli summary ke sath."
          steps={[
            'Date range select karein',
            'Order booker / company filter chunein (optional)',
            "'Report Load Karein' dabayen — sirf selected data load hoga",
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
      <>
      {data && (
        <KpiRow
          items={[
            { label: 'Total Outstanding', value: `Rs ${fmt0(data.summary.outstandingTotal)}`, sub: `${data.summary.outstandingShops} shops`, tone: 'red' },
            { label: 'Overdue Shops', value: String(data.summary.overdueShops), sub: `Rs ${fmt0(data.summary.overdueTotal)} overdue`, tone: 'amber' },
            { label: 'Collected (Period)', value: `Rs ${fmt0(data.summary.collectedInPeriod)}`, sub: `${data.summary.historyEntries} entries`, tone: 'emerald' },
          ]}
        />
      )}
      <SectionCard
        title="Shop-wise Outstanding (Udhaar)"
        right={
          <ExportButtons
            opts={{
              title: 'Recovery Report — Shop-wise Outstanding',
              subtitle: company ? 'Company-filtered shops' : 'Sab shops',
              distributor: user?.profile?.businessName ?? '—',
              period: rangeLabel(range),
              filename: `recovery-outstanding-${range.from}_${range.to}`,
              cols: ocols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
              rows: (data?.outstanding ?? []).map((r) => [r.shop, r.city, r.booker, r.creditDays, r.balance, r.totalBilled, r.totalCollected, r.lastPaymentDate ? fmtDay(r.lastPaymentDate) : '—', r.daysSinceLastPayment ?? '—']),
              totalsRow: ['TOTAL', '', '', '', data?.summary.outstandingTotal ?? 0, '', '', '', ''],
            }}
          />
        }
      >
        <DataTable cols={ocols} rows={data?.outstanding ?? []} empty="Kisi shop ka outstanding nahi — sab clear ✓" />
      </SectionCard>
      <SectionCard
        title={`Collection History (${rangeLabel(range)})`}
        right={
          <ExportButtons
            opts={{
              title: 'Recovery Report — Collection History',
              distributor: user?.profile?.businessName ?? '—',
              period: rangeLabel(range),
              filename: `recovery-history-${range.from}_${range.to}`,
              cols: hcols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
              rows: (data?.history ?? []).map((r) => [r.date.slice(0, 10), r.kind, r.refNo, r.shop, r.booker, r.method, r.status, r.amount]),
            }}
          />
        }
      >
        <DataTable cols={hcols} rows={data?.history ?? []} empty="Is period mein koi wasooli entry nahi" maxH="max-h-[40vh]" />
      </SectionCard>
      <SectionCard title="Booker-wise Wasooli (Period)">
        <DataTable
          cols={[
            { key: 'booker', label: 'Booker' },
            { key: 'entries', label: 'Entries', align: 'right', total: true },
            { key: 'shops', label: 'Shops', align: 'right', total: true },
            { key: 'collected', label: 'Collected', align: 'right', money: true, total: true, cls: 'font-semibold text-emerald-700' },
          ] as Col<Record<string, unknown>>[]}
          rows={(data?.bookerSummary ?? []) as unknown as Record<string, unknown>[]}
        />
      </SectionCard>
      </>
      )}
    </div>
  )
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}
