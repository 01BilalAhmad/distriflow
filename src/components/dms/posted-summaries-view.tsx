'use client'

// Task 33 — POSTED SUMMARIES (settled history) apna poora page.
// User: "settled summaries side pr aa rhi hn in ka alg page bnao jis ka name hoga
// posted ya settled summaries" — settlement page ab sirf UNSETTLED ka kaam karta hai;
// settled ki poori history yahan khol kar visible hai (search + KPI chips + actions).
// Features jo pehle settlement page ke "Settled History" card mein theen, sab yahan move:
//   - Settlement Sheet print/preview (ReceiptText)
//   - Late Stock Return (PackageOpen) — settled bill par return + Undo
// Zero backend change — wohi /api/summaries API, sirf SETTLED filter yahan.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate, STATUS_STYLES } from '@/lib/dms-api'
import type { SummaryDTO, SummaryDetailDTO } from '@/lib/dms-types'
import { LateReturnDialog } from './settlement-view'
import { PrintFrame, CblSettlementDoc } from '@/components/dms/cbl-print'
import { ReceiptText, PackageOpen, Search, Wallet, Inbox } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export function PostedSummariesView() {
  const user = useDMS((s) => s.user)
  const [summaries, setSummaries] = useState<SummaryDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [lateRetId, setLateRetId] = useState<string | null>(null)
  // Settlement Sheet preview — print button se + late return ke baad refreshed numbers ke sath
  const [printDetail, setPrintDetail] = useState<SummaryDetailDTO | null>(null)

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const r = await api<{ summaries: SummaryDTO[] }>(`/api/summaries?userId=${user.id}`)
      setSummaries(r.summaries.filter((s) => s.status === 'SETTLED'))
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [user])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? summaries.filter((s) => `${s.summaryNo} ${s.salesmanName}`.toLowerCase().includes(needle))
      : summaries
    // newest pehle — summaryNo STM-60xx ascending banta hai
    return [...filtered].sort((a, b) => (a.summaryNo < b.summaryNo ? 1 : a.summaryNo > b.summaryNo ? -1 : 0))
  }, [summaries, q])

  const totalCash = rows.reduce((s, r) => s + r.settledCash, 0)
  const totalUdhaar = rows.reduce((s, r) => s + Math.max(0, r.settledCredit), 0)
  const totalReturns = rows.reduce((s, r) => s + (r.settledReturns ?? 0), 0)
  const totalWapasi = rows.reduce((s, r) => s + Math.max(0, -r.settledCredit), 0)

  // History se settlement sheet preview — poori detail screen par, print bhi wahi se
  async function printSettled(id: string) {
    try {
      const r = await api<{ summary: SummaryDetailDTO }>(`/api/summaries/${id}`)
      setPrintDetail(r.summary)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Posted Summaries</h2>
          <p className="text-sm text-slate-500">Settled deliveries ki poori history — cash, udhaar, returns aur settlement sheets</p>
        </div>
        <Button asChild variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50">
          <Link href="/settlement"><Wallet className="h-4 w-4 mr-1.5" />Unsettled settle karein</Link>
        </Button>
      </div>

      {/* KPI chips — history ka ek nazar mein hisaab */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Posted Summaries</p>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{rows.length}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Cash Collected</p>
            <p className="text-2xl font-bold text-emerald-700 tabular-nums">{fmtPKR(totalCash)}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Udhaar (Ledger)</p>
            <p className="text-2xl font-bold text-red-600 tabular-nums">{fmtPKR(totalUdhaar)}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Returns / Wapasi</p>
            <p className="text-2xl font-bold text-orange-600 tabular-nums">
              {totalReturns > 0 ? fmtPKR(totalReturns) : fmtPKR(totalWapasi)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search — summary no ya salesman */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Summary no ya salesman search karein… (STM-6010, M.Ali)" className="pl-9" />
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            {q.trim() ? (
              <>
                <Search className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-500">"{q}" se milta hua koi posted summary nahi</p>
              </>
            ) : (
              <>
                <Inbox className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-500">Abhi koi posted summary nahi</p>
                <p className="text-xs text-slate-400 mt-1">Settlement page par delivery settle karte hi yahan history ban jayegi</p>
                <Button asChild size="sm" className="mt-4 bg-emerald-600 hover:bg-emerald-700">
                  <Link href="/settlement">Settlement page kholein</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <Card key={s.id} className="border-slate-200 shadow-sm hover:border-emerald-300 transition-colors">
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800">{s.summaryNo}</span>
                  <Badge variant="outline" className={`${STATUS_STYLES.SETTLED} text-[10px]`}>Settled</Badge>
                </div>
                <p className="text-xs text-slate-600">{s.salesmanName} • {s.billsCount} bills • <span className="font-semibold">Payable {fmtPKR(s.payable ?? s.subtotal)}</span></p>
                <div className="text-[12px] space-y-0.5">
                  <p><span className="text-emerald-700 font-semibold">Cash {fmtPKR(s.settledCash)}</span></p>
                  {/* negative credit = return zyada hua (late return) — "Udhaar -X" reader ko
                      confuse karta hai, sheet ki tarah "Shop Ko Wapasi" positive dikhate hain */}
                  {s.settledCredit < 0
                    ? <p className="text-orange-600 font-semibold">Shop Ko Wapasi {fmtPKR(Math.abs(s.settledCredit))}</p>
                    : <p className="text-red-600 font-semibold">Udhaar {fmtPKR(s.settledCredit)}</p>}
                  {(s.settledReturns ?? 0) > 0 && <p className="text-orange-600 font-semibold">Return {fmtPKR(s.settledReturns)}</p>}
                </div>
                <p className="text-[11px] text-slate-400">{s.settledByName ? `By ${s.settledByName}` : ''} {s.settledAt ? `• ${fmtDate(s.settledAt)}` : ''}</p>
                <div className="flex gap-2 pt-1 border-t border-slate-100">
                  <Button size="sm" variant="outline" className="h-8 text-[11px] px-2.5 flex-1 text-violet-700 border-violet-200 hover:bg-violet-50"
                    title="Settlement Sheet — poori detail screen par + print"
                    onClick={() => printSettled(s.id)}>
                    <ReceiptText className="h-3.5 w-3.5 mr-1" />Sheet / Detail
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[11px] px-2.5 flex-1 text-orange-700 border-orange-200 hover:bg-orange-50"
                    title="Late Stock Return — ghalti se return reh gaya tha? Items wapas karein, shop ka balance cum ho jayega"
                    onClick={() => setLateRetId(s.id)}>
                    <PackageOpen className="h-3.5 w-3.5 mr-1" />Late Return
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Late stock return — settled summary ke bill par (settlement page jaisa hi dialog) */}
      {lateRetId && (
        <LateReturnDialog
          summaryId={lateRetId}
          onClose={() => setLateRetId(null)}
          onDone={async (id) => {
            setLateRetId(null)
            await load()
            // updated settlement sheet preview — late return ka asar foran nazar aaye
            try {
              const fr = await api<{ summary: SummaryDetailDTO }>(`/api/summaries/${id}`)
              setPrintDetail(fr.summary)
            } catch { /* print optional */ }
          }}
        />
      )}

      {/* Settlement Sheet preview — sheet/detail button se */}
      {printDetail && (
        <PrintFrame title={`Settlement Sheet ${printDetail.summaryNo}`} pdfName={`settlement-${printDetail.summaryNo}`} onClose={() => setPrintDetail(null)}>
          <CblSettlementDoc detail={printDetail} />
        </PrintFrame>
      )}
    </div>
  )
}
