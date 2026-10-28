'use client'

// Task 98 — Credit Book tab — Finexa-style udhaar khata:
// shop-wise running balance + credit limit status + FIFO aging buckets +
// booker-wise route exposure. Running khata hai — date range ki zaroorat nahi.

import { useState } from 'react'
import { BookLock } from 'lucide-react'
import { useDMS } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import {
  KpiRow, DataTable, SectionCard, ExportButtons,
  useReportGate, useFilterOptions, ReportEmptyGate, fmtDay, type Col,
} from './reports-kit'

interface ShopRow extends Record<string, unknown> {
  id: string; name: string; code: string; city: string | null; channel: string; booker: string | null
  creditDays: number; creditLimit: number; balance: number; advance: number
  creditStatus: 'OK' | 'NEAR' | 'OVER' | 'NONE'; limitPct: number; overBy: number
  oldestUnpaidDate: string | null; oldestUnpaidDays: number | null; agingBucket: string
}
interface Resp extends Record<string, unknown> {
  summary: {
    totalOutstanding: number; shopsWithBalance: number
    overLimitShops: number; overLimitAmount: number; nearLimitShops: number
    advanceShops: number; totalAdvance: number; over30Amount: number
  }
  shops: ShopRow[]
  aging: { bucket: string; shops: number; amount: number }[]
  bookerSummary: { booker: string; shops: number; balance: number; overLimit: number; nearLimit: number; over30: number }[]
}

const STATUS_BADGE: Record<ShopRow['creditStatus'], { label: string; cls: string }> = {
  OVER: { label: 'OVER LIMIT', cls: 'bg-red-100 text-red-700' },
  NEAR: { label: 'NEAR 80%', cls: 'bg-amber-100 text-amber-700' },
  OK: { label: 'OK', cls: 'bg-emerald-50 text-emerald-700' },
  NONE: { label: 'NO LIMIT', cls: 'bg-slate-100 text-slate-500' },
}

const BUCKET_BADGE: Record<string, string> = {
  CLEAR: 'bg-emerald-50 text-emerald-700',
  '0-7': 'bg-slate-100 text-slate-600',
  '8-15': 'bg-amber-50 text-amber-700',
  '16-30': 'bg-orange-100 text-orange-700',
  '30+': 'bg-red-100 text-red-700',
}

