'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate } from '@/lib/dms-api'
import type { SalesmanPerfDTO, CompanyDTO, BookerParentDTO } from '@/lib/dms-types'
import { Target, Phone, TrendingUp, Award, Building2, UserPlus, Pencil, Loader2, Trash2, X } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface BookerForm {
  name: string
  email: string
  password: string
  phone: string
  region: string
  companyId: string
  parentId: string
}

const EMPTY_FORM: BookerForm = { name: '', email: '', password: '', phone: '', region: '', companyId: '', parentId: '' }

// Task 67 — targets API response (management dialog ka data)
interface TargetRow {
  id: string
  salesmanId: string
  salesmanName: string
  brandId: string | null
  brandName: string | null
  targetValue: number
  achieved: number
  achievementPct: number
}
interface TargetsResp {
  month: string
  monthLabel: string
  summary: { totalTarget: number; totalAchieved: number; achievementPct: number; targetsCount: number; bookersWithTarget: number; bookersTotal: number }
  targets: TargetRow[]
  bookers: { id: string; name: string; region: string | null }[]
  brands: { id: string; name: string }[]
}

export function FieldForceView() {
  const user = useDMS((s) => s.user)
  const [salesmen, setSalesmen] = useState<SalesmanPerfDTO[]>([])
  const [companies, setCompanies] = useState<CompanyDTO[]>([])
  const [parents, setParents] = useState<BookerParentDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SalesmanPerfDTO | null>(null)
  // Task 67: targets management — header "Targets" ya per-booker target button se khulta hai
  const [targetsOpen, setTargetsOpen] = useState(false)
  const [targetBookerId, setTargetBookerId] = useState<string | null>(null)

  const canManage = !!user && user.role !== 'SALESMAN'

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const r = await api<{ salesmen: SalesmanPerfDTO[]; parents: BookerParentDTO[] }>(`/api/field-force?userId=${user.id}`)
      setSalesmen(r.salesmen)
      setParents(r.parents ?? [])
      const c = await api<{ companies: CompanyDTO[] }>(`/api/companies?userId=${user.id}`)
      setCompanies(c.companies)
    } catch { /* noop */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [user])

  // Order booker ko company assign/unassign — assign hote hi usay sirf isi company ke products dikhte hain
  async function assignCompany(salesmanId: string, name: string, companyId: string) {
    if (!user) return
    try {
      await api(`/api/field-force/${salesmanId}`, { method: 'PATCH', body: JSON.stringify({ userId: user.id, companyId: companyId || null }) })
      const co = companies.find((c) => c.id === companyId)
      toast({ title: 'Company Assigned ✓', description: `${name} → ${co?.name ?? 'koi company nahi (sab products)'}` })
      load().catch(() => {})
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    }
  }

  function openAdd() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(s: SalesmanPerfDTO) {
    setEditing(s)
    setDialogOpen(true)
  }

  async function saveBooker(form: BookerForm, close: () => void) {
    if (!user) return
    try {
      if (editing) {
        const body: Record<string, unknown> = {
          userId: user.id,
          name: form.name,
          phone: form.phone,
          region: form.region,
        }
        if (form.email.trim()) body.email = form.email
        if (form.password.trim()) body.password = form.password
        // Task 22: company assignment ab DISTRIBUTOR ka control hai (apne bookers par)
        if (user.role === 'DISTRIBUTOR') body.companyId = form.companyId || null
        await api(`/api/field-force/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        toast({ title: 'Order Booker Updated ✓', description: `${form.name} ki details save ho gayi` })
      } else {
        const body: Record<string, unknown> = {
          userId: user.id,
          name: form.name,
          email: form.email,
          phone: form.phone,
          region: form.region,
          password: form.password,
        }
        if (user.role === 'DISTRIBUTOR') {
          body.companyId = form.companyId || null
        }
        await api('/api/field-force', { method: 'POST', body: JSON.stringify(body) })
        toast({ title: 'Order Booker Added ✓', description: `${form.name} ab field force mein shamil — login: ${form.email}` })
      }
      close()
      load().catch(() => {})
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    }
  }

  if (loading) return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}</div>

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Field Force Performance</h2>
          <p className="text-sm text-slate-500">Order bookers — company assignment, targets, PJP compliance aur live status</p>
        </div>
        {canManage && (
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={() => { setTargetBookerId(null); setTargetsOpen(true) }} className="border-amber-300 text-amber-700 hover:bg-amber-50">
              <Target className="h-4 w-4 mr-1.5" /> Targets Set Karein
            </Button>
            <Button onClick={openAdd} className="gap-1.5">
              <UserPlus className="h-4 w-4" /> Add Order Booker
            </Button>
          </div>
        )}
      </div>

      {salesmen.length === 0 && (
        <Card><CardContent className="py-16 text-center text-sm text-slate-400">Koi salesman nahi mila</CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {salesmen.map((s, idx) => (
          <Card key={s.id} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold">
                    {s.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  </div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-1.5">
                      {s.name}
                      {idx === 0 && s.monthSales > 0 && <Award className="h-4 w-4 text-amber-500" />}
                    </CardTitle>
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {s.phone ?? s.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50 text-[10px]">
                    {s.outletsAssigned} outlets
                  </Badge>
                  {canManage && (
                    <>
                      <Button variant="outline" size="icon" className="h-7 w-7" title="Is booker ka target set karein"
                        onClick={() => { setTargetBookerId(s.id); setTargetsOpen(true) }}>
                        <Target className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-7 w-7" title="Edit order booker" onClick={() => openEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Company assignment — assign hote hi booker ko sirf isi company ke products dikhte hain */}
              {user?.role === 'DISTRIBUTOR' && (
                <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Building2 className="h-3.5 w-3.5 text-violet-600" />
                    <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wide">Assigned Company</p>
                  </div>
                  <select
                    value={s.companyId ?? ''}
                    onChange={(e) => assignCompany(s.id, s.name, e.target.value)}
                    className="flex h-8 w-full rounded-md border border-input bg-white px-2 py-1 text-xs"
                  >
                    <option value="">— Sab companies ke products —</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="text-[10px] text-violet-600/80 mt-1">
                    {s.companyId ? `${s.name} ko sirf ${s.companyName} ke products + unki assigned shops dikhengi` : 'Sab products dikhenge (koi company assign nahi)'}
                  </p>
                </div>
              )}
              {user?.role !== 'DISTRIBUTOR' && s.companyName && (
                <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700 text-[10px] w-fit">
                  <Building2 className="h-3 w-3 mr-1" /> {s.companyShortCode ?? s.companyName}
                </Badge>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <p className="text-[11px] text-slate-500">Month Sales</p>
                  <p className="font-bold text-slate-900 text-sm">{fmtPKR(s.monthSales)}</p>
                  <p className="text-[10px] text-slate-400">{s.monthOrders} orders</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <p className="text-[11px] text-slate-500">Last Active</p>
                  <p className="font-bold text-slate-900 text-sm">{s.lastActive ? fmtDate(s.lastActive) : '—'}</p>
                  <p className="text-[10px] text-slate-400">PJP: {s.pjpCompliance}%</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-500 flex items-center gap-1"><Target className="h-3 w-3" /> Target: {fmtPKR(s.monthTarget)}</span>
                  <span className={`font-semibold ${s.achievement >= 100 ? 'text-emerald-600' : s.achievement >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{s.achievement}%</span>
                </div>
                <Progress value={Math.min(s.achievement, 100)} className="h-2" />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Badge variant="outline" className={s.achievement >= 100 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}>
                  <TrendingUp className="h-3 w-3 mr-1" /> {s.achievement >= 100 ? 'Target achieved' : `${fmtPKR(Math.max(s.monthTarget - s.monthSales, 0))} remaining`}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {dialogOpen && (
        <BookerDialog
          editing={editing}
          parents={parents}
          companies={companies}
          canAssignCo={user?.role === 'DISTRIBUTOR'}
          onClose={() => setDialogOpen(false)}
          onSave={saveBooker}
        />
      )}

      {/* Task 67: targets management — add/upsert, inline edit, delete, live achievement */}
      <TargetsDialog
        open={targetsOpen}
        onClose={() => setTargetsOpen(false)}
        initialSalesmanId={targetBookerId}
        onSaved={load}
      />
    </div>
  )
}

function BookerDialog({ editing, parents, companies, canAssignCo, onClose, onSave }: {
  editing: SalesmanPerfDTO | null
  parents: BookerParentDTO[]
  companies: CompanyDTO[]
  canAssignCo: boolean
  onClose: () => void
  onSave: (form: BookerForm, close: () => void) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<BookerForm>(() => editing
    ? {
        name: editing.name,
        email: editing.email,
        password: '',
        phone: editing.phone ?? '',
        region: editing.region ?? '',
        companyId: editing.companyId ?? '',
        parentId: editing.parentId ?? '',
      }
    : { ...EMPTY_FORM, parentId: parents[0]?.id ?? '' })

  const set = (k: keyof BookerForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.name.trim() || (!editing && !form.email.trim())) {
      toast({ title: 'Missing info', description: 'Naam aur email zaroori hain', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await onSave(form, onClose)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Order Booker' : 'Naya Order Booker'}</DialogTitle>
          <DialogDescription>
            {editing
              ? `${editing.name} ki details update karein — password khali chhora to nahi badlega.`
              : 'Naya order booker add karein — ye apne login se app use karega (password default: demo123).'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Order Booker Name *</Label>
              <Input value={form.name} onChange={set('name')} placeholder="e.g. Rashid Minhas" />
            </div>
            <div className="space-y-1.5">
              <Label>Email (login) *</Label>
              <Input type="email" value={form.email} onChange={set('email')} placeholder="booker@dms.pk" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Password {editing ? '(reset — khali = no change)' : '(khali = demo123)'}</Label>
              <Input type="text" value={form.password} onChange={set('password')} placeholder="demo123" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={set('phone')} placeholder="03xx-xxxxxxx" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Input value={form.region} onChange={set('region')} placeholder="e.g. Lahore" />
            </div>
            {canAssignCo && (
              <div className="space-y-1.5">
                <Label>Company (products isi ke dikhenge)</Label>
                <select
                  value={form.companyId}
                  onChange={set('companyId')}
                  className="flex h-9 w-full rounded-md border border-input bg-white px-2 py-1 text-sm"
                >
                  <option value="">— Sab companies ke products —</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
          {canAssignCo && !editing && (
            <p className="text-xs text-slate-500">Naya booker aapke apne network ke under banega — company assign karna optional hai.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? 'Save Changes' : 'Add Booker'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Task 67 — TARGETS MANAGEMENT DIALOG
// Order booker ka monthly target set karo (overall ya brand-wise).
// Same booker + month + brand par dobara save = update (upsert).
// Har row par LIVE achievement (us month ki booked sales) nazar aati hai —
// wahi math jo Field Force cards aur Reports > Targets use karte hain.
// ============================================================
function TargetsDialog({ open, onClose, initialSalesmanId, onSaved }: {
  open: boolean
  onClose: () => void
  initialSalesmanId: string | null
  onSaved: () => void
}) {
  const user = useDMS((s) => s.user)
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [data, setData] = useState<TargetsResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [salesmanId, setSalesmanId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [value, setValue] = useState('')

  async function load(m: string) {
    if (!user) return
    setLoading(true)
    try {
      const r = await api<TargetsResp>(`/api/targets?userId=${user.id}&month=${m}`)
      setData(r)
    } catch { /* noop */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    if (initialSalesmanId) { setSalesmanId(initialSalesmanId); setBrandId(''); setValue('') }
  }, [open, initialSalesmanId])

  useEffect(() => {
    if (open) { load(month).catch(() => {}) }
  }, [open, month, user])

  const pctTone = (p: number) => p >= 100 ? 'text-emerald-600' : p >= 60 ? 'text-amber-600' : 'text-red-500'

  async function save() {
    if (!user) return
    if (!salesmanId) {
      toast({ title: 'Order booker select karein', description: 'Kis booker ka target hai — pehle chunein', variant: 'destructive' })
      return
    }
    const v = parseFloat(value)
    if (!Number.isFinite(v) || v <= 0) {
      toast({ title: 'Target value likhein', description: 'Target Rs mein — e.g. 500000', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await api<{ updated: boolean }>('/api/targets', {
        method: 'POST',
        body: JSON.stringify({ userId: user.id, salesmanId, month, targetValue: v, brandId: brandId || null }),
      })
      const b = data?.bookers.find((x) => x.id === salesmanId)
      const brand = data?.brands.find((x) => x.id === brandId)
      toast({
        title: r.updated ? 'Target Update Ho Gaya ✓' : 'Target Set Ho Gaya ✓',
        description: `${b?.name ?? ''} — ${month} — Rs ${v.toLocaleString('en-PK')}${brand ? ` (${brand.name})` : ''}`,
      })
      setValue('')
      await load(month)
      onSaved()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  function prefillEdit(t: TargetRow) {
    setSalesmanId(t.salesmanId)
    setBrandId(t.brandId ?? '')
    setValue(String(t.targetValue))
  }

  async function remove(t: TargetRow) {
    if (!user) return
    const label = `${t.salesmanName} — ${t.brandName ?? 'Overall'} — Rs ${t.targetValue.toLocaleString('en-PK')}`
    if (!window.confirm(`Target delete karein?\n\n${label} (${data?.monthLabel ?? month})`)) return
    try {
      await api(`/api/targets/${t.id}?userId=${user.id}`, { method: 'DELETE' })
      toast({ title: 'Target Deleted', description: label })
      await load(month)
      onSaved()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    }
  }

  const editingExisting = data?.targets.some((t) => t.salesmanId === salesmanId && (t.brandId ?? '') === brandId) ?? false

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-amber-600" /> Order Booker Targets</DialogTitle>
          <DialogDescription>
            Month chunein, booker ka target set karein — overall (sab brands) ya kisi ek brand ka. Booker apna progress apne app mein dekhta hai.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
          {/* Month picker + summary */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              type="month" value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
            {data && (
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-600">Total Target: <b className="text-slate-800">{fmtPKR(data.summary.totalTarget)}</b></span>
                <span className="rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1 text-emerald-700">Booked: <b>{fmtPKR(data.summary.totalAchieved)}</b></span>
                <span className={`rounded-lg bg-slate-100 px-2 py-1 font-semibold ${pctTone(data.summary.achievementPct)}`}>{data.summary.achievementPct}%</span>
                <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-600">Targets: <b className="text-slate-800">{data.summary.targetsCount}</b></span>
              </div>
            )}
          </div>

          {/* Add / update form */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">
              {editingExisting ? 'Target Update (same booker + month + brand par save = update)' : 'Naya Target'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Order Booker *</Label>
                <select value={salesmanId} onChange={(e) => setSalesmanId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-white px-2 py-1 text-sm">
                  <option value="">— Booker chunein —</option>
                  {(data?.bookers ?? []).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{b.region ? ` — ${b.region}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Brand (optional)</Label>
                <select value={brandId} onChange={(e) => setBrandId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-white px-2 py-1 text-sm">
                  <option value="">Overall — poori sales ka target</option>
                  {(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Input type="number" min={0} step="1" inputMode="numeric" value={value}
                onChange={(e) => setValue(e.target.value)} placeholder="Target value (Rs) — e.g. 500000" className="h-9 flex-1" />
              <Button onClick={save} disabled={saving} className="h-9 bg-amber-600 hover:bg-amber-700 gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                {editingExisting ? 'Update Target' : 'Set Target'}
              </Button>
            </div>
          </div>

          {/* Targets list — live achievement ke sath */}
          <div className="rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/70">
                  <TableHead>Order Booker</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Booked</TableHead>
                  <TableHead className="text-right">Achieved</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6} className="text-center text-xs text-slate-400 py-6">Load ho raha hai...</TableCell></TableRow>
                )}
                {!loading && (data?.targets.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-slate-400 py-8">
                      Is month ka koi target set nahi — upar se booker chun kar target lagayein
                    </TableCell>
                  </TableRow>
                )}
                {!loading && data?.targets.map((t) => (
                  <TableRow key={t.id} className="hover:bg-amber-50/30">
                    <TableCell className="font-medium text-slate-800 text-sm">{t.salesmanName}</TableCell>
                    <TableCell>
                      {t.brandName ? (
                        <span className="text-[11px] rounded bg-violet-50 border border-violet-100 text-violet-700 px-1.5 py-0.5">{t.brandName}</span>
                      ) : (
                        <span className="text-[11px] text-slate-400">Overall</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmtPKR(t.targetValue)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">{fmtPKR(t.achieved)}</TableCell>
                    <TableCell className={`text-right font-bold tabular-nums ${pctTone(t.achievementPct)}`}>{t.achievementPct}%</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-amber-600" title="Edit — form mein load ho jayega" onClick={() => prefillEdit(t)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-red-500" title="Delete target" onClick={() => remove(t)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={onClose} className="gap-1.5"><X className="h-4 w-4" /> Band Karein</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
