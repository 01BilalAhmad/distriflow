'use client'

/**
 * SYSTEM HEALTH (Task 128) — MEGA_ADMIN ka monitoring console (portal-only).
 *
 * 1) STATUS CARDS  : DB ping+latency, errors 1h/24h, warns 24h, maintenance state
 * 2) MAINTENANCE   : GLOBAL switch (backend deploy ke waqt) — until presets + note
 * 3) UNDER MAINT.  : per-distributor windows + turant "End" action
 * 4) ERROR FEED    : aakhri 50 rows (server/unhandled/client) + top failing routes
 *
 * Data source: GET /api/system/health (MEGA_ADMIN guarded). 30s auto-refresh —
 * "koi error aye to sab se pehle Mega Admin ko pata chale" ka portal wala hissa.
 * External alerts (WhatsApp/Telegram) deliberately baad ke liye — abhi sab yahin.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/dms-api'
import { toast } from '@/hooks/use-toast'
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Database, Loader2, RefreshCw,
  ShieldAlert, Wrench, XCircle,
} from 'lucide-react'

interface HealthData {
  db: { ok: boolean; latencyMs: number }
  errors: { last1h: number; last24h: number; warn24h: number; top: Array<{ route: string; count: number }> }
  maintenance: {
    global: { until: string; note: string | null } | null
    users: Array<{ id: string; businessName: string; name: string; until: string; note: string | null }>
  }
  recent: Array<{ id: string; level: string; source: string; route: string | null; method: string | null; message: string; createdAt: string }>
  generatedAt: string
}

const PKT = new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
const fmtPKT = (iso: string | null) => (iso ? PKT.format(new Date(iso)) : '—')
const fmtTimeOnly = (iso: string) => new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(iso))

/** ISO banane ke liye: preset hours ahead ya aaj raat 12 (PKT) */
function presetUntil(kind: '1h' | '3h' | '6h' | 'midnight' | 'custom', customLocal?: string): string | null {
  const now = new Date()
  if (kind === 'custom' && customLocal) return new Date(customLocal).toISOString()
  if (kind === 'midnight') {
    // aaj ki raat 12 PKT = next 19:00 UTC (PKT = UTC+5) ka date math — Intl se safe
    const pktNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
    const midnight = new Date(pktNow)
    midnight.setHours(24, 0, 0, 0)
    // PKT midnight → UTC: PKT = UTC+5 → minus 5 hours
    return new Date(midnight.getTime() - 5 * 60 * 60 * 1000).toISOString()
  }
  const hrs = kind === '1h' ? 1 : kind === '3h' ? 3 : 6
  return new Date(now.getTime() + hrs * 60 * 60 * 1000).toISOString()
}

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  server: { label: 'API', cls: 'border-slate-300 bg-slate-100 text-slate-600' },
  unhandled: { label: 'CRASH', cls: 'border-red-200 bg-red-50 text-red-600' },
  client: { label: 'BROWSER', cls: 'border-violet-200 bg-violet-50 text-violet-700' },
}

