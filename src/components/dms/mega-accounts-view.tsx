'use client'

/**
 * MEGA ADMIN CONSOLE — Distributor Accounts (Task 22)
 *
 * Software seller ka portal: yahan sirf ACCOUNTS ka kaam hota hai —
 * 1) Naya distributor account banao (login credentials + monthly subscription)
 * 2) Account Active/Inactive toggle (inactive = distributor + uski team login se block)
 * 3) Monthly subscription renew (expiry extend)
 * 4) Login password reset
 *
 * PRIVACY: distributors ka business data (orders, shops, recovery, reports) is portal
 * par bilkul nahi aata — API level par bhi mega admin business routes se blocked hai.
 */

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDMS } from '@/lib/dms-store'
import { api, fmtDate } from '@/lib/dms-api'
import type { MegaDistributorDTO, MegaDistributorsData } from '@/lib/dms-types'
import {
  Landmark, UserPlus, Loader2, ShieldCheck, ShieldOff, RefreshCw, KeyRound,
  CalendarDays, Users, Building2, Mail, Phone, MapPin, Lock, AlertTriangle,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'ACTIVE', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  INACTIVE: { label: 'INACTIVE', cls: 'border-slate-300 bg-slate-100 text-slate-500' },
  EXPIRED: { label: 'EXPIRED', cls: 'border-red-200 bg-red-50 text-red-600' },
}

interface NewDistForm {
  name: string
  businessName: string
  email: string
  password: string
  phone: string
  city: string
  region: string
  months: string
  creditLimit: string
}
const EMPTY_NEW: NewDistForm = { name: '', businessName: '', email: '', password: '', phone: '', city: '', region: '', months: '1', creditLimit: '500000' }

