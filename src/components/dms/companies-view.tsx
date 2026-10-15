'use client'

/**
 * Companies (Procurement) — supplier companies with logo + details,
 * purchase invoices (stock IN + payable) aur company payable ledger.
 * Balance = SUM(credit) - SUM(debit) => positive = company ko dena hai.
 */

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, fmtPKR, fmtNum, fmtDate } from '@/lib/dms-api'
import type {
  CompaniesData, CompanyFullDTO, CompanyLedgerDTO, PurchaseInvoiceDTO, ProductDTO,
} from '@/lib/dms-types'
import { useDMS } from '@/lib/dms-store'
import { CompanyStatementDoc } from './company-print'
import { SupplierAgingCard } from './supplier-aging'
import { keepDialogBehind } from './cbl-print'
import { toast } from '@/hooks/use-toast'
import {
  Building2, Search, Plus, Pencil, Printer, Truck, Landmark, Package,
  Upload, X, Phone, Mail, MapPin, User, Wallet, ClipboardList,
} from 'lucide-react'

const LEDGER_TYPE_STYLES: Record<string, string> = {
  PURCHASE: 'border-violet-200 bg-violet-50 text-violet-700',
  PAYMENT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DEBIT_NOTE: 'border-amber-200 bg-amber-50 text-amber-700',
  CREDIT_NOTE: 'border-red-200 bg-red-50 text-red-700',
  ADJUSTMENT: 'border-slate-200 bg-slate-100 text-slate-600',
}
const LEDGER_TYPE_LABELS: Record<string, string> = {
  PURCHASE: 'Purchase', PAYMENT: 'Payment', DEBIT_NOTE: 'Debit Note',
  CREDIT_NOTE: 'Credit Note', ADJUSTMENT: 'Adjustment',
}
const todayISO = () => new Date().toISOString().slice(0, 10)

