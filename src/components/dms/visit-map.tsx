'use client'

/**
 * Task 36 — Visit Map view (DISTRIBUTOR).
 *
 * Aaj ke PJP visits ko OpenStreetMap par plot karta hai:
 * - Filter: date + salesman (all ya specific booker)
 * - Stats: coverage %, planned, visited (check-in + completed), missed, GPS missing
 * - Map: status-colored pins (pending/check-in/completed/missed) + per-salesman dashed route line
 * - Side list: sequence-wise visits with time — click par map us pin par fly karta hai
 *
 * Data: /api/visit-map — Visit.checkInLat/Lng + Outlet.lat/Lng (jo pehle se capture hota hai).
 */

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LocateFixed, Loader2, MapPinOff, Route } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useDMS } from '@/lib/dms-store'
import type { MapPoint, MapRoute } from './map-canvas'

// Leaflet sirf client par — SSR off
const MapCanvas = dynamic(() => import('./map-canvas').then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-100 rounded-xl text-slate-400 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Map load ho raha hai...
    </div>
  ),
})

interface VisitRow {
  id: string
  sequence: number
  status: string
  checkInAt: string | null
  checkInLat: number | null
  checkInLng: number | null
  outlet: { id: string; name: string; code: string; channel: string; address: string | null; lat: number | null; lng: number | null }
}

interface PlanRow {
  planId: string
  salesmanId: string
  salesmanName: string
  planStatus: string
  visits: VisitRow[]
}

interface MapData {
  date: string
  salesmen: { id: string; name: string }[]
  plans: PlanRow[]
  stats: { planned: number; checkedIn: number; completed: number; missed: number; visited: number; withGps: number; coveragePct: number }
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600 border-slate-200',
  CHECKED_IN: 'bg-amber-50 text-amber-700 border-amber-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MISSED: 'bg-red-50 text-red-700 border-red-200',
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  CHECKED_IN: 'Check-in',
  COMPLETED: 'Completed',
  MISSED: 'Missed',
}

function todayLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function VisitMapView() {
  const { user } = useDMS()
  const { toast } = useToast()
  const [date, setDate] = useState(todayLocal())
  const [salesman, setSalesman] = useState('all')
  const [data, setData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const res = await fetch(`/api/visit-map?userId=${user.id}&date=${date}${salesman !== 'all' ? `&salesmanId=${salesman}` : ''}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Visit map load failed')
      setData(json as MapData)
    } catch (e) {
      toast({ title: 'Visit Map fail', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [user?.id, date, salesman])

  useEffect(() => {
    load()
  }, [load])

  const points: MapPoint[] = useMemo(() => {
    const out: MapPoint[] = []
    for (const p of data?.plans ?? []) {
      for (const v of p.visits) {
        if (v.outlet.lat == null || v.outlet.lng == null) continue
        out.push({
          id: v.id,
          lat: v.outlet.lat,
          lng: v.outlet.lng,
          status: v.status,
          name: v.outlet.name,
          code: v.outlet.code,
          channel: v.outlet.channel,
          checkInAt: v.checkInAt,
          sequence: v.sequence,
          salesmanName: p.salesmanName,
        })
      }
    }
    return out
  }, [data])

  // Route line: per salesman — visited (CHECKED_IN/COMPLETED) pins ko check-in time order me jodo
  const routes: MapRoute[] = useMemo(() => {
    const bySalesman = new Map<string, { name: string; coords: [number, number][] }>()
    const all = data?.plans ?? []
    for (const p of all) {
      if (!bySalesman.has(p.salesmanId)) bySalesman.set(p.salesmanId, { name: p.salesmanName, coords: [] })
      const entry = bySalesman.get(p.salesmanId)!
      p.visits
        .filter((v) => (v.status === 'CHECKED_IN' || v.status === 'COMPLETED') && v.outlet.lat != null && v.outlet.lng != null)
        .sort((a, b) => (a.checkInAt ?? '').localeCompare(b.checkInAt ?? '') || a.sequence - b.sequence)
        .forEach((v) => entry.coords.push([v.outlet.lat as number, v.outlet.lng as number]))
    }
    return [...bySalesman.entries()]
      .filter(([, v]) => v.coords.length >= 2)
      .map(([salesmanId, v]) => ({ salesmanId, coords: v.coords }))
  }, [data])

  const noGps = (data?.stats.planned ?? 0) - (data?.stats.withGps ?? 0)

  const KPI = ({ icon: Icon, label, value, cls }: { icon: LucideIcon; label: string; value: string | number; cls: string }) => (
    <Card className={`border ${cls}`}>
      <CardContent className="p-3 flex items-center gap-2.5">
        <Icon className="h-4.5 w-4.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide opacity-70 truncate">{label}</p>
          <p className="text-lg font-bold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="h-full flex flex-col gap-3 overflow-y-auto">
      {/* Header: filters */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-2 mr-auto">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-600/25">
            <Route className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">Visit Map</h1>
            <p className="text-xs text-slate-500">Order bookers ke check-ins live route par — coverage ek nazar me</p>
          </div>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <Select value={salesman} onValueChange={setSalesman}>
          <SelectTrigger className="h-9 w-[190px] text-sm">
            <SelectValue placeholder="Order Booker" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Saare Order Bookers</SelectItem>
            {(data?.salesmen ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 shrink-0">
        <KPI icon={Route} label="Coverage" value={`${data?.stats.coveragePct ?? 0}%`} cls="border-blue-200 bg-blue-50 text-blue-700" />
        <KPI icon={Route} label="Planned" value={data?.stats.planned ?? 0} cls="border-slate-200 bg-white text-slate-700" />
        <KPI icon={LocateFixed} label="Visited" value={data?.stats.visited ?? 0} cls="border-emerald-200 bg-emerald-50 text-emerald-700" />
        <KPI icon={MapPinOff} label="Missed" value={data?.stats.missed ?? 0} cls="border-red-200 bg-red-50 text-red-700" />
        <KPI icon={MapPinOff} label="No GPS" value={noGps} cls="border-amber-200 bg-amber-50 text-amber-700" />
      </div>

      {/* Map + list */}
      <div className="flex-1 min-h-[420px] grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
        <div className="relative min-h-[380px] rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-400 gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Visits load ho rahe hain...
            </div>
          ) : (
            <MapCanvas points={points} routes={routes} />
          )}
          {/* Legend */}
          <div className="absolute bottom-2 left-2 z-[1000] bg-white/95 border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center gap-2.5 text-[10.5px] text-slate-600 shadow-sm flex-wrap">
            {[
              ['#10b981', 'Completed'],
              ['#f59e0b', 'Check-in'],
              ['#94a3b8', 'Pending'],
              ['#ef4444', 'Missed'],
            ].map(([c, l]) => (
              <span key={l} className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full border border-white shadow-sm" style={{ background: c }} /> {l}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 border-t-2 border-dashed border-blue-500 align-middle" /> Route
            </span>
          </div>
        </div>

        {/* Side list */}
        <Card className="border-slate-200 flex flex-col overflow-hidden">
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {!data || data.plans.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-400 text-center px-6 py-10">
                Is date par koi PJP plan nahi mila — dusri date select karein.
              </div>
            ) : (
              data.plans.map((p) => (
                <div key={p.planId} className="border-b border-slate-100 last:border-0">
                  <div className="sticky top-0 bg-slate-50/95 backdrop-blur px-3 py-1.5 text-xs font-bold text-slate-700 flex items-center justify-between">
                    <span className="truncate">{p.salesmanName}</span>
                    <span className="text-[10px] font-medium text-slate-400 uppercase">{p.planStatus.replace('_', ' ')}</span>
                  </div>
                  <ul>
                    {p.visits.map((v) => (
                      <li key={v.id} className="flex items-center gap-2 px-3 py-1.5 text-xs border-t border-slate-50">
                        <span className="text-slate-400 w-5 text-right shrink-0">{v.sequence}.</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-700 truncate">{v.outlet.name}</p>
                          <p className="text-[10px] text-slate-400">{v.outlet.code} · {fmtTime(v.checkInAt)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[v.status] ?? ''}`}>
                          {STATUS_LABEL[v.status] ?? v.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
