'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate, STATUS_STYLES, statusLabel } from '@/lib/dms-api'
import { UnitQtyInputs, fmtQty } from '@/components/dms/unit-qty'
import type { ReturnDTO, ClaimDTO, OutletDTO, ProductDTO } from '@/lib/dms-types'
import { Check, X, Undo2, FileText, Plus, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export function ReturnsClaimsView() {
  const user = useDMS((s) => s.user)
  const [returns, setReturns] = useState<ReturnDTO[]>([])
  const [claims, setClaims] = useState<ClaimDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<ReturnDTO | null>(null)
  const [newReturnOpen, setNewReturnOpen] = useState(false)

  const canApprove = user?.role === 'DISTRIBUTOR'

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const [r, c] = await Promise.all([
        api<{ returns: ReturnDTO[] }>(`/api/returns?userId=${user.id}`),
        api<{ claims: ClaimDTO[] }>(`/api/claims?userId=${user.id}`),
      ])
      setReturns(r.returns)
      setClaims(c.claims)
    } finally { setLoading(false) }
  }
  useEffect(() => { load()   }, [user])

  async function returnAction(id: string, action: 'APPROVE' | 'REJECT') {
    try {
      await api(`/api/returns/${id}`, { method: 'PATCH', body: JSON.stringify({ action, approvedBy: user?.name }) })
      toast({ title: action === 'APPROVE' ? 'Return Approved ✓' : 'Return Rejected', description: 'Status update ho gaya' })
      load()
    } catch (e) { toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' }) }
  }

  async function claimAction(id: string, action: 'APPROVE' | 'REJECT') {
    try {
      await api(`/api/claims/${id}`, { method: 'PATCH', body: JSON.stringify({ action, approvedBy: user?.name }) })
      toast({ title: action === 'APPROVE' ? 'Claim Approved ✓' : 'Claim Rejected', description: 'Ledger adjustment ho jayega' })
      load()
    } catch (e) { toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' }) }
  }

  if (loading) return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>

  const pendingReturns = returns.filter((r) => r.status === 'PENDING').length
  const pendingClaims = claims.filter((c) => c.status === 'PENDING').length

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Returns & Claims</h2>
          <p className="text-sm text-slate-500">Damaged/expired stock returns aur scheme claims — hierarchical approval</p>
        </div>
        <Button onClick={() => setNewReturnOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-1.5" /> New Sale Return
        </Button>
      </div>

      <Tabs defaultValue="returns">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="returns" className="data-[state=active]:bg-white data-[state=active]:text-emerald-700">
            Sale Returns {pendingReturns > 0 && <Badge className="ml-1.5 bg-amber-100 text-amber-700 border-0 h-4 text-[9px] px-1">{pendingReturns}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="claims" className="data-[state=active]:bg-white data-[state=active]:text-emerald-700">
            Claims {pendingClaims > 0 && <Badge className="ml-1.5 bg-amber-100 text-amber-700 border-0 h-4 text-[9px] px-1">{pendingClaims}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="returns" className="mt-3 space-y-2.5">
          {returns.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-slate-400">Koi return nahi</CardContent></Card>}
          {returns.map((r) => (
            <Card key={r.id} className="border-slate-200 shadow-sm">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <Undo2 className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setDetail(r)} className="font-semibold text-emerald-700 hover:underline text-sm">{r.returnNo}</button>
                    <Badge variant="outline" className="text-[9px] border-slate-200">{r.type}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{r.outletName} • {r.items.length} items • {fmtDate(r.createdAt)}</p>
                  {r.reason && <p className="text-xs text-slate-400 truncate italic">&ldquo;{r.reason}&rdquo;</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-900">{fmtPKR(r.totalValue)}</p>
                  <Badge variant="outline" className={`${STATUS_STYLES[r.status]} text-[9px]`}>{statusLabel(r.status)}</Badge>
                </div>
                {r.status === 'PENDING' && canApprove && (
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => returnAction(r.id, 'APPROVE')} className="h-8 bg-emerald-600 hover:bg-emerald-700"><Check className="h-3.5 w-3.5 mr-1" /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => returnAction(r.id, 'REJECT')} className="h-8 text-red-500 border-red-200 hover:bg-red-50"><X className="h-3.5 w-3.5 mr-1" /> Reject</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="claims" className="mt-3 space-y-2.5">
          {claims.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-slate-400">Koi claim nahi</CardContent></Card>}
          {claims.map((c) => (
            <Card key={c.id} className="border-slate-200 shadow-sm">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-violet-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-800 text-sm">{c.claimNo}</p>
                    <Badge variant="outline" className="text-[9px] border-slate-200">{c.type.replaceAll('_', ' ')}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">{c.distributorName} • {fmtDate(c.createdAt)}</p>
                  {c.reason && <p className="text-xs text-slate-400 truncate italic">&ldquo;{c.reason}&rdquo;</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-900">{fmtPKR(c.amount)}</p>
                  <Badge variant="outline" className={`${STATUS_STYLES[c.status]} text-[9px]`}>{statusLabel(c.status)}</Badge>
                  {c.approvedBy && <p className="text-[10px] text-slate-400 mt-0.5">by {c.approvedBy}</p>}
                </div>
                {c.status === 'PENDING' && canApprove && (
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => claimAction(c.id, 'APPROVE')} className="h-8 bg-emerald-600 hover:bg-emerald-700"><Check className="h-3.5 w-3.5 mr-1" /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => claimAction(c.id, 'REJECT')} className="h-8 text-red-500 border-red-200 hover:bg-red-50"><X className="h-3.5 w-3.5 mr-1" /> Reject</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-md">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.returnNo} — Items</DialogTitle>
                <DialogDescription>{detail.outletName} • {detail.type}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {detail.items.map((it, i) => (
                  <div key={i} className="flex justify-between rounded-lg border px-3 py-2 text-sm">
                    <span className="text-slate-700">{it.productName}</span>
                    <span className="text-slate-500">{fmtQty(it.qty, it.unitsPerCarton ?? 1, it.pcsPerBox ?? 0)} × {fmtPKR(it.rate)}/pc = <b>{fmtPKR(it.value)}</b></span>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-1"><span>Total</span><span>{fmtPKR(detail.totalValue)}</span></div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <NewReturnDialog open={newReturnOpen} onOpenChange={setNewReturnOpen} onCreated={load} />
    </div>
  )
}

function NewReturnDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const user = useDMS((s) => s.user)
  const [outlets, setOutlets] = useState<OutletDTO[]>([])
  const [products, setProducts] = useState<ProductDTO[]>([])
  const [outletId, setOutletId] = useState('')
  const [type, setType] = useState('DAMAGED')
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<{ productId: string; qtyPcs: number }[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setOutletId(''); setLines([]); setReason('')
    api<{ outlets: OutletDTO[] }>(`/api/outlets?userId=${user.id}`).then((r) => setOutlets(r.outlets)).catch(() => {})
    api<{ products: ProductDTO[] }>(`/api/products?userId=${user.id}`).then((r) => setProducts(r.products)).catch(() => {})
  }, [open, user])

  async function save() {
    if (!outletId || lines.length === 0) {
      toast({ title: 'Missing info', description: 'Outlet aur items select karein', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      const r = await api<{ return: { returnNo: string } }>('/api/returns', {
        method: 'POST',
        body: JSON.stringify({ outletId, type, reason, items: lines.map((l) => ({ productId: l.productId, qty: l.qtyPcs })) }),
      })
      toast({ title: `Return ${r.return.returnNo} Created ✓`, description: 'Approval ke liye pending hai' })
      onOpenChange(false)
      onCreated()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Sale Return</DialogTitle><DialogDescription>Damaged / expired / unsold stock wapas</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Outlet</Label>
            <Select value={outletId} onValueChange={setOutletId}>
              <SelectTrigger><SelectValue placeholder="Select outlet" /></SelectTrigger>
              <SelectContent>{outlets.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DAMAGED">Damaged</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
                <SelectItem value="UNSOLD">Unsold</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between"><Label>Items (qty = pcs)</Label>
              <Button size="sm" variant="outline" className="h-7 border-emerald-200 text-emerald-700" onClick={() => setLines([...lines, { productId: products[0]?.id ?? '', qtyPcs: Math.max(1, products[0]?.unitsPerCarton ?? 1) }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            {lines.map((l, i) => {
              const lp = products.find((x) => x.id === l.productId)
              return (
                <div key={i} className="flex gap-2 items-start">
                  <Select value={l.productId} onValueChange={(v) => { const n = [...lines]; n[i] = { ...n[i], productId: v }; setLines(n) }}>
                    <SelectTrigger className="flex-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <UnitQtyInputs
                    pcs={l.qtyPcs}
                    upc={Math.max(1, lp?.unitsPerCarton ?? 1)}
                    pcsPerBox={lp?.pcsPerBox && lp.pcsPerBox > 0 ? lp.pcsPerBox : 0}
                    inputW="w-12"
                    onChange={(totalPcs) => { const n = [...lines]; n[i] = { ...n[i], qtyPcs: totalPcs }; setLines(n) }}
                  />
                  <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-red-400" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
                </div>
              )
            })}
          </div>
          <div className="grid gap-1.5"><Label>Reason</Label>
            <Select onValueChange={setReason} value={reason}>
              <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cartons crushed during transport">Transit damage</SelectItem>
                <SelectItem value="Stock expired on shelf">Expired on shelf</SelectItem>
                <SelectItem value="Near expiry - unsold">Near expiry unsold</SelectItem>
                <SelectItem value="Wrong product delivered">Wrong delivery</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Submit Return
        </Button>
      </DialogContent>
    </Dialog>
  )
}
