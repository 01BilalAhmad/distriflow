'use client'

/**
 * Task 85 — NEW SHOPS (Admin approval page)
 * Booker (mobile offline app / web portal) ne jo nayi shops tag ki, wo PENDING status mein
 * yahan aati hain. Admin: (1) poora data EDIT kar sakta hai — approval se pehle BHI aur baad
 * MEIN bhi, (2) APPROVE kare — shop phir Outlets/route/orders mein nazar aati hai.
 * Approve hone tak pending shop ke orders main billing lists mein chhupe rehte hain.
 */

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate } from '@/lib/dms-api'
import { toast } from '@/hooks/use-toast'
import { DAY_LIST } from '@/components/dms/outlets-view'
import { Store, MapPin, CheckCircle2, Pencil, Clock3, ShoppingBag, User, Phone, Loader2, RefreshCw } from 'lucide-react'

interface NewShopDTO {
  id: string
  code: string
  name: string
  ownerName: string | null
  phone: string | null
  address: string | null
  city: string
  channel: string
  cnic: string | null
  ntn: string | null
  lat: number | null
  lng: number | null
  status: string
  creditDays: number
  visitDays: string
  taggedByName: string | null
  salesmanName: string | null
  clientRef: string | null
  createdAt: string
  ordersCount: number
  ordersTotal: number
  orderNos: string[]
  balance: number
}

const CHANNELS = ['KIRYANA', 'SUPERMARKET', 'WHOLESALE', 'GENERAL']