export function MegaAccountsView() {
  const user = useDMS((s) => s.user)
  const [rows, setRows] = useState<MegaDistributorDTO[]>([])
  const [totals, setTotals] = useState<MegaDistributorsData['totals'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pwTarget, setPwTarget] = useState<MegaDistributorDTO | null>(null)
  const [newPw, setNewPw] = useState('')
  const [form, setForm] = useState<NewDistForm>(EMPTY_NEW)

  const load = () => {
    if (!user) return
    api<MegaDistributorsData>(`/api/mega/distributors?userId=${user.id}`)
      .then((r) => { setRows(r.distributors); setTotals(r.totals) })
      .catch((e) => toast({ title: 'Load failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' }))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [user])

  const action = async (d: MegaDistributorDTO, act: 'activate' | 'deactivate' | 'renew', months?: number) => {
    if (!user) return
    setBusyId(d.id + act)
    try {
      const r = await api<{ message: string }>(`/api/mega/distributors/${d.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ userId: user.id, action: act, months }),
      })
      toast({ title: act === 'renew' ? 'Subscription Renewed ✓' : act === 'activate' ? 'Account Activated ✓' : 'Account Deactivated', description: r.message })
      load()
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const resetPassword = async () => {
    if (!user || !pwTarget) return
    if (!newPw.trim() || newPw.trim().length < 4) {
      toast({ title: 'Password chhota hai', description: 'Kam az kam 4 harf', variant: 'destructive' })
      return
    }
    setBusyId(pwTarget.id + 'pw')
    try {
      const r = await api<{ message: string }>(`/api/mega/distributors/${pwTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ userId: user.id, action: 'resetPassword', password: newPw.trim() }),
      })
      toast({ title: 'Password Reset ✓', description: r.message })
      setPwTarget(null)
      setNewPw('')
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const createDist = async (close: () => void) => {
    if (!user) return
    if (!form.name.trim() || !form.businessName.trim() || !form.city.trim() || !form.email.trim()) {
      toast({ title: 'Missing info', description: 'Owner naam, business name, city aur email zaroori hain', variant: 'destructive' })
      return
    }
    setBusyId('new')
    try {
      const r = await api<{ distributor: { businessName: string | null } }>('/api/mega/distributors', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          name: form.name,
          businessName: form.businessName,
          email: form.email,
          password: form.password || undefined,
          phone: form.phone,
          city: form.city,
          region: form.region,
          months: Number(form.months) || 1,
          creditLimit: form.creditLimit ? Number(form.creditLimit) : undefined,
        }),
      })
      toast({ title: 'Distributor Account Created ✓', description: `${r.distributor.businessName} — login: ${form.email} (subscription ${form.months} month)` })
      setForm(EMPTY_NEW)
      close()
      load()
    } catch (e) {
      toast({ title: 'Create failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="h-full overflow-y-auto pr-1 space-y-3">
        <Skeleton className="h-24 rounded-xl" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Landmark className="h-5 w-5 text-emerald-600" /> Mega Admin — Distributor Accounts
          </h2>
          <p className="text-sm text-slate-500">
            Software seller console: distributor accounts banao, monthly subscription control karo —
            <span className="text-emerald-700 font-medium"> business data kisi ka yahan nazar nahi aata</span>
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0">
          <UserPlus className="h-4 w-4" /> Naya Distributor
        </Button>
      </div>

      {/* Stats */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Distributors', value: totals.total, cls: 'text-slate-900', icon: Building2 },
            { label: 'Active', value: totals.active, cls: 'text-emerald-600', icon: ShieldCheck },
            { label: 'Inactive', value: totals.inactive, cls: 'text-slate-400', icon: ShieldOff },
            { label: 'Expiring ≤ 7 din', value: totals.expiringSoon, cls: totals.expiringSoon > 0 ? 'text-amber-600' : 'text-slate-900', icon: AlertTriangle },
          ].map((s) => (
            <Card key={s.label} className="border-slate-200">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <s.icon className={`h-4.5 w-4.5 ${s.cls}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold leading-none">{s.value}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Distributor account cards */}
      {rows.length === 0 && (
        <Card><CardContent className="py-16 text-center text-sm text-slate-400">
          Koi distributor account nahi — "Naya Distributor" se pehla account banayein
        </CardContent></Card>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        {rows.map((d) => {
          const meta = STATUS_META[d.status]
          const daysCls = d.status === 'ACTIVE' && d.daysLeft != null && d.daysLeft <= 7 ? 'text-amber-600 font-bold' : 'text-slate-500'
          return (
            <Card key={d.id} className="border-slate-200 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                    <Building2 className="h-5 w-5 text-emerald-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-slate-900 text-sm truncate">{d.businessName ?? d.name}</p>
                      <Badge variant="outline" className={`text-[10px] px-1.5 ${meta.cls}`}>{meta.label}</Badge>
                    </div>
                    <p className="text-xs text-slate-400 truncate">{d.name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-slate-400 flex items-center gap-1 justify-end"><Users className="h-3 w-3" /> {d.teamUsers} users</p>
                    <p className="text-[10px] text-slate-400">joined {fmtDate(d.createdAt)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <p className="flex items-center gap-1.5 text-slate-600 truncate"><Mail className="h-3 w-3 text-slate-400" /> {d.email}</p>
                  <p className="flex items-center gap-1.5 text-slate-600 truncate"><Phone className="h-3 w-3 text-slate-400" /> {d.phone ?? '—'}</p>
                  <p className="flex items-center gap-1.5 text-slate-600 truncate"><MapPin className="h-3 w-3 text-slate-400" /> {d.city ?? '—'}{d.region ? ` • ${d.region}` : ''}</p>
                  <p className="flex items-center gap-1.5 text-slate-600"><CalendarDays className="h-3 w-3 text-slate-400" />
                    {d.subscriptionExpiry ? (
                      <>Expiry: <span className={daysCls}>{fmtDate(d.subscriptionExpiry)}{d.daysLeft != null && d.status === 'ACTIVE' ? ` (${d.daysLeft} din)` : ''}</span></>
                    ) : 'Expiry: —'}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100">
                  {d.isActive ? (
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 border-slate-300 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                      disabled={busyId === d.id + 'deactivate'} onClick={() => action(d, 'deactivate')}>
                      {busyId === d.id + 'deactivate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
                      Deactivate
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      disabled={busyId === d.id + 'activate'} onClick={() => action(d, 'activate')}>
                      {busyId === d.id + 'activate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      Activate
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    disabled={busyId === d.id + 'renew'} onClick={() => action(d, 'renew', 1)}>
                    {busyId === d.id + 'renew' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Renew +1 Month
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => action(d, 'renew', 3)} disabled={busyId === d.id + 'renew'}>
                    +3 Months
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 border-slate-300 text-slate-600" onClick={() => { setPwTarget(d); setNewPw('') }}>
                    <KeyRound className="h-3.5 w-3.5" /> Password
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* New distributor dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Landmark className="h-4 w-4 text-emerald-600" /> Naya Distributor Account</DialogTitle>
            <DialogDescription>
              Account banate hi login credentials active ho jayenge — monthly subscription expiry aaj + months se set hogi.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Business Name *</Label>
                <Input value={form.businessName} onChange={setF('businessName')} placeholder="e.g. Al-Karam Distribution" />
              </div>
              <div className="space-y-1.5">
                <Label>Owner / Contact Name *</Label>
                <Input value={form.name} onChange={setF('name')} placeholder="e.g. Haji Karam" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Email (login) *</Label>
                <Input type="email" value={form.email} onChange={setF('email')} placeholder="alkaram@dms.pk" />
              </div>
              <div className="space-y-1.5">
                <Label>Password (khali = demo123)</Label>
                <Input type="text" value={form.password} onChange={setF('password')} placeholder="demo123" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={setF('phone')} placeholder="03xx-xxxxxxx" />
              </div>
              <div className="space-y-1.5">
                <Label>City *</Label>
                <Input value={form.city} onChange={setF('city')} placeholder="e.g. Faisalabad" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Region</Label>
                <Input value={form.region} onChange={setF('region')} placeholder="e.g. Central Punjab" />
              </div>
              <div className="space-y-1.5">
                <Label>Subscription (months)</Label>
                <select value={form.months} onChange={setF('months')} className="flex h-9 w-full rounded-md border border-input bg-white px-2 py-1 text-sm">
                  <option value="1">1 Month</option>
                  <option value="3">3 Months</option>
                  <option value="6">6 Months</option>
                  <option value="12">12 Months</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Credit Limit (Rs)</Label>
              <Input type="number" min={0} value={form.creditLimit} onChange={setF('creditLimit')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busyId === 'new'}>Cancel</Button>
            <Button onClick={() => createDist(() => setCreateOpen(false))} disabled={busyId === 'new'} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              {busyId === 'new' && <Loader2 className="h-4 w-4 animate-spin" />} Create Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!pwTarget} onOpenChange={(o) => { if (!o) setPwTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4 text-emerald-600" /> Password Reset</DialogTitle>
            <DialogDescription>{pwTarget?.businessName ?? pwTarget?.name} — naya login password set karein</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label>Naya Password *</Label>
            <Input type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="kam az kam 4 harf" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwTarget(null)} disabled={busyId === (pwTarget?.id ?? '') + 'pw'}>Cancel</Button>
            <Button onClick={resetPassword} disabled={busyId === (pwTarget?.id ?? '') + 'pw'} className="gap-1.5">
              {busyId === (pwTarget?.id ?? '') + 'pw' && <Loader2 className="h-4 w-4 animate-spin" />} Set Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )

  function setF(k: keyof NewDistForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  }
}
