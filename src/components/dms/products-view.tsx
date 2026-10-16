'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR, fmtNum } from '@/lib/dms-api'
import { fmtQty, packHint } from '@/components/dms/unit-qty'
import type { ProductDTO, CompanyDTO, CategoryDTO } from '@/lib/dms-types'
import { BulkImportDialog, type BulkColumn, type ParseOutcome } from '@/components/dms/bulk-import-dialog'
import { Plus, Search, Loader2, Package, Building2, Pencil, Upload, Tags } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

// Task 53: categories ab DB-backed (per-tenant) — GET /api/categories first run par
// defaults seed karta hai, "＋" button se user apni marzi ki category bana sakta hai.

const PRODUCT_IMPORT_COLUMNS: BulkColumn[] = [
  { key: 'sku', label: 'SKU', required: true, hint: 'Duplicate SKU skip hoga' },
  { key: 'name', label: 'Product Name', required: true },
  { key: 'brand', label: 'Brand', required: true, hint: 'Naya brand khud ban jayega' },
  { key: 'company', label: 'Company', hint: 'Nayi company khud ban jayegi' },
  { key: 'category', label: 'Category', hint: 'Koi bhi naam — nayi category khud ban jayegi' },
  { key: 'unitsPerCarton', label: 'Pcs/Carton', hint: 'Ya phir Boxes + Pcs/Box dono dein' },
  { key: 'boxesPerCarton', label: 'Boxes/Carton', hint: 'Box level ho to ye + Pcs/Box' },
  { key: 'pcsPerBox', label: 'Pcs/Box' },
  { key: 'purchasePrice', label: 'Purchase Rs/Ctn', hint: 'Optional' },
  { key: 'tradePrice', label: 'Trade Rs/Ctn', required: true },
  { key: 'consumerPrice', label: 'Consumer Rs/Pc', hint: 'Optional' },
  { key: 'gstRate', label: 'GST %', hint: 'Khali = 18% — "no" likho to is product par GST nahi' },
]

const PRODUCT_SAMPLE_ROWS = [
  ['LU-CND-672', 'LU Candi Biscuits 672g', 'LU', 'English Biscuit Manufacturers', 'Snacks', '24', '', '', '2100', '2600', '130', '18'],
  ['TAP-CHS-440', 'Tapal Chai Family Pack 440g', 'Tapal', 'Tapal Tea', 'Tea', '', '12', '24', '1980', '2400', '120', ''],
  ['NRP-JUI-1000', 'Nurpur Juice 1000ml', 'Nurpur', 'Nurpur Foods', 'Dairy', '12', '', '', '1440', '1800', '180', 'no'],
]

interface ProductForm {
  sku: string
  name: string
  brand: string
  company: string
  category: string
  unitsPerCarton: string
  boxesPerCarton: string
  pcsPerBox: string
  purchasePrice: string
  tradePrice: string
  consumerPrice: string
  gstOn: boolean
  gstRate: string
}

const EMPTY_FORM: ProductForm = {
  sku: '', name: '', brand: '', company: '', category: 'Snacks',
  unitsPerCarton: '24', boxesPerCarton: '', pcsPerBox: '',
  purchasePrice: '', tradePrice: '', consumerPrice: '',
  gstOn: true, gstRate: '18',
}

function formFromProduct(p: ProductDTO): ProductForm {
  return {
    sku: p.sku, name: p.name, brand: p.brand, company: p.company?.id ?? '', category: p.category,
    unitsPerCarton: String(p.unitsPerCarton),
    boxesPerCarton: p.boxesPerCarton > 0 ? String(p.boxesPerCarton) : '',
    pcsPerBox: p.pcsPerBox > 0 ? String(p.pcsPerBox) : '',
    purchasePrice: p.purchasePrice != null ? String(p.purchasePrice) : '',
    tradePrice: String(p.tradePrice),
    consumerPrice: p.consumerPrice != null ? String(p.consumerPrice) : '',
    gstOn: p.gstEnabled, gstRate: String(p.gstRate),
  }
}

