'use client'

/**
 * Task 36 — Supplier Aging & Recent Payments panel (Companies view ke upar).
 *
 * - KPIs: Total Payable (ledger balance), 61+ din overdue (aging buckets), Payments is maheene
 * - Aging table: per company payable + 0-30 / 31-60 / 61-90 / 90+ din buckets
 *   (buckets UNPAID/PARTIAL purchase invoices ki remaining amount se bante hain)
 * - Recent payments: latest PAYMENT ledger entries
 *
 * `refreshKey` prop badalne par dobara load hota hai — payment record hone ke baad parent
 * refreshKey bump karta hai, is liye panel fresh rehta hai.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Wallet, TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api, fmtPKR, fmtDate } from '@/lib/dms-api'
import { toast } from '@/hooks/use-toast'
import { useDMS } from '@/lib/dms-store'

interface AgingCompany {
  companyId: string
  name: string
  shortCode: string | null
  isActive: boolean
  payable: number
  b0: number
  b31: number
  b61: number
  b91: number
  openInvoices: number
}

interface AgingData {
  kpis: { totalPayable: number; over60: number; payments30d: number }
  companies: AgingCompany[]
  payments: { id: string; date: string; amount: number; companyName: string; description: string; refNo: string | null }[]
}

const CELL = 'px-2.5 py-1.5 text-right text-xs'
const HEAD = 'px-2.5 py-1.5 text-right text-[10px] uppercase font-semibold text-slate-400'

export function SupplierAgingCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { user } = useDMS()
  const [data, setData] = useState<AgingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const d = await api<AgingData>(`/api/supplier-aging?userId=${user.id}`)
      setData(d)
    } catch (e) {
      toast({ title: 'Aging load fail', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const k = data?.kpis
  const rows = (data?.companies ?? []).filter((c) => c.payable > 0.01 || c.openInvoices > 0)

  return (
    <Card className="border-slate-200">
      <CardContent className="p-0">
        <button
          className="w-full flex items-center gap-2.5 px-4 py-3 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-500 flex items-center justify-center shrink-0">
            <Wallet className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-900 text-sm leading-tight">Supplier Aging &amp; Payments</p>
            <p className="text-[11px] text-slate-500 truncate">
              Kitna kis company ko dena hai, kitna purana — aur is maheene kitni payments huin
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-4 mr-2 text-xs">
            <span className="text-slate-500">Payable: <b className="text-red-600">{k ? fmtPKR(k.totalPayable) : '—'}</b></span>
            {k && k.over60 > 0 && (
              <span className="flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> <b>{fmtPKR(k.over60)}</b> 61+ din</span>
            )}
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />}
        </button>

        {open && (
          <div className="border-t border-slate-100 p-4 space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-slate-400 gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Aging load ho raha hai...
              </div>
            ) : (
              <>
                {/* KPI chips */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                    <p className="text-[10px] uppercase font-semibold text-red-400">Total Payable</p>
                    <p className="text-lg font-bold text-red-700 leading-tight">{k ? fmtPKR(k.totalPayable) : '—'}</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-[10px] uppercase font-semibold text-amber-500">61+ Din Overdue</p>
                    <p className="text-lg font-bold text-amber-700 leading-tight">{k ? fmtPKR(k.over60) : '—'}</p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <p className="text-[10px] uppercase font-semibold text-emerald-500 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Payments (is maheene)</p>
                    <p className="text-lg font-bold text-emerald-700 leading-tight">{k ? fmtPKR(k.payments30d) : '—'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
                  {/* Aging table */}
                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full min-w-[560px]">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className={`${HEAD} !text-left`}>Company</th>
                          <th className={HEAD}>Payable</th>
                          <th className={HEAD}>0-30</th>
                          <th className={HEAD}>31-60</th>
                          <th className={HEAD}>61-90</th>
                          <th className={HEAD}>90+</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">
                              Sab companies clear hain — koi outstanding nahi
                            </td>
                          </tr>
                        )}
                        {rows.map((c) => (
                          <tr key={c.companyId} className="border-t border-slate-100">
                            <td className="px-2.5 py-1.5 text-xs font-medium text-slate-700">
                              <span className="truncate block max-w-[180px]" title={c.name}>{c.name}</span>
                              {c.openInvoices > 0 && <span className="text-[10px] text-slate-400">{c.openInvoices} bills open</span>}
                            </td>
                            <td className={`${CELL} font-bold ${c.payable > 0.01 ? 'text-red-600' : 'text-slate-400'}`}>{fmtPKR(c.payable)}</td>
                            <td className={CELL}>{c.b0 > 0 ? fmtPKR(c.b0) : <span className="text-slate-300">—</span>}</td>
                            <td className={`${CELL} ${c.b31 > 0 ? 'text-amber-700 font-medium' : ''}`}>{c.b31 > 0 ? fmtPKR(c.b31) : <span className="text-slate-300">—</span>}</td>
                            <td className={`${CELL} ${c.b61 > 0 ? 'text-orange-700 font-medium' : ''}`}>{c.b61 > 0 ? fmtPKR(c.b61) : <span className="text-slate-300">—</span>}</td>
                            <td className={`${CELL} ${c.b91 > 0 ? 'text-red-700 font-bold' : ''}`}>{c.b91 > 0 ? fmtPKR(c.b91) : <span className="text-slate-300">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Recent payments */}
                  <div className="rounded-lg border">
                    <p className="px-3 py-2 text-[10px] uppercase font-semibold text-slate-400 border-b border-slate-100 bg-slate-50">Recent Payments</p>
                    <ul className="divide-y divide-slate-50 max-h-[260px] overflow-y-auto">
                      {(data?.payments ?? []).length === 0 && (
                        <li className="px-3 py-6 text-center text-xs text-slate-400">Abhi koi payment record nahi hui</li>
                      )}
                      {(data?.payments ?? []).map((p) => (
                        <li key={p.id} className="px-3 py-2 flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-700 truncate">{p.companyName}</p>
                            <p className="text-[10px] text-slate-400 truncate">{fmtDate(p.date)}{p.refNo ? ` · ${p.refNo}` : ''} · {p.description}</p>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                            {fmtPKR(p.amount)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
