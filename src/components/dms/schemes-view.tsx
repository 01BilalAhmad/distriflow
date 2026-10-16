'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDMS } from '@/lib/dms-store'
import { api, fmtDate, fmtPKR } from '@/lib/dms-api'
import type { SchemeDTO, ProductDTO, CategoryDTO } from '@/lib/dms-types'
import { Plus, Gift, Percent, Package, Tag, Layers, Store, Loader2, CalendarDays, Pencil } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

const TYPE_META: Record<string, { label: string; icon: typeof Gift; color: string }> = {
  BUY_X_GET_Y: { label: 'Buy X Get Y', icon: Gift, color: 'text-emerald-700 bg-emerald-100' },
  PERCENT_DISCOUNT: { label: '% Discount', icon: Percent, color: 'text-teal-700 bg-teal-100' },
  FLAT_DISCOUNT: { label: 'Flat Discount', icon: Tag, color: 'text-amber-700 bg-amber-100' },
}

export function SchemesView() {
  const [schemes, setSchemes] = useState<SchemeDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SchemeDTO | null>(null)

  async function load() {
    setLoading(true)
    try {
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      const r = await api<{ schemes: SchemeDTO[] }>(`/api/schemes?userId=${user?.id ?? ''}`)
      setSchemes(r.schemes)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function toggleScheme(s: SchemeDTO) {
    try {
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      await api('/api/schemes', { method: 'PATCH', body: JSON.stringify({ id: s.id, isActive: !s.isActive, userId: user?.id }) })
      toast({ title: !s.isActive ? 'Scheme Activated ✓' : 'Scheme Paused', description: s.name })
      load()
    } catch { /* noop */ }
  }

  if (loading) return <div className="grid gap-4 md:grid-cols-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Schemes & Promotions</h2>
          <p className="text-sm text-slate-500">Trade offers — order booking ke waqt auto-apply hote hain</p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true) }} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-1.5" /> New Scheme
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {schemes.map((s) => {
          const meta = TYPE_META[s.type] ?? TYPE_META.FLAT_DISCOUNT
          return (
            <Card key={s.id} className={`border shadow-sm transition-opacity ${s.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${meta.color}`}>
                      <meta.icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{s.name}</p>
                      <p className="text-xs text-slate-500 line-clamp-2">{s.description ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50"
                      onClick={() => { setEditing(s); setDialogOpen(true) }}
                      title="Scheme edit karein"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Switch checked={s.isActive} onCheckedChange={() => toggleScheme(s)} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  <Badge variant="outline" className="text-[10px] border-slate-200">{meta.label}</Badge>
                  {s.channel ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700 bg-emerald-50">
                      <Tag className="h-3 w-3 mr-0.5" /> {s.channel}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-500">All channels</Badge>
                  )}
                  {s.productName && (
                    <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600 truncate max-w-44">
                      <Package className="h-3 w-3 mr-0.5" /> {s.productName}
                    </Badge>
                  )}
                  {s.categoryName && (
                    <Badge variant="outline" className="text-[10px] border-violet-200 text-violet-700 bg-violet-50">
                      <Layers className="h-3 w-3 mr-0.5" /> Category: {s.categoryName}
                    </Badge>
                  )}
                  {s.filerScope && (
                    <Badge variant="outline" className={`text-[10px] ${s.filerScope === 'FILER' ? 'border-blue-200 text-blue-700 bg-blue-50' : 'border-amber-200 text-amber-700 bg-amber-50'}`}>
                      <Store className="h-3 w-3 mr-0.5" /> {s.filerScope === 'FILER' ? 'Filer shops only' : 'Non-filer shops only'}
                    </Badge>
                  )}
                </div>

                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-emerald-700">
                    {s.type === 'BUY_X_GET_Y' ? `Buy ${s.buyQty} → Get ${s.freeQty} FREE` : s.type === 'PERCENT_DISCOUNT' ? `${s.value}% off` : `${fmtPKR(s.value)} off / carton`}
                  </span>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {fmtDate(s.startDate)} — {s.endDate ? fmtDate(s.endDate) : 'Open'}
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <SchemeDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={load} editScheme={editing} />
    </div>
  )
}

/** Task 41: ek hi dialog CREATE + EDIT dono ke liye. Edit par sab fields prefill,
 * PATCH full-fields. IMPORTANT: scheme edit karne se PURANE bills nahi badalte —
 * order items booking waqt ka scheme snapshot store karte hain. */
function SchemeDialog({ open, onOpenChange, onSaved, editScheme }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void; editScheme: SchemeDTO | null }) {
  const [products, setProducts] = useState<ProductDTO[]>([])
  const [categories, setCategories] = useState<CategoryDTO[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('PERCENT_DISCOUNT')
  const [channel, setChannel] = useState('ALL')
  // Task 55: Apply To — ALL | PRODUCT | CATEGORY (category = puri category par ek discount)
  const [applyTo, setApplyTo] = useState('ALL')
  const [productId, setProductId] = useState('ALL')
  const [categoryId, setCategoryId] = useState('')
  // Task 55: Outlet Tax Status — ALL | FILER | NON_FILER ("Non-Filer Special" ke liye)
  const [filerScope, setFilerScope] = useState('ALL')
  const [value, setValue] = useState('5')
  const [buyQty, setBuyQty] = useState('5')
  const [freeQty, setFreeQty] = useState('1')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
    fetch(`/api/products?userId=${user?.id ?? ''}`).then((r) => r.json()).then((r) => setProducts(r.products ?? [])).catch(() => {})
    fetch(`/api/categories?userId=${user?.id ?? ''}`).then((r) => r.json()).then((r) => setCategories(r.categories ?? [])).catch(() => {})
    // edit mode: scheme ke values prefill | create mode: defaults reset
    if (editScheme) {
      setName(editScheme.name)
      setDescription(editScheme.description ?? '')
      setType(editScheme.type)
      setChannel(editScheme.channel ?? 'ALL')
      setApplyTo(editScheme.categoryId ? 'CATEGORY' : editScheme.productId ? 'PRODUCT' : 'ALL')
      setProductId(editScheme.productId ?? 'ALL')
      setCategoryId(editScheme.categoryId ?? '')
      setFilerScope(editScheme.filerScope ?? 'ALL')
      setValue(String(editScheme.value))
      setBuyQty(String(editScheme.buyQty))
      setFreeQty(String(editScheme.freeQty))
      setEndDate(editScheme.endDate ? editScheme.endDate.slice(0, 10) : '')
    } else {
      setName(''); setDescription(''); setType('PERCENT_DISCOUNT'); setChannel('ALL')
      setApplyTo('ALL'); setProductId('ALL'); setCategoryId(''); setFilerScope('ALL')
      setValue('5'); setBuyQty('5'); setFreeQty('1'); setEndDate('')
    }
  }, [open, editScheme])

  async function save() {
    if (!name) { toast({ title: 'Scheme name required hai', variant: 'destructive' }); return }
    if (applyTo === 'PRODUCT' && (!productId || productId === 'ALL')) { toast({ title: 'Product select karein — ya Apply To "All Products" rakhein', variant: 'destructive' }); return }
    if (applyTo === 'CATEGORY' && !categoryId) { toast({ title: 'Category select karein — ya Apply To "All Products" rakhein', variant: 'destructive' }); return }
    setSaving(true)
    try {
      const payload = {
        userId: (JSON.parse(localStorage.getItem('dms_session') ?? 'null'))?.id,
        name, description, type,
        channel: channel === 'ALL' ? null : channel,
        productId: applyTo === 'PRODUCT' ? productId : null,
        categoryId: applyTo === 'CATEGORY' ? categoryId : null,
        filerScope: filerScope === 'ALL' ? null : filerScope,
        value: Number(value), buyQty: Number(buyQty), freeQty: Number(freeQty),
        endDate: endDate || null,
      }
      if (editScheme) {
        await api('/api/schemes', { method: 'PATCH', body: JSON.stringify({ ...payload, id: editScheme.id }) })
        toast({ title: 'Scheme Update ho gayi ✓', description: `${name} — naye orders par naye values lagenge, purane bills unchanged` })
      } else {
        await api('/api/schemes', { method: 'POST', body: JSON.stringify(payload) })
        toast({ title: 'Scheme Created ✓', description: `${name} — ab orders par auto-apply hoga` })
      }
      onOpenChange(false)
      onSaved()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editScheme ? 'Edit Scheme' : 'New Trade Scheme'}</DialogTitle>
          <DialogDescription>
            {editScheme
              ? 'Values update karein — sirf NAYE orders par lagenge, purane bills ke discount nahi badlenge'
              : 'Channel, category ya filer/non-filer shops ke liye offer define karein'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Scheme Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coke Summer Bundle 5+1" />
          </div>
          <div className="grid gap-1.5"><Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short detail..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT_DISCOUNT">% Discount</SelectItem>
                  <SelectItem value="FLAT_DISCOUNT">Flat Discount</SelectItem>
                  <SelectItem value="BUY_X_GET_Y">Buy X Get Y</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Channels</SelectItem>
                  <SelectItem value="KIRYANA">Kiryana</SelectItem>
                  <SelectItem value="SUPERMARKET">Supermarket</SelectItem>
                  <SelectItem value="WHOLESALE">Wholesale</SelectItem>
                  <SelectItem value="GENERAL">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Apply To</Label>
              <Select value={applyTo} onValueChange={(v) => { setApplyTo(v); if (v !== 'PRODUCT') setProductId('ALL'); if (v !== 'CATEGORY') setCategoryId('') }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Products</SelectItem>
                  <SelectItem value="PRODUCT">Single Product</SelectItem>
                  <SelectItem value="CATEGORY">Whole Category</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Outlet Tax Status</Label>
              <Select value={filerScope} onValueChange={setFilerScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Outlets</SelectItem>
                  <SelectItem value="FILER">Filer shops only</SelectItem>
                  <SelectItem value="NON_FILER">Non-filer shops only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {applyTo === 'PRODUCT' && (
            <div className="grid gap-1.5"><Label>Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" disabled>— product chunein —</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {applyTo === 'CATEGORY' && (
            <div className="grid gap-1.5"><Label>Category</Label>
              <Select value={categoryId || undefined} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Category chunein" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.productCount ? ` (${c.productCount} products)` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {(type === 'PERCENT_DISCOUNT' || type === 'FLAT_DISCOUNT') && (
              <div className="grid gap-1.5"><Label>{type === 'PERCENT_DISCOUNT' ? 'Percent' : 'Rs / carton'}</Label>
                <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></div>
            )}
            {type === 'BUY_X_GET_Y' && (
              <>
                <div className="grid gap-1.5"><Label>Buy Qty</Label><Input type="number" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} /></div>
                <div className="grid gap-1.5"><Label>Free Qty</Label><Input type="number" value={freeQty} onChange={(e) => setFreeQty(e.target.value)} /></div>
              </>
            )}
            <div className="grid gap-1.5"><Label>End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Stacking rule: Product &gt; Category &gt; All-Products — har level ki best scheme
            lagti hai aur levels <span className="font-medium">aapas mein jurti hain</span> (e.g.
            Eclair 3% + Khushhali Program 2% = 5%). Ek hi level par 2 schemes hon to behtar wali
            (best-wins) lagegi.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} {editScheme ? 'Save Changes' : 'Create Scheme'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