export function ProductsView() {
  const user = useDMS((s) => s.user)
  const [products, setProducts] = useState<ProductDTO[]>([])
  const [companies, setCompanies] = useState<CompanyDTO[]>([])
  const [categories, setCategories] = useState<CategoryDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('ALL')
  const [addOpen, setAddOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<ProductDTO | null>(null)
  const [companiesOpen, setCompaniesOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const r = await api<{ products: ProductDTO[] }>(`/api/products?userId=${user.id}`)
      setProducts(r.products)
      const c = await api<{ companies: CompanyDTO[] }>(`/api/companies?userId=${user.id}`)
      setCompanies(c.companies)
      const cat = await api<{ categories: CategoryDTO[] }>(`/api/categories?userId=${user.id}`)
      setCategories(cat.categories)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [user])

  const filtered = useMemo(() => products.filter((p) => {
    if (companyFilter !== 'ALL' && p.company?.id !== companyFilter) return false
    return `${p.name} ${p.sku} ${p.brand} ${p.category} ${p.company?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())
  }), [products, search, companyFilter])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Product Catalog (SKUs)</h2>
          <p className="text-sm text-slate-500">{companies.length} companies • {products.length} SKUs — edit, rates, pack sizes aur per-product GST</p>
        </div>
        <div className="flex gap-2">
          {user?.role !== 'SALESMAN' && (
            <>
              <Button variant="outline" onClick={() => setCompaniesOpen(true)} className="border-slate-300 text-slate-700 hover:bg-slate-50">
                <Building2 className="h-4 w-4 mr-1.5" /> Companies
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                <Upload className="h-4 w-4 mr-1.5" /> Bulk Import
              </Button>
              <Button onClick={() => setAddOpen(true)} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-1.5" /> Add Product</Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU, name, brand ya company search karein..." className="pl-9" />
        </div>
        {user?.role !== 'SALESMAN' && (
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm sm:w-56">
            <option value="ALL">Sab Companies</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.productCount ?? 0})</option>)}
          </select>
        )}
      </div>

      <Card className="border-slate-200 shadow-sm flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/70">
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="hidden md:table-cell">Company</TableHead>
                    <TableHead className="hidden lg:table-cell">Brand</TableHead>
                    <TableHead className="hidden xl:table-cell">Category</TableHead>
                    <TableHead className="text-right">Pack (Ctn/Box/Pcs)</TableHead>
                    <TableHead className="text-right">Purchase</TableHead>
                    <TableHead className="text-right">Trade</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="hidden md:table-cell text-right">GP/Crtn</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    {user?.role !== 'SALESMAN' && <TableHead className="text-right">Edit</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const gp = p.purchasePrice != null ? p.tradePrice - p.purchasePrice : null
                    const lowStock = p.stock < 30 * Math.max(1, p.unitsPerCarton)
                    return (
                      <TableRow key={p.id} className="hover:bg-emerald-50/30">
                        <TableCell className="font-mono text-xs text-slate-500">{p.sku}</TableCell>
                        <TableCell className="font-medium text-slate-800">{p.name}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          {p.company ? (
                            <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700 text-[10px]">{p.company.shortCode ?? p.company.name}</Badge>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell"><Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50 text-[10px]">{p.brand}</Badge></TableCell>
                        <TableCell className="hidden xl:table-cell text-slate-500 text-sm">{p.category}</TableCell>
                        <TableCell className="text-right text-slate-600 whitespace-nowrap">
                          {p.unitsPerCarton}
                          {p.boxesPerCarton > 0 && p.pcsPerBox > 0 && (
                            <span className="text-[10px] text-slate-400 block leading-tight">{p.boxesPerCarton} box × {p.pcsPerBox} pcs</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-slate-600">{p.purchasePrice != null ? fmtPKR(p.purchasePrice) : '—'}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtPKR(p.tradePrice)}</TableCell>
                        <TableCell className="text-right">
                          {p.gstEnabled ? (
                            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 text-[10px]">{Math.round(p.gstRate * 100) / 100}%</Badge>
                          ) : (
                            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-400 text-[10px]">No GST</Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right">{gp != null ? <span className={gp > 0 ? 'text-emerald-600 font-medium' : 'text-red-500'}>+{fmtNum(gp)}</span> : '—'}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <span className={lowStock ? 'text-red-500 font-semibold' : 'text-slate-700 font-medium'}>{fmtQty(p.stock, p.unitsPerCarton, p.pcsPerBox)}</span>
                        </TableCell>
                        {user?.role !== 'SALESMAN' && (
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-emerald-600" title="Edit product / rates"
                              onClick={() => setEditProduct(p)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProductFormDialog open={addOpen} onOpenChange={setAddOpen} onSaved={load} companies={companies} categories={categories} onCategoriesChanged={load} />
      <ProductFormDialog open={!!editProduct} onOpenChange={(v) => { if (!v) setEditProduct(null) }} onSaved={load} companies={companies} categories={categories} onCategoriesChanged={load} product={editProduct} />
      <CompaniesDialog open={companiesOpen} onOpenChange={setCompaniesOpen} companies={companies} onChanged={load} />
      <BulkImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Bulk Products Import"
        description="Excel/CSV se poora catalog ek sath add karein — naya brand/company khud ban jayega, duplicate SKU skip hoga"
        accent="bg-emerald-600 hover:bg-emerald-700"
        columns={PRODUCT_IMPORT_COLUMNS}
        sampleRows={PRODUCT_SAMPLE_ROWS}
        parseRow={parseProductRow}
        importRequest={async (rows) => {
          const r = await api<{ imported: number; skipped: { row: number; name: string; reason: string }[]; warnings?: { row: number; name: string; reason: string }[] }>('/api/products/import', {
            method: 'POST',
            body: JSON.stringify({ userId: user?.id, rows }),
          })
          toast({ title: `${r.imported} products import hue ✓`, description: r.skipped.length ? `${r.skipped.length} skip hue — wajah dialog mein dekhein` : 'Poora catalog add ho gaya' })
          return r
        }}
        onDone={load}
      />
    </div>
  )
}

/** Product CSV row validate — required fields + numeric checks (pack/rates server normalize karta hai) */
function parseProductRow(r: Record<string, string>): ParseOutcome<Record<string, string>> {
  const sku = (r.sku ?? '').trim(), name = (r.name ?? '').trim(), brand = (r.brand ?? '').trim(), trade = (r.tradePrice ?? '').trim()
  if (!sku || !name || !brand || !trade) return { ok: false, error: 'SKU, Product Name, Brand aur Trade Price zaroori hain' }
  if (!Number.isFinite(Number(trade)) || Number(trade) <= 0) return { ok: false, error: `Trade price ghalat: "${trade}"` }
  // Task 37: GST % optional — khali = default 18; number 0-100 = rate; no/off = GST nahi
  const gst = (r.gstRate ?? '').trim().toLowerCase()
  if (gst && !['no', 'off', 'nai', 'none', 'nahi'].includes(gst) && (!Number.isFinite(Number(gst)) || Number(gst) < 0 || Number(gst) > 100)) {
    return { ok: false, error: `GST % ghalat: "${r.gstRate}" — number (0-100) ya no/off likhein` }
  }
  for (const k of ['unitsPerCarton', 'boxesPerCarton', 'pcsPerBox', 'purchasePrice', 'consumerPrice'] as const) {
    const v = (r[k] ?? '').trim()
    if (v && !Number.isFinite(Number(v))) return { ok: false, error: `${k} number hona chahiye: "${v}"` }
  }
  return { ok: true, value: r }
}

/** Add + Edit dono ek hi form se — edit mode mein SKU change allowed hai (unique check server karta hai) */
function ProductFormDialog({ open, onOpenChange, onSaved, companies, categories, onCategoriesChanged, product }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
  companies: CompanyDTO[]
  categories: CategoryDTO[]
  onCategoriesChanged: () => void
  product?: ProductDTO | null
}) {
  const user = useDMS((s) => s.user)
  const editing = !!product
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [packMode, setPackMode] = useState<'box' | 'pcs'>('box')
  const [saving, setSaving] = useState(false)
  const [catOpen, setCatOpen] = useState(false) // Task 53: naya category mini-dialog

  useEffect(() => {
    if (open) {
      setForm(product ? formFromProduct(product) : EMPTY_FORM)
      // mode auto-derive: product ke paas box level hai ya nahi (naye SKU default Box mode)
      setPackMode(product ? (product.boxesPerCarton > 0 && product.pcsPerBox > 0 ? 'box' : 'pcs') : 'box')
    }
  }, [open, product])

  const boxes = Math.max(0, Math.floor(Number(form.boxesPerCarton) || 0))
  const pcsBox = Math.max(0, Math.floor(Number(form.pcsPerBox) || 0))
  // Box mode: unitsPerCarton auto-sync (1 Ctn = Box × Pcs) — user sirf 2 fields bharta hai
  useEffect(() => {
    if (packMode === 'box' && boxes > 0 && pcsBox > 0) {
      setForm((f) => ({ ...f, unitsPerCarton: String(boxes * pcsBox) }))
    }
  }, [boxes, pcsBox, packMode])

  function switchMode(m: 'box' | 'pcs') {
    setPackMode(m)
    if (m === 'pcs') setForm((f) => ({ ...f, boxesPerCarton: '', pcsPerBox: '' }))
  }

  async function save() {
    if (!form.sku || !form.name || !form.brand || !form.tradePrice) {
      toast({ title: 'Missing info', description: 'SKU, name, brand aur trade price required', variant: 'destructive' }); return
    }
    if (!editing && !form.company) {
      toast({ title: 'Company select karein', description: 'Product kis company ka hai — pehle select karein', variant: 'destructive' }); return
    }
    const gr = Number(form.gstRate)
    if (form.gstOn && (!Number.isFinite(gr) || gr < 0 || gr > 100)) {
      toast({ title: 'Invalid GST rate', description: 'GST rate 0 se 100 ke beech hona chahiye', variant: 'destructive' }); return
    }
    if (editing && !product) return
    setSaving(true)
    try {
      const body = JSON.stringify({
        userId: user?.id,
        sku: form.sku, name: form.name, brand: form.brand, companyId: form.company || null, category: form.category,
        unitsPerCarton: Number(form.unitsPerCarton) || 12,
        boxesPerCarton: packMode === 'box' ? boxes : 0, pcsPerBox: packMode === 'box' ? pcsBox : 0,
        purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : null,
        tradePrice: Number(form.tradePrice),
        consumerPrice: form.consumerPrice ? Number(form.consumerPrice) : null,
        // Task 37: per-product GST
        gstEnabled: form.gstOn,
        gstRate: form.gstOn ? gr : (Number.isFinite(gr) ? gr : 18),
      })
      if (editing && product) {
        await api(`/api/products/${product.id}`, { method: 'PATCH', body })
        toast({ title: 'Product Updated ✓', description: `${form.name} — rates/pack/GST save ho gaye (naye orders par lagein ge)` })
      } else {
        await api('/api/products', { method: 'POST', body })
        toast({ title: 'Product Added ✓', description: form.name })
      }
      onOpenChange(false)
      onSaved()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-emerald-600" />
            {editing ? 'Edit Product / Rates' : 'Add New SKU'}
          </DialogTitle>
          <DialogDescription>
            {editing ? 'Rates ya pack sizes update karein — purani invoices apne rates rakhti hain, naye orders par naya rate lage ga' : 'Product catalog mein naya product add karein'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>SKU *</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder="LU-CND-672" /></div>
            <div className="grid gap-1.5"><Label>Brand *</Label><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="LU / Noms / Cadbury" /></div>
          </div>
          <div className="grid gap-1.5"><Label>Product Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="LU Candi Biscuits 672g" /></div>
          <div className="grid gap-1.5">
            <Label>Company {!editing && <span className="text-red-500">*</span>}</Label>
            <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm">
              <option value="">{editing ? '— Company change karein —' : 'Kis company ka product hai?'}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {companies.length === 0 && <p className="text-[11px] text-amber-600">Pehle &quot;Companies&quot; button se company add karein</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label>Category</Label>
              <div className="flex gap-1.5">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm">
                  {/* Task 53: DB categories + legacy value (purana product agar list se bahar category par ho) */}
                  {Array.from(new Set([...categories.map((c) => c.name), form.category].filter(Boolean))).map((c) => <option key={c}>{c}</option>)}
                </select>
                <Button type="button" variant="outline" size="icon" onClick={() => setCatOpen(true)} title="Nayi category banayein" className="h-9 w-9 shrink-0 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5"><Label>Consumer (Rs/unit)</Label><Input type="number" value={form.consumerPrice} onChange={(e) => setForm({ ...form, consumerPrice: e.target.value })} placeholder="130" /></div>
          </div>
          {/* Packing — easy mode: toggle + sirf 2 sawal, unitsPerCarton auto calculate */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5">
            <p className="text-[11px] font-semibold text-slate-700 mb-1.5">Packing — 1 Ctn (carton) ke andar kya hota hai?</p>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-0.5 mb-2">
              <button type="button" onClick={() => switchMode('pcs')}
                className={`h-7 rounded-md text-[11px] font-medium transition-colors ${packMode === 'pcs' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                Sirf Pcs
              </button>
              <button type="button" onClick={() => switchMode('box')}
                className={`h-7 rounded-md text-[11px] font-medium transition-colors ${packMode === 'box' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                Ctn → Box → Pcs
              </button>
            </div>
            {packMode === 'box' ? (
              <>
                <div className="flex items-end gap-2">
                  <div className="grid gap-1 flex-1"><Label className="text-[11px]">1 Ctn mein Boxes</Label><Input type="number" min={0} value={form.boxesPerCarton} onChange={(e) => setForm({ ...form, boxesPerCarton: e.target.value })} placeholder="12" /></div>
                  <span className="pb-2.5 text-slate-400 text-sm font-medium">×</span>
                  <div className="grid gap-1 flex-1"><Label className="text-[11px]">1 Box mein Pcs</Label><Input type="number" min={0} value={form.pcsPerBox} onChange={(e) => setForm({ ...form, pcsPerBox: e.target.value })} placeholder="24" /></div>
                  <div className="pb-1 text-center min-w-[3rem]">
                    <div className={`text-lg font-bold leading-tight ${boxes * pcsBox > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{boxes * pcsBox > 0 ? boxes * pcsBox : '—'}</div>
                    <div className="text-[9px] text-slate-400 leading-none">pcs / ctn</div>
                  </div>
                </div>
                <p className="text-[10px] mt-1.5">
                  {boxes > 0 && pcsBox > 0
                    ? <span className="text-emerald-700 font-medium">✓ 1 Ctn = {boxes} Box × {pcsBox} Pcs = {boxes * pcsBox} Pcs — order mein Ctn/Box/Pcs teeno inputs milenge</span>
                    : <span className="text-slate-500">Dono fields bharein — misal: CDM-100 → 12 Box × 24 Pcs = 288 Pcs/ctn</span>}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <div className="grid gap-1 flex-1"><Label className="text-[11px]">1 Ctn mein Pcs</Label><Input type="number" min={1} value={form.unitsPerCarton} onChange={(e) => setForm({ ...form, unitsPerCarton: e.target.value })} placeholder="24" /></div>
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5">1 Ctn = {Number(form.unitsPerCarton) || 0} Pcs — order mein sirf Ctn aur Pcs inputs (Box nahi hogi)</p>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label>Purchase (Rs/crtn)</Label><Input type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} placeholder="2100" /></div>
            <div className="grid gap-1.5"><Label>Trade (Rs/crtn) *</Label><Input type="number" value={form.tradePrice} onChange={(e) => setForm({ ...form, tradePrice: e.target.value })} placeholder="2600" /></div>
          </div>
          <p className="text-[11px] text-slate-400">
            Order rate per piece = {fmtPKR((Number(form.tradePrice) || 0) / Math.max(1, Number(form.unitsPerCarton) || 1))} — {packHint(Number(form.unitsPerCarton) || 12, boxes, pcsBox)}
          </p>
          {/* Task 37: GST — per product (global Tax Settings se yahan move hua) */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[11px] font-semibold text-slate-700">GST (Sales Tax) — is product par?</p>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
                <button type="button" onClick={() => setForm((f) => ({ ...f, gstOn: false }))}
                  className={`h-7 rounded-md px-3 text-[11px] font-medium transition-colors ${!form.gstOn ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                  No GST
                </button>
                <button type="button" onClick={() => setForm((f) => ({ ...f, gstOn: true }))}
                  className={`h-7 rounded-md px-3 text-[11px] font-medium transition-colors ${form.gstOn ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                  GST On
                </button>
              </div>
            </div>
            {form.gstOn ? (
              <div className="flex items-end gap-2">
                <div className="grid gap-1 w-24"><Label className="text-[11px]">Rate %</Label><Input type="number" min={0} max={100} step={0.5} value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })} placeholder="18" /></div>
                <p className="text-[10px] text-slate-500 leading-snug pb-1">Bill par is product ki rows mein "GST @ {form.gstRate || 0}%" hisab isi rate se hoga — doosre products apne apne rate se</p>
              </div>
            ) : (
              <p className="text-[10px] text-slate-500 leading-snug">Is product par GST nahi lagegi — bill par is product ki GST columns mein dash aayega (misal: fresh dairy, exempt items)</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {editing ? 'Save Changes' : 'Add Product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <NewCategoryDialog
      open={catOpen}
      onOpenChange={setCatOpen}
      onCreated={(name) => setForm((f) => ({ ...f, category: name }))}
      onChanged={onCategoriesChanged}
    />
    </>
  )
}

/** Task 53: nayi category — POST /api/categories, list refresh + form mein auto-select */
function NewCategoryDialog({ open, onOpenChange, onCreated, onChanged }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (name: string) => void
  onChanged: () => void
}) {
  const user = useDMS((s) => s.user)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open) setName('') }, [open])

  async function save() {
    if (!name.trim()) {
      toast({ title: 'Category ka naam likhein', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      const r = await api<{ category: { id: string; name: string } }>('/api/categories', {
        method: 'POST',
        body: JSON.stringify({ userId: user?.id, name: name.trim() }),
      })
      toast({ title: 'Category Added ✓', description: r.category.name })
      onCreated(r.category.name)
      onChanged()
      onOpenChange(false)
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tags className="h-5 w-5 text-emerald-600" /> Nayi Category</DialogTitle>
          <DialogDescription>Product group ka naam likhein (misal: Biscuits, Spices, Frozen) — ye sabhi product forms mein available hogi</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
          placeholder="Biscuits"
          autoFocus
        />
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Add Category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CompaniesDialog({ open, onOpenChange, companies, onChanged }: { open: boolean; onOpenChange: (v: boolean) => void; companies: CompanyDTO[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [shortCode, setShortCode] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) {
      toast({ title: 'Company name likhein', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      // Task 24: userId bhi bhejo warna API 400 deta hai (tenant stamp ke liye zaroori)
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      await api('/api/companies', { method: 'POST', body: JSON.stringify({ name, shortCode, userId: user?.id }) })
      toast({ title: 'Company Added ✓', description: name })
      setName(''); setShortCode('')
      onChanged()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-violet-600" /> Companies (Manufacturers)</DialogTitle>
          <DialogDescription>Multiple companies manage karein — har booker ko company assign hoti hai</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border">
          {companies.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Abhi koi company nahi</p>
          ) : companies.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2 border-b last:border-0">
              <div>
                <p className="text-sm font-medium text-slate-800">{c.name}</p>
                {c.shortCode && <p className="text-[11px] font-mono text-slate-400">{c.shortCode}</p>}
              </div>
              <div className="flex gap-1.5">
                <Badge variant="outline" className="border-emerald-200 text-emerald-700 text-[10px]">{c.productCount ?? 0} products</Badge>
                <Badge variant="outline" className="border-violet-200 text-violet-700 text-[10px]">{c.salesmanCount ?? 0} bookers</Badge>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nayi company, e.g. Hilal Foods" />
          <Input value={shortCode} onChange={(e) => setShortCode(e.target.value.toUpperCase())} placeholder="CODE" />
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="w-full bg-violet-600 hover:bg-violet-700">{saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Add Company</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
