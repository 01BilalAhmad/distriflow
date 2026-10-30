'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtDate, fmtNum } from '@/lib/dms-api'
import { fmtQty, packHint } from '@/components/dms/unit-qty'
import { ProductCombobox } from '@/components/dms/product-combobox'
import type { InventoryData, StockRowDTO, WarehouseDTO } from '@/lib/dms-types'
import { Plus, Minus, AlertTriangle, Warehouse as WhIcon, PackageSearch, Loader2, ChevronDown, ChevronRight, Printer, Building2, Pencil, Trash2, X } from 'lucide-react'
import { StockReportDoc } from './stock-print'
import { toast } from '@/hooks/use-toast'

export function InventoryView() {
  const user = useDMS((s) => s.user)
  const [data, setData] = useState<InventoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [companyFilter, setCompanyFilter] = useState('ALL')
  const [manageOpen, setManageOpen] = useState(false)

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const res = await api<InventoryData>(`/api/inventory?userId=${user.id}`)
      setData(res)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load()   }, [user])

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  const near30 = (row: StockRowDTO) => row.nearExpiryQty > 0

  // company-wise print (Task 21-j) — UI rows untouched, sirf print filter hota hai
  const companies = Array.from(new Set(data.warehouses.flatMap((w) => w.rows.map((r) => r.company).filter((c): c is string => !!c)))).sort((a, b) => a.localeCompare(b))
  const printWarehouses = companyFilter === 'ALL'
    ? data.warehouses
    : data.warehouses.map((w) => ({ ...w, rows: w.rows.filter((r) => r.company === companyFilter) })).filter((w) => w.rows.length > 0)

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Inventory Control</h2>
          <p className="text-sm text-slate-500">Multi-warehouse stock — batch-wise with FIFO/FEFO picking</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-[200px] bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Companies</SelectItem>
              {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setPrintOpen(true)} disabled={printWarehouses.length === 0} className="border-slate-300 text-slate-700 hover:bg-slate-50">
            <Printer className="h-4 w-4 mr-1.5" /> Print Report
          </Button>
          <Button variant="outline" onClick={() => setManageOpen(true)} className="border-slate-300 text-slate-700 hover:bg-slate-50">
            <Building2 className="h-4 w-4 mr-1.5" /> Warehouses
          </Button>
          <Button onClick={() => setAdjustOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="h-4 w-4 mr-1.5" /> Stock Adjustment
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Total Stock</p>
              <p className="text-2xl font-bold text-slate-900">{fmtNum(data.summary.totalQty)} <span className="text-sm font-medium text-slate-400">pcs</span></p>
            </div>
            <WhIcon className="h-9 w-9 text-emerald-600 bg-emerald-100 rounded-xl p-2" />
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Stock Value</p>
              <p className="text-2xl font-bold text-slate-900">{fmtPKR(data.summary.totalValue)}</p>
            </div>
            <PackageSearch className="h-9 w-9 text-teal-600 bg-teal-100 rounded-xl p-2" />
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Near Expiry (30 days)</p>
              <p className="text-2xl font-bold text-amber-600">{fmtPKR(data.summary.nearExpiryValue)}</p>
            </div>
            <AlertTriangle className="h-9 w-9 text-amber-600 bg-amber-100 rounded-xl p-2" />
          </CardContent>
        </Card>
      </div>

      {/* Warehouses */}
      <Tabs defaultValue={data.warehouses[0]?.id}>
        <TabsList className="bg-slate-100">
          {data.warehouses.map((w) => (
            <TabsTrigger key={w.id} value={w.id} className="data-[state=active]:bg-white data-[state=active]:text-emerald-700">
              {w.name} {w.isPrimary && <Badge className="ml-1.5 bg-emerald-100 text-emerald-700 border-0 text-[9px] px-1">PRIMARY</Badge>}
            </TabsTrigger>
          ))}
        </TabsList>
        {data.warehouses.map((w) => (
          <TabsContent key={w.id} value={w.id} className="mt-3">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2 flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">{w.name} <span className="text-slate-400 font-normal text-sm">— {w.city}</span></CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">{w.distributorName} • {fmtNum(w.totalQty)} pcs • {fmtPKR(w.totalValue)}</p>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {w.rows.map((r) => (
                    <div key={r.productId}>
                      <button className="w-full text-left px-4 py-3 hover:bg-emerald-50/30 transition-colors flex items-center gap-3" onClick={() => setExpanded(expanded === `${w.id}-${r.productId}` ? null : `${w.id}-${r.productId}`)}>
                        {expanded === `${w.id}-${r.productId}` ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{r.productName}</p>
                          <p className="text-xs text-slate-400">{r.sku} • {r.brand}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-bold ${r.totalQty < 30 * Math.max(1, r.unitsPerCarton) ? 'text-red-500' : 'text-slate-800'}`}>{fmtQty(r.totalQty, r.unitsPerCarton, r.pcsPerBox)}</p>
                          <p className="text-xs text-slate-400">{fmtPKR(r.value)}</p>
                        </div>
                        <div className="hidden sm:block w-28 text-right">
                          {near30(r) ? (
                            <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50 text-[10px]">
                              <AlertTriangle className="h-3 w-3 mr-1" /> {r.nearExpiryQty} near exp
                            </Badge>
                          ) : r.nearestExpiry ? (
                            <span className="text-xs text-slate-400">Exp: {fmtDate(r.nearestExpiry)}</span>
                          ) : null}
                        </div>
                      </button>
                      {expanded === `${w.id}-${r.productId}` && (
                        <div className="bg-slate-50/70 px-4 py-3 sm:pl-12">
                          <p className="text-xs font-semibold text-slate-500 mb-2">BATCHES (FEFO order — pehle expiry wala pehle out)</p>
                          <div className="space-y-1.5">
                            {[...r.batches].sort((a, b) => (a.expDate && b.expDate ? new Date(a.expDate).getTime() - new Date(b.expDate).getTime() : 0)).map((b) => {
                              const isNear = b.expDate && new Date(b.expDate).getTime() - Date.now() < 30 * 86400000
                              return (
                                <div key={b.id} className="flex items-center justify-between rounded-md bg-white border px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="font-mono text-[10px]">{b.batchNo}</Badge>
                                    <span className="text-xs text-slate-500">Mfg: {fmtDate(b.mfgDate)} • Exp: {fmtDate(b.expDate)}</span>
                                  </div>
                                  <Badge variant="outline" className={isNear ? 'border-amber-200 text-amber-700 bg-amber-50' : 'border-emerald-200 text-emerald-700 bg-emerald-50'}>
                                    {fmtQty(b.qty, r.unitsPerCarton, r.pcsPerBox)}
                                  </Badge>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Recent adjustments */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent Stock Adjustments</CardTitle></CardHeader>
        <CardContent>
          {data.adjustments.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">Koi adjustment nahi</p>}
          <div className="space-y-2">
            {data.adjustments.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Badge className={a.type === 'IN' ? 'bg-emerald-100 text-emerald-700 border-0' : 'bg-red-100 text-red-600 border-0'}>
                  {a.type === 'IN' ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />} {a.type}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 truncate">{a.productName} <span className="text-slate-400">• {a.warehouseName}</span></p>
                  <p className="text-xs text-slate-400 truncate">{a.reason} — {a.userName ?? 'System'} • {fmtDate(a.createdAt)}</p>
                </div>
                <span className={`font-bold text-sm ${a.type === 'IN' ? 'text-emerald-600' : 'text-red-500'}`}>{a.type === 'IN' ? '+' : '-'}{a.qty}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {printOpen && <StockReportDoc warehouses={printWarehouses} companyLabel={companyFilter === 'ALL' ? undefined : companyFilter} onClose={() => setPrintOpen(false)} />}

      <ManageWarehousesDialog open={manageOpen} onOpenChange={setManageOpen} data={data} onSaved={load} />

      <AdjustDialog open={adjustOpen} onOpenChange={setAdjustOpen} onSaved={load} />
    </div>
  )
}

function AdjustDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const user = useDMS((s) => s.user)
  const [data, setData] = useState<InventoryData | null>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [productId, setProductId] = useState('')
  const [type, setType] = useState('OUT')
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState<'CTN' | 'BOX' | 'PCS'>('CTN')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    api<InventoryData>(`/api/inventory?userId=${user.id}`).then((r) => {
      setData(r)
      if (r.warehouses[0]) setWarehouseId(r.warehouses[0].id)
    }).catch(() => {})
  }, [open, user])

  const wh = data?.warehouses.find((w) => w.id === warehouseId)
  const productOptions = wh?.rows ?? []
  const selected = productOptions.find((r) => r.productId === productId)

  // unit + qty -> total pcs (server PIECES base expect karta hai)
  const qtyPcs = (() => {
    const n = Math.max(0, Math.floor(Number(qty) || 0))
    if (!selected) return 0
    const upc = Math.max(1, selected.unitsPerCarton)
    const ppb = selected.pcsPerBox > 0 ? selected.pcsPerBox : 0
    if (unit === 'CTN') return n * upc
    if (unit === 'BOX') return ppb > 0 ? n * ppb : 0
    return n
  })()

  async function save() {
    if (!warehouseId || !productId || !reason || qtyPcs <= 0) {
      toast({ title: 'Missing info', description: 'Sab fields fill karein — qty 0 se zyada honi chahiye', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await api('/api/inventory/adjust', {
        method: 'POST',
        body: JSON.stringify({ warehouseId, productId, type, qty: qtyPcs, reason, userId: user?.id }),
      })
      toast({ title: 'Adjustment Saved ✓', description: `${type === 'IN' ? '+' : '-'}${fmtQty(qtyPcs, selected?.unitsPerCarton ?? 1, selected?.pcsPerBox ?? 0)} (${qty} ${unit.toLowerCase()}) — FEFO basis par process hua` })
      onOpenChange(false)
      onSaved()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Stock Adjustment</DialogTitle>
          <DialogDescription>Physical count, damage ya reconciliation entries</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setProductId('') }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{data?.warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Product</Label>
            {/* Task 32: SEARCHABLE product picker — pehla plain Select tha jo sainkron SKUs mein
                scroll karna parta tha (Task 67/81 jaisa ProductCombobox ab yahan bhi) */}
            <ProductCombobox
              products={productOptions.map((r) => ({
                id: r.productId, name: r.productName, sku: r.sku, brand: r.brand,
                meta: `stock ${fmtQty(r.totalQty, r.unitsPerCarton, r.pcsPerBox)}`,
              }))}
              value={productId}
              onSelect={setProductId}
              placeholder="Select product"
            />
            {selected && (
              <p className="text-xs text-slate-400">
                Available: {fmtQty(selected.totalQty, selected.unitsPerCarton, selected.pcsPerBox)} • {packHint(selected.unitsPerCarton, selected.boxesPerCarton, selected.pcsPerBox)}
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">IN (Add stock)</SelectItem>
                  <SelectItem value="OUT">OUT (Reduce stock)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Unit</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as 'CTN' | 'BOX' | 'PCS')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CTN">Ctn ({selected?.unitsPerCarton ?? '—'} pcs)</SelectItem>
                  {(selected?.pcsPerBox ?? 0) > 0 && <SelectItem value="BOX">Box ({selected?.pcsPerBox} pcs)</SelectItem>}
                  <SelectItem value="PCS">Pcs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Qty</Label>
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
          </div>
          {qtyPcs > 0 && (
            <p className="text-[11px] text-emerald-700 font-medium">= {fmtQty(qtyPcs, selected?.unitsPerCarton ?? 1, selected?.pcsPerBox ?? 0)} ({qtyPcs} pcs)</p>
          )}
          <div className="grid gap-1.5">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Physical count difference / damage / expiry..." rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 w-full">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Save Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ Warehouse Management (Task 21-k) — banao / edit / delete ============
function ManageWarehousesDialog({ open, onOpenChange, data, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  data: InventoryData
  onSaved: () => void
}) {
  const user = useDMS((s) => s.user)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Task 22: warehouse hamesha caller ke APNE naam par banta hai (owner picker removed)

  function resetForm() {
    setEditingId(null)
    setName('')
    setCity('')
    setIsPrimary(false)
    setConfirmDel(null)
  }

  function startEdit(w: WarehouseDTO) {
    setEditingId(w.id)
    setName(w.name)
    setCity(w.city)
    setIsPrimary(w.isPrimary)
    setConfirmDel(null)
  }

  async function save() {
    if (!name.trim() || !city.trim()) {
      toast({ title: 'Missing info', description: 'Warehouse ka naam aur city dono likhein', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await api('/api/warehouses/' + editingId, {
          method: 'PATCH',
          body: JSON.stringify({ userId: user?.id, name, city, isPrimary }),
        })
        toast({ title: 'Warehouse update ho gaya ✓', description: `${name} — tabs mein turant nazar aayega` })
      } else {
        await api('/api/warehouses', {
          method: 'POST',
          body: JSON.stringify({ userId: user?.id, name, city, isPrimary }),
        })
        toast({ title: 'Warehouse ban gaya ✓', description: `${name} (${city}) — ab ismein stock receive ho sakta hai` })
      }
      resetForm()
      onSaved()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    try {
      await api('/api/warehouses/' + id + '?userId=' + user?.id, { method: 'DELETE' })
      toast({ title: 'Warehouse delete ho gaya ✓' })
      setConfirmDel(null)
      if (editingId === id) resetForm()
      onSaved()
    } catch (e) {
      toast({ title: 'Delete nahi hua', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
      setConfirmDel(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Warehouses</DialogTitle>
          <DialogDescription>Naya warehouse banayein, naam/city edit karein ya khali warehouse delete karein</DialogDescription>
        </DialogHeader>

        {/* existing warehouses list */}
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
          {data.warehouses.map((w) => (
            <div key={w.id} className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
              <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                  {w.name} {w.isPrimary && <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[9px] px-1">PRIMARY</Badge>}
                </p>
                <p className="text-xs text-slate-400 truncate">{w.city} • {w.rows.length} products • {fmtNum(w.totalQty)} pcs</p>
              </div>
              {confirmDel === w.id ? (
                <>
                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => remove(w.id)}>Delete?</Button>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setConfirmDel(null)}><X className="h-3.5 w-3.5" /></Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => startEdit(w)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-red-500 hover:bg-red-50" onClick={() => setConfirmDel(w.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* add / edit form */}
        <div className="rounded-lg border bg-slate-50/60 p-3 grid gap-2.5">
          <p className="text-xs font-semibold text-slate-500">
            {editingId ? `EDIT: ${data.warehouses.find((w) => w.id === editingId)?.name ?? ''}` : 'NAYA WAREHOUSE — aap ke apne account par'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shahdara Godown" />
            </div>
            <div className="grid gap-1.5">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Lahore" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <Checkbox checked={isPrimary} onCheckedChange={(v) => setIsPrimary(v === true)} />
            Primary warehouse (orders/deliveries ka default)
          </label>
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} {editingId ? 'Save Changes' : 'Add Warehouse'}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={resetForm} className="border-slate-300">Cancel</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