export function CreditTab() {
  const { user } = useDMS()
  const [booker, setBooker] = useState('')
  const [status, setStatus] = useState('')
  const fopts = useFilterOptions(user?.id)

  const gate = useReportGate<Resp>({
    fetcher: async () => {
      const p = new URLSearchParams({ userId: user!.id })
      if (booker) p.set('bookerId', booker)
      return api<Resp>(`/api/reports/credit?${p}`)
    },
    filtersKey: `${booker}`,
  })
  const { data, loading } = gate

  const rows = (data?.shops ?? []).filter((s) =>
    !status || (status === 'WITH_BALANCE' ? Math.abs(s.balance) > 0.005 || s.advance > 0.005 : s.creditStatus === status),
  )

  const cols: Col<ShopRow>[] = [
    { key: 'name', label: 'Shop', render: (r) => <span className="font-semibold text-slate-800">{r.name}</span> },
    { key: 'city', label: 'City' },
    { key: 'booker', label: 'Booker' },
    { key: 'balance', label: 'Balance (Udhaar)', align: 'right', money: true, total: true, cls: 'font-bold text-red-600' },
    { key: 'advance', label: 'Advance (Shop Ke Haq Mein)', align: 'right', money: true, cls: 'font-semibold text-emerald-600', render: (r) => r.advance > 0.005 ? `Rs ${r.advance.toLocaleString('en-PK')}` : '—' },
    { key: 'creditLimit', label: 'Credit Limit', align: 'right', money: true, render: (r) => r.creditLimit > 0 ? `Rs ${r.creditLimit.toLocaleString('en-PK')}` : 'No limit' },
    { key: 'creditStatus', label: 'Limit Status', align: 'center', render: (r) => (
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[r.creditStatus].cls}`}>
        {STATUS_BADGE[r.creditStatus].label}{r.creditStatus === 'NEAR' ? ` (${r.limitPct}%)` : ''}
      </span>
    ) },
    { key: 'oldestUnpaidDate', label: 'Oldest Unpaid', align: 'right', render: (r) => fmtDay(r.oldestUnpaidDate) },
    { key: 'agingBucket', label: 'Aging', align: 'center', render: (r) => (
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${BUCKET_BADGE[r.agingBucket] ?? 'bg-slate-100 text-slate-600'}`}>
        {r.agingBucket}{r.oldestUnpaidDays != null ? ` (${r.oldestUnpaidDays}d)` : ''}
      </span>
    ) },
  ]

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Order Booker</label>
          <select value={booker} onChange={(e) => setBooker(e.target.value)} className="h-9 min-w-40 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800">
            <option value="">Sab bookers</option>
            {fopts.bookers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Limit Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 min-w-36 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800">
            <option value="">Sab</option>
            <option value="WITH_BALANCE">Sirf balance wali</option>
            <option value="OVER">Over limit</option>
            <option value="NEAR">Near limit (80%+)</option>
            <option value="OK">OK</option>
          </select>
        </div>
        <button
          onClick={gate.load}
          disabled={loading}
          className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Report Load Karein'}
        </button>
      </div>

      {!gate.armed ? (
        <ReportEmptyGate
          icon={BookLock}
          title="Credit Book (Udhaar Khata)"
          desc="Shop-wise running balance (bill se automatic), credit limit status aur FIFO aging — kaunsi shop ka kitna purana udhaar hai, ek nazar mein."
          steps={[
            'Order booker chunein (optional)',
            "'Report Load Karein' dabayen — pehli load par legacy shops ledger se sync hongi",
            'Over-limit shops sab se upar dekhein',
          ]}
          onLoad={gate.load}
          loading={loading}
        />
      ) : (
      <>
      {data && (
        <KpiRow
          items={[
            { label: 'Total Outstanding', value: `Rs ${fmt0(data.summary.totalOutstanding)}`, sub: `${data.summary.shopsWithBalance} shops par`, tone: 'red' },
            { label: 'Over Limit', value: `${data.summary.overLimitShops} shops`, sub: `Rs ${fmt0(data.summary.overLimitAmount)} extra`, tone: 'amber' },
            { label: 'Near Limit (80%+)', value: String(data.summary.nearLimitShops), sub: 'in shops ko follow karein', tone: 'amber' },
            { label: 'Shop Ke Haq Mein Advance', value: `Rs ${fmt0(data.summary.totalAdvance)}`, sub: `${data.summary.advanceShops} shops — return ka (agli bill se auto-adjust)`, tone: 'emerald' },
            { label: '30+ Din Purana', value: `Rs ${fmt0(data.summary.over30Amount)}`, sub: 'sab se purana udhaar', tone: 'red' },
          ]}
        />
      )}

      <SectionCard
        title="Shop-wise Credit Khata"
        right={
          <ExportButtons
            opts={{
              title: 'Credit Book — Shop-wise Udhaar Khata',
              subtitle: booker ? 'Booker-filtered' : 'Sab shops',
              distributor: user?.profile?.businessName ?? '—',
              period: 'Running balance (aaj)',
              filename: `credit-book-${new Date().toISOString().slice(0, 10)}`,
              cols: cols.map((c) => ({ label: c.label, align: c.align, money: c.money })),
              rows: rows.map((r) => [r.name, r.city ?? '', r.booker ?? '', r.balance, r.advance, r.creditLimit, STATUS_BADGE[r.creditStatus].label, r.oldestUnpaidDate ? fmtDay(r.oldestUnpaidDate) : '—', r.agingBucket]),
              totalsRow: ['TOTAL', '', '', data?.summary.totalOutstanding ?? 0, data?.summary.totalAdvance ?? 0, '', '', '', ''],
            }}
          />
        }
      >
        <DataTable cols={cols} rows={rows} empty="Kisi shop ka udhaar nahi — sab clear" />
      </SectionCard>

      <SectionCard title="Aging Buckets (FIFO — credits purane debit pehle khate hain)">
        <DataTable
          cols={[
            { key: 'bucket', label: 'Bucket', render: (r) => (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${BUCKET_BADGE[(r as { bucket: string }).bucket]}`}>{(r as { bucket: string }).bucket}</span>
            ) },
            { key: 'shops', label: 'Shops', align: 'right', total: true },
            { key: 'amount', label: 'Amount', align: 'right', money: true, total: true, cls: 'font-semibold' },
          ] as Col<Record<string, unknown>>[]}
          rows={(data?.aging ?? []) as unknown as Record<string, unknown>[]}
        />
      </SectionCard>

      <SectionCard title="Booker-wise Credit Book (Route Exposure)">
        <DataTable
          cols={[
            { key: 'booker', label: 'Booker' },
            { key: 'shops', label: 'Shops', align: 'right', total: true },
            { key: 'balance', label: 'Route Ka Udhaar', align: 'right', money: true, total: true, cls: 'font-bold text-red-600' },
            { key: 'overLimit', label: 'Over Limit', align: 'right', total: true, render: (r) => (r as { overLimit: number }).overLimit > 0 ? <span className="font-bold text-red-600">{(r as { overLimit: number }).overLimit}</span> : '0' },
            { key: 'nearLimit', label: 'Near Limit', align: 'right', total: true },
            { key: 'over30', label: '30+ Din', align: 'right', total: true },
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