// export: purchase-entry-view bhi yehi logo avatar use karta hai (Task 49)
export function CompanyLogo({ company, size = 'md' }: { company: Pick<CompanyFullDTO, 'name' | 'shortCode' | 'logo'>; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'sm' ? 'h-8 w-8 text-[10px]' : size === 'lg' ? 'h-16 w-16 text-xl' : 'h-12 w-12 text-sm'
  if (company.logo) {
    return <img src={company.logo} alt={`${company.name} logo`} className={`${cls} rounded-lg border border-slate-200 bg-white object-contain p-0.5 shrink-0`} />
  }
  return (
    <div className={`${cls} rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-500 shrink-0`}>
      {(company.shortCode ?? company.name).slice(0, 2).toUpperCase()}
    </div>
  )
}

function BalanceBadge({ balance }: { balance: number }) {
  if (balance > 0.01) return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 font-semibold">Payable {fmtPKR(balance)}</Badge>
  if (balance < -0.01) return <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 font-semibold">Advance {fmtPKR(-balance)}</Badge>
  return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">Clear</Badge>
}

// ==================== MAIN VIEW ====================

export function CompaniesView() {
  const openPurchaseEntry = useDMS((s) => s.openPurchaseEntry)
  const [data, setData] = useState<CompaniesData | null>(null)
  const [products, setProducts] = useState<ProductDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editCompany, setEditCompany] = useState<CompanyFullDTO | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  async function load() {
    setLoading(true)
    try {
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      const r = await api<CompaniesData>(`/api/companies?userId=${user?.id ?? ''}`)
      setData(r)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Companies load failed', variant: 'destructive' })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function loadProducts() {
    try {
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      const pr = await api<{ products: ProductDTO[] }>(`/api/products?userId=${user?.id ?? ''}`)
      setProducts(pr.products ?? [])
    } catch { setProducts([]) }
  }
  useEffect(() => { loadProducts() }, [])

  const filtered = useMemo(() => (data?.companies ?? []).filter((c) =>
    `${c.name} ${c.shortCode ?? ''} ${c.contactPerson ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(search.toLowerCase())
  ), [data, search])

  function openNew() { setEditCompany(null); setFormOpen(true) }
  function openEdit(c: CompanyFullDTO) { setEditCompany(c); setFormOpen(true) }
  // Task 49: dialog band — ab POORA PAGE khulta hai (purchase-entry view)
  function openPurchase(c: CompanyFullDTO) { openPurchaseEntry(c.id) }
  function onSaved() { load(); setRefreshKey((k) => k + 1) }

  const detailCompany = data?.companies.find((c) => c.id === detailId) ?? null

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Companies (Procurement)</h2>
          <p className="text-sm text-slate-500">Supplier companies — logo, details, stock purchase invoices aur payable ledger</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1.5" /> New Company
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-slate-200"><CardContent className="p-4">
            <p className="text-xs text-slate-400 uppercase font-semibold">Total Payable (Companies ko dena hai)</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{fmtPKR(data.totals.payable)}</p>
          </CardContent></Card>
          <Card className="border-slate-200"><CardContent className="p-4">
            <p className="text-xs text-slate-400 uppercase font-semibold">Total Stock Purchases</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{fmtPKR(data.totals.purchaseTotal)}</p>
          </CardContent></Card>
          <Card className="border-slate-200"><CardContent className="p-4">
            <p className="text-xs text-slate-400 uppercase font-semibold">Companies</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{data.totals.count}</p>
          </CardContent></Card>
        </div>
      )}

      <SupplierAgingCard refreshKey={refreshKey} />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Company, contact, phone search karein..." className="pl-9" />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.length === 0 && (
            <Card className="border-dashed sm:col-span-2 xl:col-span-3"><CardContent className="p-10 text-center text-sm text-slate-400">
              Koi company nahi mili — <button className="text-emerald-700 font-semibold underline" onClick={openNew}>New Company</button> se add karein
            </CardContent></Card>
          )}
          {filtered.map((c) => (
            <Card key={c.id} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <button className="hover:opacity-80 transition-opacity" onClick={() => setDetailId(c.id)} title="Company kholein">
                    <CompanyLogo company={c} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <button className="text-left w-full group" onClick={() => setDetailId(c.id)}>
                      <p className="font-bold text-slate-900 leading-tight truncate group-hover:text-emerald-700">{c.name}</p>
                      {c.shortCode && <Badge variant="outline" className="mt-1 text-[9px] border-violet-200 bg-violet-50 text-violet-700">{c.shortCode}</Badge>}
                    </button>
                    <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                      {c.contactPerson && <p className="truncate flex items-center gap-1"><User className="h-3 w-3 shrink-0" /> {c.contactPerson}</p>}
                      {c.phone && <p className="truncate flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" /> {c.phone}</p>}
                      {!c.contactPerson && !c.phone && <p className="italic text-slate-300">Details add nahi huin</p>}
                    </div>
                  </div>
                  <BalanceBadge balance={c.balance} />
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                  <span className="flex items-center gap-1"><Package className="h-3 w-3" /> {c.productCount} products</span>
                  <span className="flex items-center gap-1"><ClipboardList className="h-3 w-3" /> {c.invoiceCount ?? 0} purchases</span>
                  <span className="ml-auto font-semibold text-slate-600">{c.purchaseTotal ? fmtPKR(c.purchaseTotal) : '—'}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => setDetailId(c.id)}>
                    <Landmark className="h-3.5 w-3.5 mr-1" /> Ledger
                  </Button>
                  <Button size="sm" className="flex-1 h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => openPurchase(c)}>
                    <Truck className="h-3.5 w-3.5 mr-1" /> Purchase
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openEdit(c)} title="Edit company">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* company form (new / edit) */}
      {formOpen && (
        <CompanyFormDialog
          company={editCompany}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); onSaved() }}
        />
      )}

      {/* company detail: ledger + purchases (logo change par remount = fresh data) */}
      {detailCompany && (
        <CompanyDetailDialog
          key={`${detailCompany.id}-${detailCompany.logo ?? 'nologo'}`}
          company={detailCompany}
          products={products}
          onClose={() => setDetailId(null)}
          onEdit={() => openEdit(detailCompany)}
          onDataChanged={onSaved}
        />
      )}
    </div>
  )
}

// ==================== COMPANY FORM (NEW / EDIT) ====================

function CompanyFormDialog({ company, onClose, onSaved }: {
  company: CompanyFullDTO | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!company
  const [name, setName] = useState(company?.name ?? '')
  const [shortCode, setShortCode] = useState(company?.shortCode ?? '')
  const [contactPerson, setContactPerson] = useState(company?.contactPerson ?? '')
  const [phone, setPhone] = useState(company?.phone ?? '')
  const [email, setEmail] = useState(company?.email ?? '')
  const [address, setAddress] = useState(company?.address ?? '')
  const [notes, setNotes] = useState(company?.notes ?? '')
  const [logo, setLogo] = useState(company?.logo ?? '')
  const [saving, setSaving] = useState(false)

  function handleLogoFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Sirf image file upload karein', variant: 'destructive' })
      return
    }
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 240
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
      setLogo(canvas.toDataURL('image/png'))
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      toast({ title: 'Error', description: 'Image load nahi hui', variant: 'destructive' })
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  async function save() {
    if (!name.trim()) { toast({ title: 'Company name required hai', variant: 'destructive' }); return }
    setSaving(true)
    try {
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      const body = { name, shortCode, contactPerson, phone, email, address, notes, logo, userId: user?.id }
      if (isEdit) await api(`/api/companies/${company!.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      else await api('/api/companies', { method: 'POST', body: JSON.stringify(body) })
      toast({ title: isEdit ? 'Company update ho gayi' : 'Company add ho gayi', description: name })
      onSaved()
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Save failed', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Company' : 'New Company (Supplier)'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Company ki details aur logo update karein' : 'Stock purchase karne wali company add karein — logo upload bhi kar sakte hain'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* logo upload */}
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden bg-slate-50 shrink-0">
              {logo
                ? <img src={logo} alt="logo preview" className="h-full w-full object-contain p-1" />
                : <Building2 className="h-6 w-6 text-slate-300" />}
            </div>
            <div className="space-y-1.5">
              <input id="company-logo-input" type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = '' }} />
              <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('company-logo-input')?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Upload Logo
              </Button>
              {logo && (
                <Button type="button" size="sm" variant="ghost" className="text-red-500 h-7 block" onClick={() => setLogo('')}>
                  <X className="h-3.5 w-3.5 mr-1" /> Remove logo
                </Button>
              )}
              <p className="text-[10px] text-slate-400">Image auto-resize hoti hai (~240px)</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Company Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CBL (LU Biscuits)" /></div>
            <div className="space-y-1"><Label>Short Code</Label><Input value={shortCode} onChange={(e) => setShortCode(e.target.value)} placeholder="CBL" maxLength={8} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Contact Person</Label><Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Order booker / TM ka naam" /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300-1234567" /></div>
          </div>
          <div className="space-y-1"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@company.pk" /></div>
          <div className="space-y-1"><Label>Address</Label><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Company ka office / warehouse address" /></div>
          <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, order cycle waghera..." /></div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Update Company' : 'Add Company'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ==================== COMPANY DETAIL (LEDGER + PURCHASES) ====================

function CompanyDetailDialog({ company, products, onClose, onEdit, onDataChanged }: {
  company: CompanyFullDTO
  products: ProductDTO[]
  onClose: () => void
  onEdit: () => void
  onDataChanged: () => void
}) {
  const openPurchaseEntry = useDMS((s) => s.openPurchaseEntry)
  const [tab, setTab] = useState('ledger')
  const [ledger, setLedger] = useState<CompanyLedgerDTO | null>(null)
  const [invoices, setInvoices] = useState<PurchaseInvoiceDTO[] | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [entryMode, setEntryMode] = useState<'PAYMENT' | 'ADJUSTMENT' | null>(null)
  const [viewInvoice, setViewInvoice] = useState<PurchaseInvoiceDTO | null>(null)
  const [printOpen, setPrintOpen] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
        const l = await api<CompanyLedgerDTO>(`/api/companies/${company.id}/ledger?userId=${user?.id ?? ''}`)
        setLedger(l)
        const p = await api<{ invoices: PurchaseInvoiceDTO[] }>(`/api/purchase-invoices?companyId=${company.id}&userId=${user?.id ?? ''}`)
        setInvoices(p.invoices ?? [])
      } catch (e) {
        toast({ title: 'Error', description: e instanceof Error ? e.message : 'Data load failed', variant: 'destructive' })
      }
    }
    load()
  }, [company.id, refreshKey])

  function bump() { setRefreshKey((k) => k + 1); onDataChanged() }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-3xl max-h-[92vh] overflow-y-auto" {...keepDialogBehind}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <CompanyLogo company={company} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{company.name}</span>
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-normal text-slate-400 mt-0.5">
                {company.shortCode && <span className="font-bold text-violet-600">{company.shortCode}</span>}
                {company.contactPerson && <span className="flex items-center gap-0.5"><User className="h-3 w-3" />{company.contactPerson}</span>}
                {company.phone && <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" />{company.phone}</span>}
                {company.email && <span className="flex items-center gap-0.5"><Mail className="h-3 w-3" />{company.email}</span>}
                {company.address && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{company.address}</span>}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">Company ledger aur purchases</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <BalanceBadge balance={company.balance} />
          <span className="text-xs text-slate-400">{company.productCount} products • {company.salesmanCount ?? 0} bookers assigned</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={onEdit}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit</Button>
            {/* Task 49: dialog band — poora page khulta hai (koi overlay click-loss nahi) */}
            <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => openPurchaseEntry(company.id)}><Truck className="h-3.5 w-3.5 mr-1" /> New Purchase</Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="ledger" className="text-xs sm:text-sm"><Landmark className="h-3.5 w-3.5 mr-1.5 inline" />Payables Ledger</TabsTrigger>
            <TabsTrigger value="purchases" className="text-xs sm:text-sm"><ClipboardList className="h-3.5 w-3.5 mr-1.5 inline" />Purchase Invoices ({invoices?.length ?? '...'})</TabsTrigger>
          </TabsList>

          {/* ---------------- LEDGER TAB ---------------- */}
          <TabsContent value="ledger" className="space-y-3 mt-3">
            {/* Task 25: mobile par cards stack hon — 3-col track phone me clip hota tha */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Card className="border-slate-200"><CardContent className="p-3">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Purchases (Payable Barha)</p>
                <p className="text-lg font-bold text-violet-700">{ledger ? fmtPKR(ledger.totals.credit) : '...'}</p>
              </CardContent></Card>
              <Card className="border-slate-200"><CardContent className="p-3">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Paid / Adjusted</p>
                <p className="text-lg font-bold text-emerald-700">{ledger ? fmtPKR(ledger.totals.debit) : '...'}</p>
              </CardContent></Card>
              <Card className="border-slate-200"><CardContent className="p-3">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Balance (Dena hai)</p>
                <p className={`text-lg font-bold ${ledger && ledger.totals.balance > 0 ? 'text-red-600' : 'text-slate-800'}`}>{ledger ? fmtPKR(ledger.totals.balance) : '...'}</p>
              </CardContent></Card>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => setEntryMode('PAYMENT')}>
                <Wallet className="h-3.5 w-3.5 mr-1" /> Add Payment
              </Button>
              <Button size="sm" variant="outline" className="h-8 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => setEntryMode('ADJUSTMENT')}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Adjustment / Note
              </Button>
              <Button size="sm" variant="outline" className="h-8 ml-auto" disabled={!ledger || ledger.entries.length === 0} onClick={() => setPrintOpen(true)}>
                <Printer className="h-3.5 w-3.5 mr-1" /> Print Statement (PDF)
              </Button>
            </div>

            {/* Task 25: ScrollArea sirf vertical tha — ab plain overflow-auto (dono axes) +
                table min-width, take phone par table andar hi horizontally scroll ho,
                dialog ko blow na kare */}
            <div className="rounded-lg border bg-white overflow-hidden">
              <div className="max-h-[340px] overflow-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow className="bg-slate-50/70">
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Ref</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!ledger && <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-slate-400">Loading...</TableCell></TableRow>}
                    {ledger && ledger.entries.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-slate-400">Abhi koi entry nahi — Purchase Invoice book karein to payable yahan aayega</TableCell></TableRow>
                    )}
                    {ledger?.entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(e.date)}</TableCell>
                        <TableCell><Badge variant="outline" className={`text-[9px] ${LEDGER_TYPE_STYLES[e.type] ?? ''}`}>{LEDGER_TYPE_LABELS[e.type] ?? e.type}</Badge></TableCell>
                        <TableCell className="text-xs font-medium text-emerald-700">{e.refNo ?? '—'}</TableCell>
                        <TableCell className="text-xs text-slate-600 max-w-[220px] truncate">{e.description}</TableCell>
                        <TableCell className="text-right text-emerald-700 text-sm font-medium">{e.debit > 0 ? fmtPKR(e.debit) : '—'}</TableCell>
                        <TableCell className="text-right text-violet-700 text-sm font-medium">{e.credit > 0 ? fmtPKR(e.credit) : '—'}</TableCell>
                        <TableCell className="text-right font-semibold text-slate-800">{fmtPKR(e.balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          {/* ---------------- PURCHASES TAB ---------------- */}
          <TabsContent value="purchases" className="space-y-3 mt-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Stock purchase invoices — book hote hi warehouse stock barh jata hai</p>
              <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => openPurchaseEntry(company.id)}><Plus className="h-3.5 w-3.5 mr-1" /> New Purchase</Button>
            </div>
            <div className="rounded-lg border bg-white overflow-hidden">
              <div className="max-h-[400px] overflow-auto">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow className="bg-slate-50/70">
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Supplier Bill</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!invoices && <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-slate-400">Loading...</TableCell></TableRow>}
                    {invoices && invoices.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-slate-400">Koi purchase invoice nahi</TableCell></TableRow>
                    )}
                    {invoices?.map((inv) => (
                      <TableRow key={inv.id} className="cursor-pointer hover:bg-emerald-50/30" onClick={() => setViewInvoice(inv)}>
                        <TableCell className="font-semibold text-emerald-700 text-xs">{inv.invoiceNo}</TableCell>
                        <TableCell className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(inv.date)}</TableCell>
                        <TableCell className="text-xs text-slate-500">{inv.supplierInvoiceNo ?? '—'}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{fmtPKR(inv.total)}</TableCell>
                        <TableCell className="text-right text-sm text-emerald-700">{inv.paidAmount > 0 ? fmtPKR(inv.paidAmount) : '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[9px] ${inv.status === 'PAID' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : inv.status === 'PARTIAL' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                            {inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <button
                            className="h-7 w-7 rounded-md flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Invoice reverse karein (stock + ledger wapas)"
                            onClick={(e) => { e.stopPropagation(); void reverseInvoice(inv) }}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* payment / adjustment dialog */}
        {entryMode && (
          <LedgerEntryDialog
            company={company}
            mode={entryMode}
            invoices={(invoices ?? []).filter((i) => i.status !== 'PAID')}
            onClose={() => setEntryMode(null)}
            onSaved={() => { setEntryMode(null); bump() }}
          />
        )}

        {/* invoice items viewer */}
        {viewInvoice && <InvoiceItemsDialog invoice={viewInvoice} onClose={() => setViewInvoice(null)} />}

        {/* statement print preview */}
        {printOpen && ledger && <CompanyStatementDoc data={ledger} onClose={() => setPrintOpen(false)} />}
      </DialogContent>
    </Dialog>
  )

  async function reverseInvoice(inv: PurchaseInvoiceDTO) {
    if (!window.confirm(`${inv.invoiceNo} reverse karein?\n\nLedger entries delete + stock wapas kam ho jayega. Ye undo nahi hoga.`)) return
    try {
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      await api(`/api/purchase-invoices/${inv.id}?userId=${user?.id ?? ''}`, { method: 'DELETE' })
      toast({ title: 'Invoice reversed', description: `${inv.invoiceNo} — stock aur ledger dono reverse ho gaye` })
      bump()
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Reverse failed', variant: 'destructive' })
    }
  }
}

