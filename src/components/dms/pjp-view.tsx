'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useDMS } from '@/lib/dms-store'
import { api, fmtDate, STATUS_STYLES, statusLabel } from '@/lib/dms-api'
import type { PJPPlanDTO } from '@/lib/dms-types'
import { MapPin, Clock, LogIn, LogOut, Navigation } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

/**
 * Task 82 — PJP page ab sirf HISTORY/tracking hai.
 * Manual "New Journey Plan" dialog HATA diya — route ab AUTO hai:
 * Shops page pe shop ko booker + din assign karo, booker app kholte hi
 * /api/pjp/today us din ka plan khud bana deta hai (roz wali shops har roz).
 */
export function PJPView() {
  const user = useDMS((s) => s.user)
  const [plans, setPlans] = useState<PJPPlanDTO[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const res = await api<{ plans: PJPPlanDTO[] }>(`/api/pjp?userId=${user.id}`)
      setPlans(res.plans)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load()   }, [user])

  async function visitAction(visitId: string, action: 'CHECK_IN' | 'CHECK_OUT') {
    let lat: number | null = null
    let lng: number | null = null
    if (action === 'CHECK_IN' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }))
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch { /* GPS unavailable — continue without */ }
    }
    try {
      await api(`/api/visits/${visitId}`, { method: 'PATCH', body: JSON.stringify({ action, lat, lng }) })
      toast({
        title: action === 'CHECK_IN' ? 'Checked In ✓' : 'Visit Completed ✓',
        description: action === 'CHECK_IN' ? 'GPS location capture ho gayi' : 'Visit complete — next outlet par jayein',
      })
      load()
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    }
  }

  if (loading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>

  const today = new Date().toDateString()

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">PJP — Permanent Journey Plans</h2>
          <p className="text-sm text-slate-500">Route ab AUTO hai — visit tracking + history yahan nazar aati hai</p>
        </div>
      </div>

      {/* Task 82: naya mechanism ka info strip */}
      <Card className="border-violet-200 bg-violet-50">
        <CardContent className="py-3.5 px-4 flex items-start gap-2.5">
          <Navigation className="h-4 w-4 text-violet-600 mt-0.5 shrink-0" />
          <p className="text-xs text-violet-900 leading-relaxed">
            <b>Route banane ki zaroorat khatam:</b> Shops page par shop ko <b>orderbooker + din</b> assign karein —
            booker apni app kholti hi usi din ki shops khud dekh lega (jis shop pe din assign nahi, wo har roz nazar aayegi).
            Admin ke <b>Settings</b> mein Jumma OFF + Unplanned orders ke switches hain.
          </p>
        </CardContent>
      </Card>

      {plans.length === 0 && (
        <Card><CardContent className="py-16 text-center text-sm text-slate-400">Koi plan nahi — booker app kholte hi aaj ka plan khud ban jata hai</CardContent></Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((p) => {
          const isToday = new Date(p.date).toDateString() === today
          const completed = p.visits.filter((v) => v.status === 'COMPLETED').length
          return (
            <Card key={p.id} className={`border shadow-sm ${isToday ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-slate-200'}`}>
              <CardHeader className="pb-2 flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {p.salesmanName}
                    {isToday && <Badge className="bg-emerald-600 text-white text-[9px] px-1.5">AAJ</Badge>}
                  </CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {fmtDate(p.date)} • {completed}/{p.visits.length} visits complete
                  </p>
                </div>
                <Badge variant="outline" className={STATUS_STYLES[p.status]}>{statusLabel(p.status)}</Badge>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-72">
                  <div className="space-y-2">
                    {p.visits.map((v) => (
                      <div key={v.id} className="rounded-lg border p-3 flex items-start gap-3">
                        <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">{v.sequence}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-slate-800">{v.outletName}</p>
                            <Badge variant="outline" className="text-[9px] px-1 py-0">{v.channel}</Badge>
                          </div>
                          <p className="text-xs text-slate-400 truncate">{v.area}</p>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <Badge variant="outline" className={`${STATUS_STYLES[v.status]} text-[9px] px-1.5`}>{statusLabel(v.status)}</Badge>
                            {v.checkInAt && (
                              <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                <MapPin className="h-3 w-3" /> In: {fmtDate(v.checkInAt, true)}
                                {v.checkInLat ? ` (${v.checkInLat.toFixed(3)}, ${v.checkInLng?.toFixed(3)})` : ''}
                              </span>
                            )}
                            {v.notes && <span className="text-[10px] text-emerald-600">📝 {v.notes}</span>}
                          </div>
                        </div>
                        {isToday && (
                          <div className="flex flex-col gap-1 shrink-0">
                            {v.status === 'PENDING' && (
                              <Button size="sm" onClick={() => visitAction(v.id, 'CHECK_IN')} className="h-7 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700">
                                <LogIn className="h-3 w-3 mr-0.5" /> Check In
                              </Button>
                            )}
                            {v.status === 'CHECKED_IN' && (
                              <Button size="sm" onClick={() => visitAction(v.id, 'CHECK_OUT')} className="h-7 text-[10px] px-2 bg-teal-600 hover:bg-teal-700">
                                <LogOut className="h-3 w-3 mr-0.5" /> Check Out
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
