'use client'

// Task 35 — AUDIT LOG VIEWER: "hr AK CHOTI CHOTI activity ka log — jo bhi action
// perform ho rha ho website pr" (user directive, lazmi feature).
// - Har API mutation automatically logged (requireUser generic audit) + critical
//   business events apni labeled row (LOGIN, ORDER_CREATE, SETTLEMENT_POST...)
// - DISTRIBUTOR: apni tenant ki activity; MEGA_ADMIN: poora system
// - Search + action filter + Load more (100/page)

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/dms-api'
import { ScrollText, Search, ShieldCheck, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface AuditRow {
  id: string
  at: string
  userName: string | null
  userRole: string | null
  action: string
  entity: string | null
  entityId: string | null
  detail: string | null
  ip: string | null
}

const ACTIONS = [
  'ALL', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'AUTH_REJECTED',
  'ORDER_CREATE', 'ORDER_EDIT', 'ORDER_CANCEL', 'ORDER_DELIVER',
  'BILLS_PROCESS', 'SUMMARY_UNPROCESS', 'SETTLEMENT_POST', 'LATE_RETURN',
  'RETURN_CREATE', 'RETURN_APPROVE', 'RETURN_REJECT', 'RETURN_CANCEL',
  'PURCHASE_CREATE', 'SETTINGS_UPDATE', 'BACKUP_EXPORT',
  'API_POST', 'API_PATCH', 'API_PUT', 'API_DELETE',
]

// Action ke prefix se badge rang — ek nazar mein action type
function actionStyle(action: string): string {
  if (action === 'LOGIN' || action === 'LOGOUT') return 'bg-sky-50 text-sky-700 border-sky-200'
  if (action === 'LOGIN_FAILED' || action === 'AUTH_REJECTED' || action.includes('CANCEL') || action.includes('DELETE')) return 'bg-red-50 text-red-700 border-red-200'
  if (action.includes('DELETE')) return 'bg-red-50 text-red-700 border-red-200'
  if (action === 'ORDER_CREATE' || action === 'BILLS_PROCESS' || action === 'SETTLEMENT_POST' || action === 'PURCHASE_CREATE' || action === 'BACKUP_EXPORT') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (action.includes('RETURN') || action === 'SUMMARY_UNPROCESS') return 'bg-orange-50 text-orange-700 border-orange-200'
  if (action.startsWith('API_')) return 'bg-slate-50 text-slate-500 border-slate-200'
  return 'bg-violet-50 text-violet-700 border-violet-200'
}

function fmtDT(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function AuditView() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [action, setAction] = useState('ALL')

  async function load(p: number, append: boolean) {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), take: '100' })
      if (q.trim()) params.set('q', q.trim())
      if (action !== 'ALL') params.set('action', action)
      const r = await api<{ logs: AuditRow[]; total: number; hasMore: boolean }>(`/api/audit?${params}`)
      setRows((prev) => (append ? [...prev, ...r.logs] : r.logs))
      setTotal(r.total)
      setHasMore(r.hasMore)
      setPage(p)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Audit log load failed', variant: 'destructive' })
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => { load(1, false) }, [q, action])

  const summary = useMemo(() => `${rows.length}${total > rows.length ? ` / ${total}` : ''}`, [rows.length, total])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><ScrollText className="h-5 w-5 text-slate-400" /> Audit Log</h2>
        <p className="text-sm text-slate-500">Website par ki gayi HAR activity ka record — login, bills, settlements, returns, settings, backup… sab kuch</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setQ(qInput) }}
            onBlur={() => setQ(qInput)}
            placeholder="User, action ya detail search karein… (M.Ali, STM-6012, settle)"
            className="pl-9"
          />
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-full sm:w-56 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a === 'ALL' ? 'Sab actions' : a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="px-4 py-2.5 border-b bg-slate-50/70 flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Activity ({summary})</p>
            <p className="text-[10px] text-slate-400 flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Tampering-proof record — sab actions auto-log</p>
          </div>
          {loading ? (
            <div className="p-4 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center">
              <ScrollText className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-500">{q || action !== 'ALL' ? 'Is filter par koi activity nahi mili' : 'Abhi koi activity log nahi hui — website use karte hi yahan aane lagegi'}</p>
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((r) => (
                <div key={r.id} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 hover:bg-slate-50/60">
                  <p className="text-[11px] text-slate-400 font-mono whitespace-nowrap sm:w-32 shrink-0 sm:pt-0.5">{fmtDT(r.at)}</p>
                  <div className="min-w-0 sm:w-44 shrink-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{r.userName ?? '—'}</p>
                    <p className="text-[10px] text-slate-400">{r.userRole ?? ''}{r.ip ? ` • ${r.ip}` : ''}</p>
                  </div>
                  <div className="sm:w-40 shrink-0">
                    <Badge variant="outline" className={`${actionStyle(r.action)} text-[10px] font-semibold`}>{r.action}</Badge>
                  </div>
                  <p className="text-[13px] text-slate-600 min-w-0 flex-1 break-words">
                    {r.detail ?? `${r.entity ?? ''}${r.entityId ? ` (${r.entityId})` : ''}`}
                  </p>
                </div>
              ))}
            </div>
          )}
          {hasMore && (
            <div className="p-3 border-t text-center">
              <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => load(page + 1, true)}>
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Aur load karein ({Math.max(0, total - rows.length)} baqi)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
