'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR } from '@/lib/dms-api'
import type { OutletDTO, SalesmanPerfDTO } from '@/lib/dms-types'
import { BulkImportDialog, type BulkColumn, type ParseOutcome } from '@/components/dms/bulk-import-dialog'
import { Plus, Search, MapPin, Loader2, Phone, Store, Pencil, Settings2, FileText, CalendarDays, Upload, ShoppingCart, UserCheck } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export const DAY_LIST = [
  { code: 'MON', label: 'Mon' }, { code: 'TUE', label: 'Tue' }, { code: 'WED', label: 'Wed' },
  { code: 'THU', label: 'Thu' }, { code: 'FRI', label: 'Fri' }, { code: 'SAT', label: 'Sat' }, { code: 'SUN', label: 'Sun' },
] as const

export const DAY_LABELS: Record<string, string> = Object.fromEntries(DAY_LIST.map((d) => [d.code, d.label]))

/** "MON,WED" -> chips */
export function VisitDayChips({ visitDays, compact }: { visitDays: string; compact?: boolean }) {
  if (!visitDays) {
    return <Badge variant="outline" className="border-slate-200 text-slate-500 bg-slate-50 text-[9px]">Roz Visit</Badge>
  }
  const days = visitDays.split(',').filter(Boolean)
  return (
    <div className="flex flex-wrap gap-0.5">
      {days.map((d) => (
        <span key={d} className={`${compact ? 'text-[8px] px-1 py-0' : 'text-[9px] px-1.5 py-0.5'} rounded bg-violet-50 border border-violet-200 text-violet-700 font-bold leading-tight`}>
          {DAY_LABELS[d] ?? d}
        </span>
      ))}
    </div>
  )
}