export function NewShopsView() {
  const user = useDMS((s) => s.user)
  const [data, setData] = useState<{ pending: NewShopDTO[]; approvedTagged: NewShopDTO[]; totals: { pending: number; pendingOrdersValue: number; approvedTagged: number } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'approved'>('pending')
  const [editShop, setEditShop] = useState<NewShopDTO | null>(null)
  const [approving, setApproving] = useState<string | null>(null)

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const r = await api<{ pending: NewShopDTO[]; approvedTagged: NewShopDTO[]; totals: { pending: number; pendingOrdersValue: number; approvedTagged: number } }>(`/api/new-shops?userId=${user.id}`)
      setData(r)
    } catch {
      toast({ title: 'Load failed', variant: 'destructive' })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function approve(shop: NewShopDTO) {
    if (!user) return
    // Confirm — dobara tap to finalize (ghalti se approve na ho)
    if (approving !== shop.id) { setApproving(shop.id); setTimeout(() => setApproving((v) => (v === shop.id ? null : v)), 3000); return }
    setApproving(shop.id)
    try {
      const r = await api<{ message: string }>(`/api/new-shops/${shop.id}`, { method: 'PATCH', body: JSON.stringify({ userId: user.id, action: 'APPROVE' }) })
      toast({ title: `Shop Approved ✓ — ${shop.name}`, description: r.message })
      setApproving(null)
      load()
    } catch (e) {
      toast({ title: 'Approve failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
      setApproving(null)
    }
  }

  const list = tab === 'pending' ? data?.pending ?? [] : data?.approvedTagged ?? []

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Store className="h-5 w-5 text-emerald-600" /> New Shops</h1>
          <p className="text-xs text-slate-500 mt-0.5">Order booker ki tag ki hui nayi shops — GPS location ke sath. Approve karte hi shop Outlets, route aur orders mein aa jayegi.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="h-8 border-slate-300 text-slate-600"><RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh</Button>
      </div>

      {/* Stat chips */}
      <div className="shrink-0 grid grid-cols-3 gap-2">
        <Card className="border-amber-200 bg-amber-50"><CardContent className="p-3">
          <p className="text-[10px] font-bold text-amber-700">PENDING APPROVAL</p>
          <p className="text-xl font-bold text-amber-800">{loading ? '...' : data?.totals.pending ?? 0}</p>
        </CardContent></Card>
        <Card className="border-slate-200"><CardContent className="p-3">
          <p className="text-[10px] font-bold text-slate-500">PENDING SHOP ORDERS</p>
          <p className="text-xl font-bold text-slate-800">{loading ? '...' : fmtPKR(data?.totals.pendingOrdersValue ?? 0)}</p>
          <p className="text-[10px] text-slate-400">approve ke baad billing mein aayenge</p>
        </CardContent></Card>
        <Card className="border-emerald-200 bg-emerald-50"><CardContent className="p-3">
          <p className="text-[10px] font-bold text-emerald-700">APPROVED (BOOKER-TAGGED)</p>
          <p className="text-xl font-bold text-emerald-800">{loading ? '...' : data?.totals.approvedTagged ?? 0}</p>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 w-fit">
        <button type="button" onClick={() => setTab('pending')}
          className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors ${tab === 'pending' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
          Pending Approval ({data?.totals.pending ?? 0})
        </button>
        <button type="button" onClick={() => setTab('approved')}
          className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors ${tab === 'approved' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
          Approved ({data?.totals.approvedTagged ?? 0})
        </button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-2.5">
        {loading && <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>}
        {!loading && list.length === 0 && (
          <Card><CardContent className="py-12 text-center">
            <Store className="h-8 w-8 mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-medium text-slate-500">{tab === 'pending' ? 'Koi pending shop nahi — booker abhi koi nayi shop tag nahi ki' : 'Abhi tak koi booker-tagged shop approve nahi hui'}</p>
          </CardContent></Card>
        )}
        {list.map((s) => (
          <Card key={s.id} className={`${s.status === 'PENDING' ? 'border-amber-200' : 'border-emerald-200'} shadow-sm`}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <Store className="h-4 w-4 text-slate-400 shrink-0" /> {s.name}
                    <Badge className={`${s.status === 'PENDING' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'} text-[9px]`}>
                      {s.status === 'PENDING' ? 'PENDING APPROVAL' : 'APPROVED'}
                    </Badge>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{s.code} • {s.channel} • {s.city} • Credit {s.creditDays} din</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="outline" size="sm" className="h-8 border-slate-300 text-slate-700" onClick={() => setEditShop(s)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  {s.status === 'PENDING' && (
                    <Button size="sm" onClick={() => approve(s)} className={`h-8 ${approving === s.id ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                      {approving === s.id ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Pakka Approve?</> : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve</>}
                    </Button>
                  )}
                </div>
              </div>

              {/* Details grid */}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px]">
                <p className="text-slate-600 flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-slate-400 shrink-0" /> Owner: <b className="text-slate-800">{s.ownerName ?? '—'}</b></p>
                <p className="text-slate-600 flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" /> Phone: <b className="text-slate-800">{s.phone ?? '—'}</b></p>
                <p className="text-slate-600 flex items-center gap-1.5 col-span-1 sm:col-span-2"><MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" /> Address: <b className="text-slate-800">{s.address ?? '—'}</b></p>
                <p className="text-slate-600">CNIC: <b className="text-slate-800 font-mono">{s.cnic ?? '—'}</b></p>
                <p className="text-slate-600">NTN: <b className="text-slate-800 font-mono">{s.ntn ?? '—'}</b>{s.ntn ? ' (Filer)' : ''}</p>
                {s.lat != null && s.lng != null && (
                  <p className="text-slate-600 flex items-center gap-1.5 col-span-1 sm:col-span-2">
                    <MapPin className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> GPS: <b className="text-slate-800 font-mono">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</b>
                    <span className="text-[10px] text-slate-400">(booker ne shop par tag ki)</span>
                  </p>
                )}
                <p className="text-slate-600 flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-slate-400 shrink-0" /> Tagged: {fmtDate(s.createdAt)}{s.taggedByName ? ` — ${s.taggedByName}` : ''}</p>
                <p className="text-slate-600">Visit days: <b className="text-slate-800">{s.visitDays ? s.visitDays.replaceAll(',', ', ') : 'Roz'}</b></p>
              </div>

              {/* Orders jo is shop par book hue (approve tak hidden) */}
              {s.ordersCount > 0 && (
                <div className="mt-2.5 rounded-lg bg-slate-50 border border-slate-200 p-2.5 flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-slate-400 shrink-0" />
                  <p className="text-[11px] text-slate-600 leading-snug">
                    {s.status === 'PENDING' ? 'Is shop par ' : 'Is shop par ab tak '}
                    <b>{s.ordersCount} orders / {fmtPKR(s.ordersTotal)}</b> book ho chuke hain{s.orderNos.length > 0 ? ` (${s.orderNos.join(', ')}${s.ordersCount > s.orderNos.length ? '...' : ''})` : ''}
                    {s.status === 'PENDING' ? ' — approve hone par billing reports mein nazar aayenge' : ''}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {editShop && (
        <EditNewShopDialog
          shop={editShop}
          onClose={() => setEditShop(null)}
          onSaved={() => { setEditShop(null); load() }}
        />
      )}
    </div>
  )
}

/* ================= EDIT DIALOG — approval se pehle aur baad dono mein ================= */
function EditNewShopDialog({ shop, onClose, onSaved }: { shop: NewShopDTO; onClose: () => void; onSaved: () => void }) {
  const user = useDMS((s) => s.user)
  const [saving, setSaving] = useState(false)
  // Task 92: shop categories dynamic list (fetch fail par hardcoded CHANNELS fallback)
  const [channels, setChannels] = useState<string[]>(CHANNELS)
  useEffect(() => {
    if (!user) return
    api<{ categories: { name: string }[] }>(`/api/shop-categories?userId=${user.id}`)
      .then((r) => setChannels(Array.from(new Set([...r.categories.map((c) => c.name), shop.channel].filter(Boolean)))))
      .catch(() => {})
  }, [user, shop.channel])
  const [form, setForm] = useState({
    name: shop.name, ownerName: shop.ownerName ?? '', ownerPhone: shop.phone ?? '', address: shop.address ?? '',
    city: shop.city, channel: shop.channel, cnic: shop.cnic ?? '', ntn: shop.ntn ?? '',
    creditDays: String(shop.creditDays), visitDays: shop.visitDays ? shop.visitDays.split(',').filter(Boolean) : [] as string[],
  })

  const toggleDay = (code: string) =>
    setForm((f) => ({ ...f, visitDays: f.visitDays.includes(code) ? f.visitDays.filter((d) => d !== code) : [...f.visitDays, code] }))

  async function save() {
    if (!user) return
    if (!form.name.trim()) { toast({ title: 'Shop ka naam lazmi hai', variant: 'destructive' }); return }
    setSaving(true)
    try {
      await api(`/api/new-shops/${shop.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          userId: user.id,
          name: form.name, ownerName: form.ownerName, ownerPhone: form.ownerPhone, address: form.address,
          city: form.city, channel: form.channel, cnic: form.cnic, ntn: form.ntn,
          creditDays: Number(form.creditDays) || 7, visitDays: form.visitDays.join(','),
        }),
      })
      toast({ title: 'Shop Updated ✓', description: `${form.name} — tamam details save ho gayi` })
      onSaved()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><Pencil className="h-4 w-4 text-emerald-600" /> Edit Shop — {shop.name}</DialogTitle>
          <DialogDescription>
            {shop.status === 'PENDING' ? 'Approve se pehle sab details theek kar lein — phir approve karein' : 'Approved shop bhi edit ho sakti hai'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Shop Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Owner Name *</Label><Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Owner Phone *</Label><Input value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} placeholder="+92 3xx xxxxxxx" /></div>
          </div>
          <div className="grid gap-1.5"><Label>Address *</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Channel Type</Label>
              <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* Task 92: DB-backed shop categories + legacy value merge */}
                  {channels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>CNIC (owner)</Label><Input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="35202-XXXXXXX-X" className="font-mono" /></div>
            <div className="grid gap-1.5"><Label>NTN</Label><Input value={form.ntn} onChange={(e) => setForm({ ...form, ntn: e.target.value })} placeholder="1234567-8" className="font-mono" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Credit Days</Label><Input type="number" min={0} value={form.creditDays} onChange={(e) => setForm({ ...form, creditDays: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>GPS (tagged)</Label>
              <Input disabled value={shop.lat != null && shop.lng != null ? `${shop.lat.toFixed(5)}, ${shop.lng.toFixed(5)}` : '—'} className="font-mono text-[11px]" />
            </div>
          </div>
          {/* Visit days — booker route ke liye */}
          <div className="grid gap-1.5">
            <Label>Visit Days — kis din order booker aayega (khali = roz)</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LIST.map((d) => (
                <button key={d.code} type="button" onClick={() => toggleDay(d.code)}
                  className={`h-7 rounded-md border px-2.5 text-[11px] font-semibold transition-colors ${form.visitDays.includes(d.code) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />} Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