// ==================== INVOICE ITEMS VIEWER ====================

function InvoiceItemsDialog({ invoice, onClose }: { invoice: PurchaseInvoiceDTO; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {invoice.invoiceNo}
            <Badge variant="outline" className={`text-[9px] ${invoice.status === 'PAID' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : invoice.status === 'PARTIAL' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{invoice.status}</Badge>
          </DialogTitle>
          <DialogDescription>
            {invoice.companyName} • {fmtDate(invoice.date)} {invoice.supplierInvoiceNo ? `• Supplier Bill ${invoice.supplierInvoiceNo}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/70">
                <TableHead>Product</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead className="text-right">Cartons</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Pass On</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">TO</TableHead>
                <TableHead className="text-right">Adv 236H</TableHead>
                <TableHead className="text-right">Inclusive</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="text-xs"><span className="font-medium">{it.productName}</span><br /><span className="text-slate-400">{it.sku} • {fmtNum(it.units)} units</span></TableCell>
                  <TableCell className="text-xs">{it.batchNo}{it.expDate && <><br /><span className="text-slate-400">exp {fmtDate(it.expDate)}</span></>}</TableCell>
                  <TableCell className="text-right text-sm">{fmtNum(it.cartons)}</TableCell>
                  <TableCell className="text-right text-sm">{fmtNum(it.purchasePrice)}</TableCell>
                  <TableCell className="text-right text-sm">{fmtNum(it.lineTotal)}</TableCell>
                  <TableCell className="text-right text-xs">{it.discountAmt > 0 ? <span className="text-emerald-700 font-medium">−{fmtNum(it.discountAmt)}<br /><span className="text-[11px]">{it.discountPct}%</span></span> : <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="text-right text-xs">{fmtNum(it.netAmount)}</TableCell>
                  <TableCell className="text-right text-xs">{it.totalTax > 0 ? <span className="text-sky-700 font-medium">+{fmtNum(it.totalTax)}<br /><span className="text-[11px]">@{it.gstRate}{it.furtherTaxPct > 0 ? `+${it.furtherTaxPct}` : ''}%</span></span> : <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="text-right text-xs">{it.tradeOfferAmt > 0 ? <span className="text-amber-700 font-medium">−{fmtNum(it.tradeOfferAmt)}</span> : <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="text-right text-xs">{it.advanceTax > 0 ? <span className="text-slate-600 font-medium">+{fmtNum(it.advanceTax)}</span> : <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="text-right text-sm font-semibold">{fmtNum(it.amountInclusive || it.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {/* Task 44: company invoice jaisi summary — Gross − Discount + GST + Adv 236H = Net */}
        <div className="ml-auto w-full sm:w-80 space-y-1 rounded-lg border bg-slate-50/70 p-3 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Gross Amount</span><b className="text-slate-700">{fmtPKR(invoice.subtotal)}</b></div>
          {invoice.discount > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Total Discount{invoice.tradeOfferTotal > 0 ? ` (TO ${fmtNum(invoice.tradeOfferTotal)} • Rest ${fmtNum(Math.max(0, invoice.discount - invoice.tradeOfferTotal))})` : ''}</span>
              <b className="text-emerald-700">−{fmtPKR(invoice.discount)}</b>
            </div>
          )}
          {invoice.taxTotal > 0 && <div className="flex justify-between"><span className="text-slate-500">GST</span><b className="text-sky-700">+{fmtPKR(invoice.taxTotal)}</b></div>}
          {invoice.advanceTaxTotal > 0 && <div className="flex justify-between"><span className="text-slate-500">Advance Tax 236H ({invoice.advanceTaxPct}%)</span><b className="text-slate-700">+{fmtPKR(invoice.advanceTaxTotal)}</b></div>}
          <div className="flex justify-between border-t pt-1"><span className="text-slate-600 font-semibold">Net Invoice Amount</span><b className="text-red-600 text-base">{fmtPKR(invoice.total)}</b></div>
          <div className="flex justify-between"><span className="text-slate-500">Paid</span><b className="text-emerald-700">{fmtPKR(invoice.paidAmount)}</b></div>
        </div>
        {invoice.notes && <p className="text-xs text-slate-400 border-l-2 border-slate-200 pl-2">{invoice.notes}</p>}
      </DialogContent>
    </Dialog>
  )
}

// ==================== LEDGER ENTRY (PAYMENT / ADJUSTMENT) ====================

function LedgerEntryDialog({ company, mode, invoices, onClose, onSaved }: {
  company: CompanyFullDTO
  mode: 'PAYMENT' | 'ADJUSTMENT'
  invoices: PurchaseInvoiceDTO[]
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState('DEBIT_NOTE')
  const [direction, setDirection] = useState<'DEBIT' | 'CREDIT'>('DEBIT')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [invoiceId, setInvoiceId] = useState('')
  const [description, setDescription] = useState('')
  const [refNo, setRefNo] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedInvoice = invoices.find((i) => i.id === invoiceId)

  async function save() {
    const amt = Number(amount)
    if (!(amt > 0)) { toast({ title: 'Amount enter karein', variant: 'destructive' }); return }
    let postType: string = mode
    if (mode === 'ADJUSTMENT') {
      if (type === 'ADJUSTMENT' && direction !== 'DEBIT' && direction !== 'CREDIT') { toast({ title: 'Direction select karein', variant: 'destructive' }); return }
      postType = type as string
    }
    const desc = description.trim() || (mode === 'PAYMENT' && selectedInvoice ? `Payment against ${selectedInvoice.invoiceNo}` : '')
    if (!desc) { toast({ title: 'Description enter karein', variant: 'destructive' }); return }
    setSaving(true)
    try {
      await api(`/api/companies/${company.id}/ledger`, {
        method: 'POST',
        body: JSON.stringify({
          userId: (JSON.parse(localStorage.getItem('dms_session') ?? 'null'))?.id,
          type: postType,
          amount: amt,
          direction: mode === 'ADJUSTMENT' && type === 'ADJUSTMENT' ? direction : undefined,
          date,
          description: desc,
          refNo,
          invoiceId: mode === 'PAYMENT' ? invoiceId || null : null,
        }),
      })
      toast({
        title: mode === 'PAYMENT' ? 'Payment recorded' : 'Adjustment recorded',
        description: `${company.name} • ${fmtPKR(amt)} — ledger update ho gaya`,
      })
      onSaved()
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Entry failed', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'PAYMENT' ? `Payment to ${company.name}` : `Adjustment — ${company.name}`}</DialogTitle>
          <DialogDescription>
            {mode === 'PAYMENT'
              ? 'Company ko paisa dene par payable kam hoti hai (ledger debit)'
              : 'Debit note (stock wapsi / claim) payable kam karta hai — credit note (extra charge) barhata hai'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {mode === 'ADJUSTMENT' && (
            <div className="space-y-1">
              <Label>Entry Type</Label>
              <Select value={type} onValueChange={(v) => { setType(v); setDescription('') }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEBIT_NOTE">Debit Note — stock wapsi / claim (payable kam)</SelectItem>
                  <SelectItem value="CREDIT_NOTE">Credit Note — company ka extra charge (payable barh)</SelectItem>
                  <SelectItem value="ADJUSTMENT">General Adjustment — direction khud choose karein</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === 'ADJUSTMENT' && type === 'ADJUSTMENT' && (
            <div className="space-y-1">
              <Label>Direction</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as 'DEBIT' | 'CREDIT')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEBIT">Payable kam karein (hum ne company se liya wapas)</SelectItem>
                  <SelectItem value="CREDIT">Payable barhayein (company ko aur dena hai)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === 'PAYMENT' && invoices.length > 0 && (
            <div className="space-y-1">
              <Label>Apply to Invoice (optional)</Label>
              <Select value={invoiceId} onValueChange={(v) => { setInvoiceId(v === 'none' ? '' : v); if (v !== 'none') { const inv = invoices.find((i) => i.id === v); if (inv) setDescription((d) => d || `Payment against ${inv.invoiceNo}`) } }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="On-account / kisi invoice par" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">On-account (koi specific invoice nahi)</SelectItem>
                  {invoices.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.invoiceNo} — baqi {fmtPKR(i.total - i.paidAmount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Amount *</Label><Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          {mode === 'PAYMENT' && selectedInvoice && (
            <p className="text-[11px] text-slate-500 bg-slate-50 border rounded-md px-3 py-2">
              {selectedInvoice.invoiceNo}: total {fmtPKR(selectedInvoice.total)}, paid {fmtPKR(selectedInvoice.paidAmount)}, baqi <b>{fmtPKR(selectedInvoice.total - selectedInvoice.paidAmount)}</b>
            </p>
          )}
          <div className="space-y-1"><Label>Description *</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={mode === 'PAYMENT' ? 'Cash / cheque / bank transfer...' : 'Wapsi / claim ki tafseel...'} /></div>
          <div className="space-y-1"><Label>Ref # (cheque / note no)</Label><Input value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="Optional" /></div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={save} disabled={saving}>{saving ? 'Saving...' : mode === 'PAYMENT' ? 'Record Payment' : 'Record Adjustment'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
