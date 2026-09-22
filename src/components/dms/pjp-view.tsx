'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useDMS } from '@/lib/dms-store'
import { api, fmtDate, fmtPKR, STATUS_STYLES, statusLabel } from '@/lib/dms-api'
import type { PJPPlanDTO, OutletDTO, SalesmanPerfDTO } from '@/lib/dms-types'
import { Plus, MapPin, Clock, CheckCircle2, LogIn, LogOut, Navigation, Users, Target, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export function PJPView() {
  const user = useDMS((s) => s.user)
  const [plans, setPlans] = useState<PJPPlanDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

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
          <p className="text-sm text-slate-500">Daily route planning with geo check-in/out aur live tracking</p>
        </div>
        {user?.role !== 'SALESMAN' && (
          <Button onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="h-4 w-4 mr-1.5" /> New Journey Plan
          </Button>
        )}
      </div>

      {plans.length === 0 && (
        <Card><CardContent className="py-16 text-center text-sm text-slate-400">Koi journey plan nahi — naya plan banayein</CardContent></Card>
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

      <CreatePJPDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
    </div>
  )
}

function CreatePJPDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const user = useDMS((s) => s.user)
  const [salesmen, setSalesmen] = useState<SalesmanPerfDTO[]>([])
  const [outlets, setOutlets] = useState<OutletDTO[]>([])
  const [salesmanId, setSalesmanId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setSalesmanId(''); setSelected(new Set())
    api<{ salesmen: SalesmanPerfDTO[] }>(`/api/field-force?userId=${user.id}`).then((r) => {
      setSalesmen(r.salesmen)
      if (r.salesmen[0]) {
        setSalesmanId(r.salesmen[0].id)
        loadOutlets(r.salesmen[0].id)
      }
    }).catch(() => {})
  }, [open, user])

  function loadOutlets(smId: string) {
    api<{ outlets: OutletDTO[] }>(`/api/outlets?userId=${user!.id}`).then((r) => {
      const mine = r.outlets.filter((o) => o.salesmanName && salesmen.find((s) => s.id === smId)?.name === o.salesmanName)
      setOutlets(mine.length > 0 ? mine : r.outlets)
    }).catch(() => {})
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function save() {
    if (!salesmanId || selected.size === 0) {
      toast({ title: 'Missing info', description: 'Salesman aur kam az kam 1 outlet select karein', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      // Task 25-b: tenant guard ke liye userId bhi jata hai (API ownership validate karta hai)
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      await api('/api/pjp', { method: 'POST', body: JSON.stringify({ userId: user?.id, salesmanId, date: new Date().toISOString(), outletIds: Array.from(selected) }) })
      toast({ title: 'Journey Plan Created ✓', description: `${selected.size} outlets ka route plan ban gaya` })
      onOpenChange(false)
      onCreated()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Navigation className="h-5 w-5 text-emerald-600" /> New Journey Plan (PJP)</DialogTitle>
          <DialogDescription>Aaj ke visits ke liye route plan banayein</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 overflow-hidden flex-1">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Salesman</label>
            <Select value={salesmanId} onValueChange={(v) => { setSalesmanId(v); setSelected(new Set()); loadOutlets(v) }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{salesmen.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.outletsAssigned} outlets)</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 min-h-0 flex-1">
            <label className="text-sm font-medium flex items-center gap-1"><Target className="h-3.5 w-3.5" /> Outlets ({selected.size} selected)</label>
            <ScrollArea className="h-56 rounded-lg border p-2">
              <div className="space-y-1.5">
                {outlets.map((o) => (
                  <label key={o.id} className="flex items-center gap-2.5 rounded-md hover:bg-emerald-50/50 p-2 cursor-pointer">
                    <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{o.name}</p>
                      <p className="text-xs text-slate-400">{o.channel} • {o.address}</p>
                    </div>
                  </label>
                ))}
                {outlets.length === 0 && <p className="text-xs text-slate-400 p-4 text-center">Is salesman ke outlets nahi mile</p>}
              </div>
            </ScrollArea>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />} Create Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
