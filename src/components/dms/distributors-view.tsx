'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR } from '@/lib/dms-api'
import type { HierarchyNode } from '@/lib/dms-types'
import { Building2, Truck, ChevronRight, Wallet, Store, Pencil, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

const ROLE_META: Record<string, { icon: typeof Building2; label: string; color: string }> = {
  DISTRIBUTOR: { icon: Building2, label: 'Distributor', color: 'bg-emerald-100 text-emerald-700' },
  SALESMAN: { icon: Truck, label: 'Order Booker', color: 'bg-amber-100 text-amber-700' },
}

interface EditForm {
  name: string
  businessName: string
  phone: string
  city: string
  region: string
  creditLimit: string
}

function NodeCard({ node, depth, canEditFn, onEdit }: { node: HierarchyNode; depth: number; canEditFn: (n: HierarchyNode) => boolean; onEdit: (n: HierarchyNode) => void }) {
  const meta = ROLE_META[node.role] ?? ROLE_META.DISTRIBUTOR
  const Icon = meta.icon
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  // har node apna canEdit khud compute karta hai (parent ka inherit NAHI — warna salesman bhi edit ho jata)
  const canEdit = canEditFn(node)

  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      <Card className={`border shadow-sm ${depth === 0 ? 'border-emerald-200' : 'border-slate-200'}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            {hasChildren ? (
              <button onClick={() => setOpen(!open)} className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-emerald-100 transition-colors shrink-0">
                <ChevronRight className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
            ) : <div className="w-7" />}
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${meta.color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-slate-900 text-sm truncate">{node.businessName ?? node.name}</p>
                <Badge variant="outline" className="text-[9px] px-1.5 border-slate-300 text-slate-500">{meta.label}</Badge>
              </div>
              <p className="text-xs text-slate-400 truncate">{node.name} • {node.city ?? node.region ?? '—'} • {node.email}</p>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={() => onEdit(node)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            <div className="text-right shrink-0 hidden sm:block">
              {node.monthSales !== undefined && node.role !== 'SALESMAN' && (
                <p className="text-sm font-bold text-emerald-700">{fmtPKR(node.monthSales)}</p>
              )}
              {node.creditLimit && <p className="text-[10px] text-slate-400 flex items-center gap-1 justify-end"><Wallet className="h-3 w-3" /> {fmtPKR(node.creditLimit)}</p>}
              {node.role === 'SALESMAN' && node.outletsCount !== undefined && (
                <p className="text-[10px] text-slate-400 flex items-center gap-1 justify-end"><Store className="h-3 w-3" /> {node.outletsCount} outlets</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      {hasChildren && open && (
        <div className="mt-2 space-y-2 border-l-2 border-emerald-100 pl-2 ml-5">
          {node.children.map((c) => <NodeCard key={c.id} node={c} depth={depth + 1} canEditFn={canEditFn} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  )
}

export function EditDistributorDialog({ node, onClose, onSaved }: { node: HierarchyNode | null; onClose: () => void; onSaved: () => void }) {
  const setUser = useDMS((s) => s.setUser)
  const user = useDMS((s) => s.user)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<EditForm>({ name: '', businessName: '', phone: '', city: '', region: '', creditLimit: '' })

  // Task 22: credit limit ab Mega Admin console se manage hoti hai — business portal mein read-only

  useEffect(() => {
    if (node) {
      setForm({
        name: node.name ?? '',
        businessName: node.businessName ?? '',
        phone: node.phone ?? '',
        city: node.city ?? '',
        region: node.region ?? '',
        creditLimit: node.creditLimit !== undefined ? String(node.creditLimit) : '',
      })
    }
  }, [node])

  const set = (k: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (!node) return
    if (!form.name.trim() || !form.businessName.trim() || !form.city.trim()) {
      toast({ title: 'Missing info', description: 'Naam, business name aur city zaroori hain', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      // credit limit ab Mega Admin console set karta hai — yahan kabhi nahi jati
      const body: Record<string, unknown> = {
        userId: user?.id,
        name: form.name,
        businessName: form.businessName,
        city: form.city,
        region: form.region,
        phone: form.phone,
      }
      const r = await api<{ node: { id: string; name: string; phone: string | null; region: string | null; businessName?: string; city?: string } }>(`/api/distributors/${node.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      // apni hi details edit ki hain to header/session turant sync (name + profile dono)
      if (user && r.node.id === user.id) {
        setUser({
          ...user,
          name: r.node.name,
          phone: r.node.phone,
          region: r.node.region,
          profile: user.profile ? { ...user.profile, businessName: r.node.businessName ?? user.profile.businessName, city: r.node.city ?? user.profile.city } : user.profile,
        })
      }
      toast({ title: 'Details update ho gayi', description: `${form.businessName} ki maloomat save ho gayi hain` })
      onSaved()
      onClose()
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Save failed', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!node} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Distributor Details</DialogTitle>
          <DialogDescription>
            {node?.businessName ?? node?.name} — maloomat update karein. Email login ke liye hai, woh nahi badalti.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Business Name *</Label>
              <Input value={form.businessName} onChange={set('businessName')} placeholder="e.g. Al-Madina Distribution" />
            </div>
            <div className="space-y-1.5">
              <Label>Owner / Contact Name *</Label>
              <Input value={form.name} onChange={set('name')} placeholder="e.g. Haji Ahmed" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email (login)</Label>
              <Input value={node?.email ?? ''} disabled className="bg-slate-50 text-slate-400" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={set('phone')} placeholder="03xx-xxxxxxx" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>City *</Label>
              <Input value={form.city} onChange={set('city')} placeholder="e.g. Lahore" />
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Input value={form.region} onChange={set('region')} placeholder="e.g. Punjab — Central" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Credit Limit (Rs) — Mega Admin console se set hoti hai</Label>
            <Input
              type="number"
              min={0}
              value={form.creditLimit}
              onChange={set('creditLimit')}
              disabled
              className="bg-slate-50 text-slate-400"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DistributorsView() {
  const user = useDMS((s) => s.user)
  const [nodes, setNodes] = useState<HierarchyNode[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<HierarchyNode | null>(null)

  const load = () => {
    if (!user) return
    api<{ hierarchy: HierarchyNode[] }>(`/api/distributors?userId=${user.id}`)
      .then((r) => setNodes(r.hierarchy))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [user])

  // Task 22: har user apna hi node edit karta hai (mega admin accounts apne console se manage karta hai)
  const canEditNode = (n: HierarchyNode) =>
    !!user && n.id === user.id

  if (loading) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div>
        <h2 className="text-xl font-bold text-slate-900">My Network</h2>
        <p className="text-sm text-slate-500">Aap ka apna network — distributor → order bookers (doosre distributors ka data private hai)</p>
      </div>
      <div className="space-y-2">
        {nodes.map((n) => (
          <NodeCard key={n.id} node={n} depth={0} canEditFn={canEditNode} onEdit={setEditing} />
        ))}
      </div>
      <EditDistributorDialog
        node={editing}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </div>
  )
}