export const OUTLET_IMPORT_COLUMNS: BulkColumn[] = [
  { key: 'name', label: 'Shop Name', required: true, hint: 'Shop ka naam — duplicate naam skip ho jayengi' },
  { key: 'ownerName', label: 'Owner' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City', hint: 'Khali chhora to Lahore default' },
  { key: 'channel', label: 'Channel', hint: 'KIRYANA / SUPERMARKET / WHOLESALE / GENERAL' },
  { key: 'creditDays', label: 'Credit Days', hint: 'Default 7' },
  { key: 'ntn', label: 'NTN', hint: 'NTN likha to FILER ban jayegi' },
  { key: 'cnic', label: 'CNIC' },
  { key: 'filerStatus', label: 'Filer Status', hint: 'FILER ya NON_FILER — khali to NTN se derive' },
  { key: 'visitDays', label: 'Visit Days', hint: 'MON,WED,SAT — khali to roz visit' },
  { key: 'salesman', label: 'Salesman', hint: 'Booker ka naam ya email — match nahi to bina booker import' },
]

export const OUTLET_SAMPLE_ROWS = [
  ['Barkat Kiryana Store', 'Haji Aslam', '0300-1234567', 'Shalimar Colony, Shop 4', 'Multan', 'KIRYANA', '7', '', '31301-0409967-1', 'NON_FILER', 'MON,WED,SAT', ''],
  ['Al-Karam Super Mart', 'Nadeem Ahmed', '0321-9876543', 'Main Boulevard, Gulberg', 'Lahore', 'SUPERMARKET', '15', '1234567-8', '', 'FILER', 'TUE,FRI', ''],
  ['Madina Wholesale', 'Sheikh Imran', '0345-1122334', 'Sabzi Mandi Road', 'Faisalabad', 'WHOLESALE', '21', '', '', '', '', ''],
]

export function OutletsView() {
  const user = useDMS((s) => s.user)
  const setFocusOrderOutlet = useDMS((s) => s.setFocusOrderOutlet)
  const router = useRouter()
  const [outlets, setOutlets] = useState<OutletDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [taxFilter, setTaxFilter] = useState<'ALL' | 'FILER' | 'NON_FILER'>('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [editOutlet, setEditOutlet] = useState<OutletDTO | null>(null)
  const [taxOpen, setTaxOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Task 67: is shop ka foran order book karo — /orders par New Order dialog isi shop ke sath khulega
  function bookOrderFor(outletId: string) {
    setFocusOrderOutlet(outletId)
    router.push('/orders')
  }

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const r = await api<{ outlets: OutletDTO[] }>(`/api/outlets?userId=${user.id}`)
      setOutlets(r.outlets)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [user])

  const filtered = useMemo(() => outlets.filter((o) => {
    if (taxFilter !== 'ALL' && o.filerStatus !== taxFilter) return false
    return `${o.name} ${o.code} ${o.channel} ${o.address ?? ''} ${o.ntn ?? ''} ${o.cnic ?? ''}`.toLowerCase().includes(search.toLowerCase())
  }), [outlets, search, taxFilter])

  const filerCount = outlets.filter((o) => o.filerStatus === 'FILER').length

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Geo-tagged Outlets</h2>
          <p className="text-xs text-slate-500">{outlets.length} retailers — {filerCount} Filer, {outlets.length - filerCount} Non-Filer (advance tax bill par add)</p>
        </div>
        {user?.role !== 'SALESMAN' && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setTaxOpen(true)} className="border-slate-300 text-slate-700 hover:bg-slate-50">
              <Settings2 className="h-4 w-4 mr-1.5" /> Tax Settings
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
              <Upload className="h-4 w-4 mr-1.5" /> Bulk Import
            </Button>
            <Button onClick={() => { setEditOutlet(null); setFormOpen(true) }} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-1.5" /> Register Outlet</Button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Outlet / NTN search karein..." className="pl-9" />
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(['ALL', 'FILER', 'NON_FILER'] as const).map((f) => (
            <button key={f} onClick={() => setTaxFilter(f)}
              className={`h-8 rounded-md px-3 text-[11px] font-medium transition-colors ${taxFilter === f ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
              {f === 'ALL' ? 'Sab' : f === 'FILER' ? 'Filer (0.5%)' : 'Non-Filer (2.5%)'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid flex-1 content-start gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : (
        <div className="grid flex-1 content-start gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((o) => (
            <Card key={o.id} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{o.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{o.code}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50 text-[10px]">{o.channel}</Badge>
                    {o.filerStatus === 'FILER' ? (
                      <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50 text-[10px]">FILER 0.5%</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50 text-[10px]">NON-FILER 2.5%</Badge>
                    )}
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <p className="flex items-center gap-1.5 truncate"><Store className="h-3 w-3 shrink-0" /> Owner: {o.ownerName ?? '—'}</p>
                  <p className="flex items-center gap-1.5 truncate"><Phone className="h-3 w-3 shrink-0" /> {o.phone ?? '—'}</p>
                  <p className="flex items-center gap-1.5 truncate"><MapPin className="h-3 w-3 shrink-0 text-emerald-600" /> {o.address ?? '—'}</p>
                  <p className="flex items-center gap-1.5 truncate"><FileText className="h-3 w-3 shrink-0 text-slate-400" /> NTN: <span className="font-mono text-slate-600">{o.ntn ?? '—'}</span><span className="text-slate-300">|</span> CNIC: <span className="font-mono text-slate-600">{o.cnic ?? '—'}</span></p>
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="flex items-center gap-1 text-slate-400"><CalendarDays className="h-3 w-3 text-violet-500 shrink-0" /> Visit:</span>
                    <VisitDayChips visitDays={o.visitDays} compact />
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t flex items-center justify-between text-xs">
                  <div>
                    <p className="text-slate-400">Booker: {o.salesmanName
                      ? <span className="text-emerald-700 font-medium">{o.salesmanName}</span>
                      : <span className="text-amber-600 font-medium">assign nahi ⚠</span>}</p>
                    <p className="text-slate-400">Credit: <span className="text-slate-600 font-medium">{o.creditDays} days</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-bold text-emerald-700">{fmtPKR(o.totalValue)}</p>
                      <p className="text-slate-400">{o.totalOrders} orders</p>
                    </div>
                    {user?.role !== 'SALESMAN' && (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-[11px] px-2"
                          title="Is shop ka order book karein — New Order dialog isi shop ke sath khulega"
                          onClick={() => bookOrderFor(o.id)}>
                          <ShoppingCart className="h-3.5 w-3.5 mr-1" /> Order Book
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-emerald-600" title="Edit outlet / tax status"
                          onClick={() => { setEditOutlet(o); setFormOpen(true) }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-10 text-center text-sm text-slate-400">Koi outlet nahi mila</div>
          )}
        </div>
      )}

      <OutletFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={load} outlet={editOutlet} />
      <TaxSettingsDialog open={taxOpen} onOpenChange={setTaxOpen} />
      <BulkImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Bulk Shops Import"
        description="Excel/CSV se saari shops ek sath import karein — duplicate naam wali shops skip ho jayengi"
        accent="bg-emerald-600 hover:bg-emerald-700"
        columns={OUTLET_IMPORT_COLUMNS}
        sampleRows={OUTLET_SAMPLE_ROWS}
        parseRow={parseOutletRow}
        importRequest={async (rows) => {
          const r = await api<{ imported: number; skipped: { row: number; name: string; reason: string }[]; warnings?: { row: number; name: string; reason: string }[] }>('/api/outlets/import', {
            method: 'POST',
            body: JSON.stringify({ userId: user?.id, rows }),
          })
          toast({ title: `${r.imported} shops import hui ✓`, description: r.skipped.length ? `${r.skipped.length} skip hui — wajah dialog mein dekhein` : 'Sab shops register ho gayin' })
          return r
        }}
        onDone={load}
      />
    </div>
  )
}

/** Outlet CSV row validate — naam zaroori, credit days number hona chahiye (baqi server normalize karta hai) */
function parseOutletRow(r: Record<string, string>): ParseOutcome<Record<string, string>> {
  const name = (r.name ?? '').trim()
  if (!name) return { ok: false, error: 'Shop ka naam zaroori hai' }
  const cd = (r.creditDays ?? '').trim()
  if (cd && !Number.isFinite(Number(cd))) return { ok: false, error: `Credit days ghalat: "${cd}"` }
  const fs = (r.filerStatus ?? '').trim().toUpperCase()
  if (fs && fs !== 'FILER' && fs !== 'NON_FILER') return { ok: false, error: 'Filer Status FILER ya NON_FILER likhein (ya khali chhorein)' }
  return { ok: true, value: r }
}

/** Add + Edit shared — Filer/Non-Filer toggle + NTN (NTN likha to Filer default) */
function OutletFormDialog({ open, onOpenChange, onCreated, onSaved, outlet }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated?: () => void
  onSaved?: () => void
  outlet?: OutletDTO | null
}) {
  const user = useDMS((s) => s.user)
  const editing = !!outlet
  const [form, setForm] = useState({ name: '', ownerName: '', phone: '', address: '', city: 'Lahore', channel: 'KIRYANA', creditDays: '7', ntn: '', cnic: '', filerStatus: 'NON_FILER', visitDays: [] as string[], salesmanId: '' })
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [gettingLoc, setGettingLoc] = useState(false)
  const [saving, setSaving] = useState(false)
  // Task 68: route booker assignment — shop jis booker ko assign hogi, order booking mein sirf usi ko dikhegi
  const [salesmen, setSalesmen] = useState<SalesmanPerfDTO[]>([])

  useEffect(() => {
    if (open) {
      setForm(outlet ? {
        name: outlet.name, ownerName: outlet.ownerName ?? '', phone: outlet.phone ?? '', address: outlet.address ?? '',
        city: outlet.city, channel: outlet.channel, creditDays: String(outlet.creditDays),
        ntn: outlet.ntn ?? '', cnic: outlet.cnic ?? '', filerStatus: outlet.filerStatus,
        visitDays: outlet.visitDays ? outlet.visitDays.split(',').filter(Boolean) : [],
        salesmanId: outlet.salesmanId ?? '',
      } : { name: '', ownerName: '', phone: '', address: '', city: 'Lahore', channel: 'KIRYANA', creditDays: '7', ntn: '', cnic: '', filerStatus: 'NON_FILER', visitDays: [], salesmanId: '' })
      setCoords(null)
      if (user) api<{ salesmen: SalesmanPerfDTO[] }>(`/api/field-force?userId=${user.id}`).then((r) => setSalesmen(r.salesmen)).catch(() => {})
    }
  }, [open, outlet, user])

  const toggleDay = (code: string) => {
    setForm((f) => ({
      ...f,
      visitDays: f.visitDays.includes(code) ? f.visitDays.filter((d) => d !== code) : [...f.visitDays, code],
    }))
  }

  function captureGPS() {
    if (!navigator.geolocation) {
      toast({ title: 'GPS not available', variant: 'destructive' }); return
    }
    setGettingLoc(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGettingLoc(false) },
      () => { toast({ title: 'GPS access nahi mila', description: 'Manual coordinates enter nahi hue', variant: 'destructive' }); setGettingLoc(false) },
      { timeout: 8000 }
    )
  }

  async function save() {
    if (!form.name || !user?.profile) {
      toast({ title: !form.name ? 'Outlet name required' : 'Sirf distributor roles outlet bana sakte hain', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      const visitDays = form.visitDays.join(',')
      if (editing && outlet) {
        await api(`/api/outlets/${outlet.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...form, creditDays: Number(form.creditDays), ntn: form.ntn.trim() || null, cnic: form.cnic.trim() || null, visitDays, salesmanId: form.salesmanId || null }),
        })
        const assigned = salesmen.find((s) => s.id === form.salesmanId)
        toast({ title: 'Outlet Updated ✓', description: `${form.name} — booker: ${assigned?.name ?? 'unassigned'}, visit days: ${form.visitDays.length ? form.visitDays.join(', ') : 'Roz'} save ho gaya` })
      } else {
        await api('/api/outlets', {
          method: 'POST',
          body: JSON.stringify({ ...form, creditDays: Number(form.creditDays), distributorId: user.profile.id, lat: coords?.lat, lng: coords?.lng, ntn: form.ntn.trim() || null, cnic: form.cnic.trim() || null, visitDays, salesmanId: form.salesmanId || null }),
        })
        toast({ title: 'Outlet Registered ✓', description: `${form.name} geo-tagged with ${coords ? 'GPS location' : 'no location'}` })
      }
      onOpenChange(false)
      ;(onSaved ?? onCreated)?.()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Outlet' : 'Register New Outlet'}</DialogTitle>
          <DialogDescription>{editing ? 'Shop info aur filer/NTN status update karein' : 'Naye retailer ko geo-location ke sath add karein'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Outlet Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Barkat Kiryana Store" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Owner</Label><Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+92 3xx xxxxxxx" /></div>
          </div>
          <div className="grid gap-1.5"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Area, street..." /></div>

          {/* Task 68: Route Booker assignment — shop jis booker ko assign hogi wo order booking mein
              sirf usi booker ki shop list mein nazar aayegi (cascading filter) */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5">
            <p className="text-[11px] font-semibold text-slate-700 mb-1.5 flex items-center gap-1"><UserCheck className="h-3.5 w-3.5 text-emerald-600" /> Order Booker (Route) — kis booker ki shop hai?</p>
            <Select value={form.salesmanId} onValueChange={(v) => setForm({ ...form, salesmanId: v })}>
              <SelectTrigger className={form.salesmanId ? 'border-emerald-300 bg-white' : 'border-amber-300 bg-white'}>
                <SelectValue placeholder="Booker select karein..." />
              </SelectTrigger>
              <SelectContent>
                {salesmen.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}{s.region ? ` — ${s.region}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {form.salesmanId
                ? `✓ Ye shop order booking mein sirf is booker ki list mein aayegi — order isi ke account par book hoga`
                : '⚠ Bina booker ki shop order booking mein sab bookers ko nazar aayegi — assign karna best hai'}
            </p>
          </div>

          {/* Filer / Non-Filer + NTN */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2.5">
            <p className="text-[11px] font-semibold text-slate-700 mb-1.5">Tax Status — Advance Tax (bill par add hoga)</p>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-0.5 mb-2">
              <button type="button" onClick={() => setForm({ ...form, filerStatus: 'NON_FILER' })}
                className={`h-7 rounded-md text-[11px] font-medium transition-colors ${form.filerStatus === 'NON_FILER' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                Non-Filer
              </button>
              <button type="button" onClick={() => setForm({ ...form, filerStatus: 'FILER' })}
                className={`h-7 rounded-md text-[11px] font-medium transition-colors ${form.filerStatus === 'FILER' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                Filer (NTN)
              </button>
            </div>
            <div className="grid gap-1">
              <Label className="text-[11px]">NTN Number {form.filerStatus === 'FILER' && <span className="text-blue-600">(recommended)</span>}</Label>
              <Input value={form.ntn} onChange={(e) => setForm({ ...form, ntn: e.target.value, filerStatus: e.target.value.trim() ? 'FILER' : form.filerStatus })} placeholder="e.g. 1234567-8" className="font-mono" />
            </div>
            <div className="grid gap-1">
              <Label className="text-[11px]">C.N.I.C Number <span className="text-slate-400">(owner — bill par print hoga)</span></Label>
              <Input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="e.g. 31301-0409967-1" className="font-mono" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {form.filerStatus === 'FILER' ? 'Filer shop par advance tax kam (0.5% default) lagega' : 'Non-filer shop par advance tax zyada (2.5% default) lagega — rates Tax Settings se badal sakte hain'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Channel</Label>
              <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['KIRYANA', 'SUPERMARKET', 'WHOLESALE', 'GENERAL'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Credit Days</Label><Input type="number" value={form.creditDays} onChange={(e) => setForm({ ...form, creditDays: e.target.value })} /></div>
          </div>

          {/* Visit Days — order booker ko day-wise route ke liye */}
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2.5">
            <p className="text-[11px] font-semibold text-slate-700 mb-1 flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-violet-600" /> Visit Days — booker ko day-wise route milega</p>
            <div className="grid grid-cols-7 gap-1">
              {DAY_LIST.map((d) => {
                const on = form.visitDays.includes(d.code)
                return (
                  <button key={d.code} type="button" onClick={() => toggleDay(d.code)}
                    className={`h-8 rounded-md text-[10px] font-bold transition-colors ${on ? 'bg-violet-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    {d.label}
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {form.visitDays.length === 0 ? 'Koi day select nahi = shop <b>har roz</b> route mein rahegi' : `Booker ko ye shop sirf ${form.visitDays.join(', ')} ko nazar aayegi — end-of-month max recovery ke liye admin booker ki "All Routes" access ON karega (Recovery page)`}
            </p>
          </div>
          {!editing && (
            <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/40 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700 flex items-center gap-1"><MapPin className="h-4 w-4 text-emerald-600" /> Geo-tagging</p>
                  <p className="text-xs text-slate-500">{coords ? `Captured: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'Outlet ki GPS location capture karein'}</p>
                </div>
                <Button size="sm" variant="outline" onClick={captureGPS} disabled={gettingLoc} className="border-emerald-300 text-emerald-700">
                  {gettingLoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4 mr-1" />} Capture
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {editing ? 'Save Changes' : 'Register Outlet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Tax settings — advance tax (filer / non-filer %) — Task 37: GST ab Product Catalog mein per-product set hota hai */
function TaxSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const user = useDMS((s) => s.user)
  const [filer, setFiler] = useState('0.5')
  const [nonFiler, setNonFiler] = useState('2.5')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      api<{ settings: { filerTaxRate: number; nonFilerTaxRate: number } }>(`/api/settings?userId=${(JSON.parse(localStorage.getItem('dms_session') ?? 'null'))?.id ?? ''}`)
        .then((r) => { setFiler(String(r.settings.filerTaxRate)); setNonFiler(String(r.settings.nonFilerTaxRate)) })
        .catch(() => {})
    }
  }, [open])

  async function save() {
    const f = Number(filer), nf = Number(nonFiler)
    if (!Number.isFinite(f) || f < 0 || f > 100 || !Number.isFinite(nf) || nf < 0 || nf > 100) {
      toast({ title: 'Invalid rate', description: 'Rates 0 se 100 ke beech honi chahiye', variant: 'destructive' }); return
    }
    if (!user) return
    setSaving(true)
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ userId: user.id, filerTaxRate: f, nonFilerTaxRate: nf }) })
      toast({ title: 'Tax Settings Updated ✓', description: `Adv Tax: Filer ${f}% / Non-Filer ${nf}% — bill naye settings se print hoga (GST ab har product ke apne rate se)` })
      onOpenChange(false)
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const f = Number(filer) || 0, nf = Number(nonFiler) || 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-blue-600" /> Tax Settings</DialogTitle>
          <DialogDescription>Advance tax rates — bill inhi settings ke hisab se print hota hai (GST ab Product Catalog mein har product ke apne rate se)</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Advance Tax (Filer / Non-Filer)</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Filer %</Label>
              <Input type="number" min={0} step={0.05} value={filer} onChange={(e) => setFiler(e.target.value)} />
              <p className="text-[10px] text-slate-400">Rs 1,000 par Rs {(f * 10).toFixed(1)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>Non-Filer %</Label>
              <Input type="number" min={0} step={0.05} value={nonFiler} onChange={(e) => setNonFiler(e.target.value)} />
              <p className="text-[10px] text-slate-400">Rs 1,000 par Rs {(nf * 10).toFixed(1)}</p>
            </div>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5 text-[11px] text-slate-600 leading-relaxed">
            <p><b>Misal:</b> Rs 10,000 ka bill — Filer shop par Rs {(10000 * f / 100).toFixed(0)} add hoga (total Rs {(10000 + 10000 * f / 100).toFixed(0)}), Non-Filer par Rs {(10000 * nf / 100).toFixed(0)} (total Rs {(10000 + 10000 * nf / 100).toFixed(0)}).</p>
            <p className="mt-1">Rate sirf <b>naye orders</b> par lagta hai — purani invoices apne booking-waqt ka rate rakhti hain.</p>
          </div>
          <p className="text-[11px] text-slate-500 rounded-lg bg-slate-50 border border-slate-100 p-2.5">GST (sales tax) ab <b>Product Catalog</b> mein har product ke apne form se set hota hai — kis product par kitni % aur kis par bilkul nahi. Wahan se hi bill print hoga.</p>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="w-full bg-blue-600 hover:bg-blue-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Save Tax Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