export function SystemHealthView() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [maintOpen, setMaintOpen] = useState(false)
  const [maintPreset, setMaintPreset] = useState<'1h' | '3h' | '6h' | 'midnight' | 'custom'>('1h')
  const [maintCustom, setMaintCustom] = useState('')
  const [maintNote, setMaintNote] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await api<HealthData>('/api/system/health')
      setData(res)
    } catch {
      if (!silent) toast({ title: 'System health load nahi hui', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // app-shell jaisa pattern (queueMicrotask) — sync setState-in-effect rule satisfied
    let alive = true
    queueMicrotask(() => { if (alive) void load(true) })
    const t = setInterval(() => void load(true), 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [load])

  async function toggleGlobalMaintenance(on: boolean) {
    setBusy(true)
    try {
      const until = on ? presetUntil(maintPreset, maintCustom) : null
      if (on && !until) {
        toast({ title: 'Custom time select karein', variant: 'destructive' })
        setBusy(false)
        return
      }
      await api('/api/system/maintenance', { method: 'POST', body: JSON.stringify({ until, note: maintNote.trim() || null }) })
      toast({ title: on ? 'Global maintenance ON' : 'Global maintenance OFF' })
      setMaintOpen(false)
      setMaintNote('')
      await load(true)
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Maintenance toggle failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function endUserMaintenance(id: string, name: string) {
    setBusy(true)
    try {
      await api(`/api/mega/distributors/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'maintenanceOff' }) })
      toast({ title: `${name} — maintenance khatam, ab online` })
      await load(true)
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Action failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="p-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        <Skeleton className="h-64 rounded-2xl sm:col-span-2 lg:col-span-4" />
      </div>
    )
  }
  if (!data) return null

  const g = data.maintenance.global
  const users = data.maintenance.users

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            <Activity className="h-5 w-5 text-[#2f56d6]" /> System Health
          </h1>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
            Live errors, database aur maintenance — har 30 second refresh
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">Updated {fmtTimeOnly(data.generatedAt)} PKT</span>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
          </Button>
        </div>
      </div>

      {/* status cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500"><Database className="h-3.5 w-3.5" /> Database</span>
              {data.db.ok
                ? <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-3 w-3" /> UP</Badge>
                : <Badge className="border-red-200 bg-red-50 text-red-600"><XCircle className="h-3 w-3" /> DOWN</Badge>}
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{data.db.ok ? `${data.db.latencyMs} ms` : '—'}</p>
            <p className="text-[11px] text-slate-400">ping latency (PKT server)</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="p-4">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500"><AlertTriangle className="h-3.5 w-3.5" /> Errors · last hour</span>
            <p className={`mt-2 text-2xl font-bold ${data.errors.last1h > 0 ? 'text-red-600' : 'text-slate-900 dark:text-slate-100'}`}>{data.errors.last1h}</p>
            <p className="text-[11px] text-slate-400">{data.errors.last24h} in last 24h</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="p-4">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500"><ShieldAlert className="h-3.5 w-3.5" /> Warnings · 24h</span>
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{data.errors.warn24h}</p>
            <p className="text-[11px] text-slate-400">API 4xx + browser errors</p>
          </CardContent>
        </Card>
        <Card className={`border-0 shadow-sm rounded-2xl ${g || users.length ? 'ring-1 ring-amber-300' : ''}`}>
          <CardContent className="p-4">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500"><Wrench className="h-3.5 w-3.5" /> Maintenance</span>
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{g ? 'GLOBAL' : users.length ? `${users.length} account${users.length > 1 ? 's' : ''}` : 'OFF'}</p>
            <p className="text-[11px] text-slate-400">{g ? `till ${fmtPKT(g.until)}` : users.length ? 'per-distributor windows active' : 'sab systems online'}</p>
          </CardContent>
        </Card>
      </div>

      {/* maintenance controls */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-[14.5px] font-semibold text-slate-900 dark:text-slate-100"><Wrench className="h-4 w-4 text-[#2f56d6]" /> Global Maintenance</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Backend deploy/migration ke waqt sab distributors + bookers temporarily band —
                  <span className="font-medium text-slate-700 dark:text-slate-200"> aap ka panel chalta rehta hai</span>.
                  App pe orders offline save hoti rehti hain, baad mein auto-sync.
                </p>
              </div>
              {g
                ? <Button size="sm" variant="destructive" className="gap-1.5" disabled={busy} onClick={() => void toggleGlobalMaintenance(false)}><XCircle className="h-3.5 w-3.5" /> End now</Button>
                : <Button size="sm" className="gap-1.5 bg-[#2f56d6] hover:bg-[#2546b8]" disabled={busy} onClick={() => setMaintOpen(true)}><Clock className="h-3.5 w-3.5" /> Start maintenance</Button>}
            </div>
            {g ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-400/20 dark:bg-amber-400/10">
                <p className="text-[13px] font-semibold text-amber-800 dark:text-amber-300">
                  ACTIVE — {fmtPKT(g.until)} (PKT) tak
                </p>
                {g.note ? <p className="text-[12px] text-amber-700 dark:text-amber-300/80">{g.note}</p> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="p-4 sm:p-5">
            <h2 className="text-[14.5px] font-semibold text-slate-900 dark:text-slate-100">Distributors under maintenance</h2>
            <p className="mt-1 text-[12.5px] text-slate-500 dark:text-slate-400">Per-account windows (Distributor Accounts page se bhi set hote hain)</p>
            <div className="mt-3 space-y-2">
              {users.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-[12.5px] text-slate-400 dark:border-white/10">Koi distributor maintenance par nahi</p>
              ) : users.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-400/20 dark:bg-amber-400/10">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{u.businessName}</p>
                    <p className="text-[11.5px] text-amber-700 dark:text-amber-300">till {fmtPKT(u.until)}{u.note ? ` — ${u.note}` : ''}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 shrink-0 text-[12px]" disabled={busy} onClick={() => void endUserMaintenance(u.id, u.businessName)}>End</Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* top failing routes */}
      {data.errors.top.length > 0 ? (
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardContent className="p-4 sm:p-5">
            <h2 className="text-[14.5px] font-semibold text-slate-900 dark:text-slate-100">Top failing endpoints (24h)</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.errors.top.map((t) => (
                <span key={t.route} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-medium text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                  {t.route} <span className="ml-1 rounded bg-red-100 px-1.5 text-red-700">{t.count}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* recent errors feed */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardContent className="p-4 sm:p-5">
          <h2 className="text-[14.5px] font-semibold text-slate-900 dark:text-slate-100">Recent errors (last 50)</h2>
          {data.recent.length === 0 ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-400/20 dark:bg-emerald-400/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-[13px] font-medium text-emerald-800 dark:text-emerald-300">Koi error nahi — sab sahi chal raha hai 🎉</p>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400 dark:border-white/10">
                    <th className="py-2 pr-3 font-medium">Time (PKT)</th>
                    <th className="py-2 pr-3 font-medium">Level</th>
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 font-medium">Route</th>
                    <th className="py-2 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                      <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{fmtTimeOnly(e.createdAt)}</td>
                      <td className="py-2 pr-3">
                        <Badge className={e.level === 'ERROR' ? 'border-red-200 bg-red-50 text-red-600' : 'border-amber-200 bg-amber-50 text-amber-700'}>{e.level}</Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge className={SOURCE_META[e.source]?.cls ?? SOURCE_META.server.cls}>{SOURCE_META[e.source]?.label ?? e.source}</Badge>
                      </td>
                      <td className="max-w-[240px] truncate py-2 pr-3 font-mono text-[11.5px] text-slate-500" title={e.route ?? ''}>{e.route ?? '—'}</td>
                      <td className="max-w-[420px] py-2 text-slate-700 dark:text-slate-300" title={e.message}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* global maintenance dialog */}
      <Dialog open={maintOpen} onOpenChange={setMaintOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wrench className="h-4 w-4 text-[#2f56d6]" /> Global maintenance start karein</DialogTitle>
            <DialogDescription>
              Sab distributors + bookers ka login/API band ho jayega jab tak window khatam na ho. Aap ka panel chalta rahega.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>Kitni der tak?</Label>
              <div className="grid grid-cols-4 gap-2">
                {(['1h', '3h', '6h', 'midnight'] as const).map((k) => (
                  <Button key={k} type="button" size="sm" variant={maintPreset === k ? 'default' : 'outline'}
                    className={maintPreset === k ? 'bg-[#2f56d6] hover:bg-[#2546b8]' : ''}
                    onClick={() => setMaintPreset(k)}>
                    {k === 'midnight' ? 'Raat 12' : k}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maint-custom">Ya custom time (PKT)</Label>
              <Input id="maint-custom" type="datetime-local"
                onChange={(e) => { setMaintCustom(e.target.value); if (e.target.value) setMaintPreset('custom') }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maint-note">Note (optional) — users ko dikhega</Label>
              <Input id="maint-note" placeholder="e.g. New features add ho rahi hain" value={maintNote} onChange={(e) => setMaintNote(e.target.value)} maxLength={160} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMaintOpen(false)}>Cancel</Button>
            <Button className="bg-[#2f56d6] hover:bg-[#2546b8]" disabled={busy} onClick={() => void toggleGlobalMaintenance(true)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />} Start maintenance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
