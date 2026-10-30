'use client'

/**
 * Task 49 — PURCHASE INVOICE ENTRY: FULL PAGE (dialog/panel ki jagah)
 *
 * User ka masla: purana form ek chhota dialog tha — bahar ghalati se click
 * hota to poora form band + saara data zaya (30 min ka nuqsaan hua tha).
 *
 * Is page ki 4 protection layers:
 *   1) POORA PAGE — kahin overlay nahi, random click se kuch band nahi hota
 *   2) DRAFT AUTO-SAVE — har keystroke par localStorage mein save; page wapas
 *      khulte hi adhoora draft restore (toast ke saath)
 *   3) BACK/CANCEL confirm — agar data mojood ho to pooch kar jata hai
 *   4) beforeunload + side-nav guard (app-shell) — refresh/nav par bhi confirm
 *
 * Calc chain Task 44 wahi hai: Gross → Pass On % → Net → GST + Further →
 * Trade Offer → Adv 236H → Inclusive (data-driven, koi hardcode nahi).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, fmtPKR, fmtNum } from '@/lib/dms-api'
import { computePurchaseLineTaxes } from '@/lib/dms-order-calc'
import type { CompanyFullDTO, ProductDTO } from '@/lib/dms-types'
import { ProductCombobox } from '@/components/dms/product-combobox'
import { useDMS } from '@/lib/dms-store'
import { CompanyLogo } from './companies-view'
import { toast } from '@/hooks/use-toast'
import { ArrowLeft, Plus, X, ShieldCheck, RotateCcw, Loader2 } from 'lucide-react'

const todayISO = () => new Date().toISOString().slice(0, 10)
const plusYearISO = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10) }

// Task 44 draft item — poora tax chain inputs (Disc % Pass On, TO Rs, GST %, Further %)
interface DraftItem { key: number; productId: string; cartons: string; price: string; disc: string; to: string; gst: string; fur: string; batchNo: string; expDate: string }

interface PurchaseDraft {
  companyId: string
  date: string
  supplierInvoiceNo: string
  discount: string
  discMode: 'pct' | 'rs'
  advTaxPct: string
  paidNow: string
  notes: string
  items: DraftItem[]
  savedAt: string
}

let draftKeySeq = 1
function newDraftItem(p?: ProductDTO): DraftItem {
  return {
    key: draftKeySeq++,
    productId: p?.id ?? '',
    cartons: '',
    price: p?.purchasePrice ? String(p.purchasePrice) : '',
    disc: '',
    to: '',
    gst: p ? (p.gstEnabled ? String(p.gstRate) : '0') : '',
    fur: '',
    batchNo: `B-${Date.now().toString(36).toUpperCase().slice(-5)}${draftKeySeq}`,
    expDate: plusYearISO(),
  }
}

/** Kya draft mein ASLI data hai? (khali rows / default fields ginne ke qabil nahi) */
function draftHasData(d: PurchaseDraft): boolean {
  if (d.supplierInvoiceNo?.trim() || d.notes?.trim()) return true
  if (Number(d.discount) > 0 || Number(d.paidNow) > 0) return true
  if (d.date && d.date !== todayISO()) return true
  if (d.discMode && d.discMode !== 'pct') return true
  if (d.advTaxPct && d.advTaxPct !== '0.5') return true
  return (d.items ?? []).some((it) =>
    it.productId !== '' || Number(it.cartons) > 0 || Number(it.price) > 0 ||
    Number(it.disc) > 0 || Number(it.to) > 0 || Number(it.fur) > 0,
  )
}

export function PurchaseEntryView() {
  const user = useDMS((s) => s.user)
  const router = useRouter()
  const purchaseCompanyId = useDMS((s) => s.purchaseCompanyId)
  const setPurchaseCompanyId = useDMS((s) => s.setPurchaseCompanyId)
  const setPurchaseDraftDirty = useDMS((s) => s.setPurchaseDraftDirty)

  const draftKey = `dms_purchase_entry_draft_${user?.id ?? 'anon'}`
  const hydrated = useRef(false)

  const [companies, setCompanies] = useState<CompanyFullDTO[]>([])
  const [products, setProducts] = useState<ProductDTO[]>([])
  const [loading, setLoading] = useState(true)

  const [companyId, setCompanyId] = useState(purchaseCompanyId ?? '')
  const [date, setDate] = useState(todayISO())
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [discount, setDiscount] = useState('')
  const [discMode, setDiscMode] = useState<'pct' | 'rs'>('pct')
  const [advTaxPct, setAdvTaxPct] = useState('0.5')
  const [paidNow, setPaidNow] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DraftItem[]>(() => purchaseCompanyId ? [newDraftItem()] : [])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [restoredAt, setRestoredAt] = useState<string | null>(null)

  // ---------- companies + products load ----------
  useEffect(() => {
    async function load() {
      try {
        const uid = (JSON.parse(localStorage.getItem('dms_session') ?? 'null'))?.id
        const [c, p] = await Promise.all([
          api<{ companies: CompanyFullDTO[] }>('/api/companies?userId=' + (uid ?? '')),
          api<{ products: ProductDTO[] }>('/api/products?userId=' + (uid ?? '')),
        ])
        setCompanies(c.companies ?? [])
        setProducts(p.products ?? [])
      } catch (e) {
        toast({ title: 'Error', description: e instanceof Error ? e.message : 'Data load failed', variant: 'destructive' })
      } finally { setLoading(false) }
    }
    load()
  }, [])

  // ---------- DRAFT RESTORE (mount par ek dafa) ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const d = JSON.parse(raw) as PurchaseDraft
        if (draftHasData(d)) {
          setCompanyId(d.companyId ?? '')
          setDate(d.date || todayISO())
          setSupplierInvoiceNo(d.supplierInvoiceNo ?? '')
          setDiscount(d.discount ?? '')
          setDiscMode(d.discMode === 'rs' ? 'rs' : 'pct')
          setAdvTaxPct(d.advTaxPct || '0.5')
          setPaidNow(d.paidNow ?? '')
          setNotes(d.notes ?? '')
          setItems((d.items ?? []).length > 0 ? d.items : [newDraftItem()])
          setRestoredAt(d.savedAt ?? null)
          const filled = (d.items ?? []).filter((it) => it.productId && Number(it.cartons) > 0).length
          toast({
            title: 'Adhoora draft wapas load ho gaya ✓',
            description: `Aap ka kaam mehfooz tha${filled > 0 ? ` — ${filled} items ready` : ''}. Ghabrao nahi, jahan chhora tha wahin se jari rakhein.`,
          })
        }
      }
    } catch { /* corrupt draft — fresh start */ }
    hydrated.current = true
  }, [draftKey])

  // ---------- DRAFT AUTO-SAVE (har change par) ----------
  const draftPayload = useMemo(() => ({
    companyId, date, supplierInvoiceNo, discount, discMode, advTaxPct, paidNow, notes, items,
  }), [companyId, date, supplierInvoiceNo, discount, discMode, advTaxPct, paidNow, notes, items])
  const dirty = useMemo(() => draftHasData({ ...draftPayload, savedAt: '' }), [draftPayload])

  useEffect(() => {
    if (!hydrated.current) return
    setPurchaseDraftDirty(dirty)
    try {
      if (dirty) {
        const draft: PurchaseDraft = { ...draftPayload, savedAt: new Date().toISOString() }
        localStorage.setItem(draftKey, JSON.stringify(draft))
        setLastSaved(new Date())
      } else {
        localStorage.removeItem(draftKey)
        setLastSaved(null)
      }
    } catch { /* storage full etc — form phir bhi chalta rahega */ }
  }, [draftPayload, dirty, draftKey, setPurchaseDraftDirty])

  // ---------- PROTECTION: refresh / tab close par warn ----------
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const companyProducts = useMemo(
    () => products.filter((p) => p.company?.id === companyId),
    [products, companyId],
  )
  const company = companies.find((c) => c.id === companyId)
  // Task 108: is purchase ka tax mode = company ka tax mode (server bhi YEHIN rule use karta hai)
  const companyTaxMode = company?.taxMode === 'INVOICE_DISCOUNT' ? 'INVOICE_DISCOUNT' : 'CLAIM'
  const modeA = companyTaxMode === 'INVOICE_DISCOUNT'

  // ---------- Task 44 calc chain — Task 108 se SHARED pure helper (preview == booked bill) ----------
  const itemCalc = useMemo(() => items.map((it) => {
    const gross = Math.round((Number(it.cartons) || 0) * (Number(it.price) || 0) * 100) / 100
    const pct = Math.min(100, Math.max(0, Number(it.disc) || 0))
    const discRs = Math.round(gross * pct) / 100
    const t = computePurchaseLineTaxes({
      gross,
      discAmt: discRs,
      gstRate: Number(it.gst) || 0,
      furtherTaxPct: Number(it.fur) || 0,
      tradeOfferRequest: Number(it.to) || 0,
      advanceTaxPct: Number(advTaxPct) || 0,
      taxMode: companyTaxMode,
    })
    return { key: it.key, gross, pct, discRs, net: t.netAmount, gstRate: Math.min(100, Math.max(0, Number(it.gst) || 0)), salesTax: t.salesTax, furPct: t.furtherTaxPct, furTax: t.furtherTax, totalTax: t.totalTax, toRs: t.tradeOfferAmt, advTax: t.advanceTax, inclusive: t.amountInclusive }
  }), [items, advTaxPct, companyTaxMode])
  const calcMap = useMemo(() => new Map(itemCalc.map((c) => [c.key, c])), [itemCalc])
  const subtotal = itemCalc.reduce((s, c) => s + c.gross, 0)
  const itemDiscTotal = Math.round(itemCalc.reduce((s, c) => s + c.discRs, 0) * 100) / 100
  const toTotal = Math.round(itemCalc.reduce((s, c) => s + c.toRs, 0) * 100) / 100
  const taxTotal = Math.round(itemCalc.reduce((s, c) => s + c.totalTax, 0) * 100) / 100
  const advTaxTotal = Math.round(itemCalc.reduce((s, c) => s + c.advTax, 0) * 100) / 100
  const afterItemDisc = Math.round((subtotal - itemDiscTotal) * 100) / 100
  const billPct = discMode === 'pct' ? Math.min(100, Math.max(0, Number(discount) || 0)) : 0
  const billDiscRs = discMode === 'pct' ? Math.round(afterItemDisc * billPct) / 100 : (Number(discount) || 0)
  const totalDiscount = Math.round((itemDiscTotal + toTotal + billDiscRs) * 100) / 100
  const total = Math.max(0, Math.round((subtotal - totalDiscount + taxTotal + advTaxTotal) * 100) / 100)
  const remaining = total - (Number(paidNow) || 0)

  function setItem(key: number, patch: Partial<DraftItem>) {
    setItems((arr) => arr.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }
  function onProductChange(key: number, productId: string) {
    const p = companyProducts.find((x) => x.id === productId)
    setItem(key, {
      productId,
      price: p?.purchasePrice ? String(p.purchasePrice) : '',
      disc: '',
      to: '',
      fur: '',
      gst: p ? (p.gstEnabled ? String(p.gstRate) : '0') : '',
      batchNo: `B-${Date.now().toString(36).toUpperCase().slice(-5)}${key % 1000}`,
      expDate: plusYearISO(),
    })
  }

  function goBack() {
    if (dirty) {
      const ok = window.confirm('Form mein adhoora data hai — draft auto-save ho chuka hai, wapas aaoge to poora milega.\n\nPhir bhi wapas chalein?')
      if (!ok) return
    }
    setPurchaseCompanyId(null)
    router.push('/companies')
  }

  function startFresh() {
    if (!window.confirm('Current draft clear kar ke bilkul naya shuru karein?')) return
    setCompanyId(purchaseCompanyId ?? '')
    setDate(todayISO())
    setSupplierInvoiceNo(''); setDiscount(''); setDiscMode('pct')
    setAdvTaxPct('0.5'); setPaidNow(''); setNotes('')
    setItems(purchaseCompanyId ? [newDraftItem()] : [])
    setRestoredAt(null)
    try { localStorage.removeItem(draftKey) } catch {}
    toast({ title: 'Naya draft shuru — purana clear ho gaya' })
  }

  async function save() {
    if (!companyId) { toast({ title: 'Company select karein', variant: 'destructive' }); return }
    const cleanItems = items.filter((it) => it.productId && Number(it.cartons) > 0)
    if (cleanItems.length === 0) { toast({ title: 'Kam az kam ek product + cartons add karein', variant: 'destructive' }); return }
    if (cleanItems.some((it) => !(Number(it.price) > 0))) { toast({ title: 'Har item ka purchase price enter karein', variant: 'destructive' }); return }
    if (billDiscRs > afterItemDisc) { toast({ title: 'Bill discount item discounts ke baad wali value se zyada nahi ho sakta', variant: 'destructive' }); return }
    if ((Number(paidNow) || 0) > total) { toast({ title: 'Paid amount total se zyada nahi ho sakta', variant: 'destructive' }); return }
    setSaving(true)
    try {
      const r = await api<{ invoice: { invoiceNo: string; total: number; taxTotal: number; advanceTaxTotal: number }; warehouseName?: string }>('/api/purchase-invoices', {
        method: 'POST',
        body: JSON.stringify({
          userId: (JSON.parse(localStorage.getItem('dms_session') ?? 'null'))?.id,
          companyId,
          date,
          supplierInvoiceNo,
          discount: discMode === 'pct' ? 0 : Number(discount) || 0,
          discountPct: discMode === 'pct' ? Number(discount) || 0 : 0,
          advanceTaxPct: Number(advTaxPct) || 0,
          paidNow: Number(paidNow) || 0,
          notes,
          items: cleanItems.map((it) => ({
            productId: it.productId,
            cartons: Number(it.cartons),
            purchasePrice: Number(it.price),
            discountPct: Number(it.disc) || 0,
            gstRate: it.gst === '' ? undefined : Number(it.gst),
            furtherTaxPct: Number(it.fur) || 0,
            tradeOfferAmt: Number(it.to) || 0,
            batchNo: it.batchNo,
            expDate: it.expDate || null,
          })),
        }),
      })
      // success: draft clear + companies page par wapas (fresh data load hoga)
      hydrated.current = false
      try { localStorage.removeItem(draftKey) } catch {}
      setPurchaseDraftDirty(false)
      setPurchaseCompanyId(null)
      toast({
        title: `${r.invoice.invoiceNo} booked — Stock IN`,
        description: `${company?.name ?? 'Company'} • Net Invoice ${fmtPKR(r.invoice.total)}${r.invoice.taxTotal > 0 ? ` • GST ${fmtPKR(r.invoice.taxTotal)}` : ''}${r.invoice.advanceTaxTotal > 0 ? ` • Adv Tax ${fmtPKR(r.invoice.advanceTaxTotal)}` : ''} • Stock "${r.warehouseName ?? 'warehouse'}" mein add ho gaya`,
      })
      router.push('/companies')
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Purchase failed', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="h-full flex flex-col">
      {/* ============ PAGE HEADER (full page — dialog nahi) ============ */}
      <div className="shrink-0 flex flex-wrap items-center gap-3 pb-3">
        <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Wapas
        </Button>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-900 leading-tight">New Purchase Invoice (Stock In)</h2>
          <p className="text-sm text-slate-500 truncate">Ye poora page hai — ghalati se kahin click hone se form band nahi hoga</p>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {dirty && lastSaved && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
              <ShieldCheck className="h-3 w-3" /> Draft auto-save {lastSaved.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          {dirty && (
            <Button variant="ghost" size="sm" className="h-8 text-slate-400 hover:text-red-500" onClick={startFresh} title="Draft clear kar ke naya shuru">
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Fresh Start
            </Button>
          )}
        </div>
      </div>

      {/* restore banner */}
      {restoredAt && dirty && (
        <div className="shrink-0 mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600" />
          <span>Adhoora draft restore ho gaya (aakhri auto-save: {new Date(restoredAt).toLocaleString('en-PK')}) — aap ka data mehfooz tha, kaam jari rakhein.</span>
        </div>
      )}

      {/* ============ SCROLLABLE CONTENT ============ */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 pb-4">
        {/* header fields */}
        <Card className="border-slate-200"><CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>Company *</Label>
              <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setItems([newDraftItem()]) }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Company select karein" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2"><CompanyLogo company={c} size="sm" /> {c.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>Supplier Bill #</Label><Input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} placeholder="Company ka bill no" /></div>
          </div>
          {loading && <p className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Companies aur products load ho rahe hain...</p>}
        </CardContent></Card>

        {/* items */}
        <Card className="border-slate-200"><CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-800">Items</p>
              {companyId && <p className="text-xs text-slate-400">{companyProducts.length} products available — {company?.name ?? ''}</p>}
            </div>
            <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700" disabled={!companyId || companyProducts.length === 0} onClick={() => setItems((arr) => [...arr, newDraftItem()])}>
              <Plus className="h-4 w-4 mr-1" /> Add Item
            </Button>
          </div>
          {!companyId && <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">Pehle company select karein — phir usi ke products dikhenge</p>}
          {companyId && companyProducts.length === 0 && <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">Is company ka koi product catalog me nahi — pehle Products page se add karein</p>}
          {items.length === 0 && companyId && companyProducts.length > 0 && (
            <p className="text-xs text-slate-400 text-center py-3 border border-dashed rounded-md">Add Item se product add karein</p>
          )}
          {items.map((it, idx) => (
            <div key={it.key} className="relative grid grid-cols-12 gap-2 items-end rounded-lg border bg-slate-50/50 p-3 pr-9">
              <div className="col-span-12 sm:col-span-4 space-y-0.5">
                <Label className="text-[10px] text-slate-400">Product {idx + 1}</Label>
                {/* Task 81: SEARCHABLE product picker — naam/SKU likh kar dhoond ke add karo */}
                <ProductCombobox
                  products={companyProducts.map((p) => ({ id: p.id, name: p.name, sku: p.sku, brand: p.brand }))}
                  value={it.productId}
                  onSelect={(v) => onProductChange(it.key, v)}
                  placeholder="Product"
                  searchPlaceholder="Product ka naam ya SKU likhein..."
                  triggerClassName="h-9 w-full bg-white"
                />
              </div>
              <div className="col-span-4 sm:col-span-2 space-y-0.5">
                <Label className="text-[10px] text-slate-400">Cartons *</Label>
                <Input type="number" min="1" className="h-9 bg-white" value={it.cartons} onChange={(e) => setItem(it.key, { cartons: e.target.value })} placeholder="0" />
              </div>
              <div className="col-span-4 sm:col-span-2 space-y-0.5">
                <Label className="text-[10px] text-slate-400">Rs/Carton *</Label>
                <Input type="number" min="1" className="h-9 bg-white" value={it.price} onChange={(e) => setItem(it.key, { price: e.target.value })} placeholder="0" />
              </div>
              <div className="col-span-4 sm:col-span-2 space-y-0.5">
                <Label className="text-[10px] text-emerald-600">Disc % (Pass On)</Label>
                <Input type="number" min="0" max="100" step="0.01" className="h-9 bg-white" value={it.disc} onChange={(e) => setItem(it.key, { disc: e.target.value })} placeholder="0" />
              </div>
              <div className="col-span-4 sm:col-span-2 space-y-0.5">
                <Label className="text-[10px] text-amber-600">Trade Offer Rs</Label>
                <Input type="number" min="0" className="h-9 bg-white" value={it.to} onChange={(e) => setItem(it.key, { to: e.target.value })} placeholder="0" />
              </div>
              <button className="absolute top-1.5 right-1.5 h-6 w-6 rounded-md flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50" onClick={() => setItems((arr) => arr.filter((x) => x.key !== it.key))} title="Item remove">
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="col-span-6 sm:col-span-3 space-y-0.5">
                <Label className="text-[10px] text-slate-400">Batch #</Label>
                <Input className="h-9 bg-white" value={it.batchNo} onChange={(e) => setItem(it.key, { batchNo: e.target.value })} />
              </div>
              <div className="col-span-6 sm:col-span-2 space-y-0.5">
                <Label className="text-[10px] text-slate-400">Expiry</Label>
                <Input type="date" className="h-9 bg-white" value={it.expDate} onChange={(e) => setItem(it.key, { expDate: e.target.value })} />
              </div>
              <div className="col-span-4 sm:col-span-2 space-y-0.5">
                <Label className="text-[10px] text-sky-600">GST %</Label>
                <Input type="number" min="0" max="100" step="0.01" className="h-9 bg-white" value={it.gst} onChange={(e) => setItem(it.key, { gst: e.target.value })} placeholder="18" />
              </div>
              <div className="col-span-4 sm:col-span-2 space-y-0.5">
                <Label className="text-[10px] text-sky-600">Further Tax %</Label>
                <Input type="number" min="0" max="100" step="0.01" className="h-9 bg-white" value={it.fur} onChange={(e) => setItem(it.key, { fur: e.target.value })} placeholder="0" />
              </div>
              <div className="col-span-12 sm:col-span-3 text-right text-[11px] text-slate-500 self-end pb-1 leading-relaxed">
                {(() => {
                  const c = calcMap.get(it.key)
                  const p = companyProducts.find((x) => x.id === it.productId)
                  if (!c) return null
                  return (
                    <>
                      Gross Rs {fmtNum(c.gross)}
                      {c.pct > 0 && <> − Rs {fmtNum(c.discRs)} ({c.pct}%)</>}
                      = Net <span className="font-semibold text-slate-700">Rs {fmtNum(c.net)}</span>
                      <br />
                      {modeA && c.toRs > 0 && <span className="text-amber-700">TO − Rs {fmtNum(c.toRs)} • </span>}
                      {c.gstRate > 0 && <span>GST@{c.gstRate}% Rs {fmtNum(c.salesTax)} • </span>}
                      {c.furPct > 0 && <span>Fur@{c.furPct}% Rs {fmtNum(c.furTax)} • </span>}
                      {!modeA && c.toRs > 0 && <span className="text-amber-700">TO − Rs {fmtNum(c.toRs)} • </span>}
                      {c.advTax > 0 && <span>Adv 236H Rs {fmtNum(c.advTax)} • </span>}
                      <span className="font-semibold text-red-600">Incl Rs {fmtNum(c.inclusive)}</span>
                      {p ? <span className="text-slate-400"> • {fmtNum((Number(it.cartons) || 0) * p.unitsPerCarton)} units</span> : null}
                    </>
                  )
                })()}
              </div>
            </div>
          ))}
        </CardContent></Card>

        {/* totals — Task 44 formula */}
        <Card className="border-slate-200"><CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border bg-slate-50/70 p-3">
            <div><p className="text-[10px] text-slate-400 uppercase font-semibold">Gross Amount</p><p className="text-sm font-bold">{fmtPKR(subtotal)}</p></div>
            {/* Task 50: Net Amount = upar items ke Net ka EXACT total — company invoice jaisa hi neeche Net hota hai */}
            <div className="rounded-md border border-sky-200 bg-sky-50/80 px-2 py-1.5 -my-0.5">
              <p className="text-[10px] text-sky-700 uppercase font-semibold">Net Amount</p>
              <p className="text-sm font-bold text-slate-800">{fmtPKR(afterItemDisc)}</p>
              <p className="text-[10px] text-slate-500 leading-tight">Upar items ke Net ka yahi total (Gross − Pass On)</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Total Discount</p>
              <p className={`text-sm font-bold ${totalDiscount > 0 ? 'text-emerald-700' : 'text-slate-300'}`}>{totalDiscount > 0 ? `− ${fmtPKR(totalDiscount)}` : '—'}</p>
              {totalDiscount > 0 && <p className="text-[10px] text-slate-400">Item {fmtNum(itemDiscTotal)} • TO {fmtNum(toTotal)} • Bill {fmtNum(billDiscRs)}</p>}
            </div>
            <div><p className="text-[10px] text-slate-400 uppercase font-semibold">Sales Tax (GST)</p><p className={`text-sm font-bold ${taxTotal > 0 ? 'text-slate-700' : 'text-slate-300'}`}>{taxTotal > 0 ? `+ ${fmtPKR(taxTotal)}` : '—'}</p></div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Adv Tax 236H %</p>
              <Input type="number" min="0" max="100" step="0.01" className="h-8 bg-white" value={advTaxPct} onChange={(e) => setAdvTaxPct(e.target.value)} placeholder="0.5" />
              {advTaxTotal > 0 && <p className="text-[10px] text-slate-500 font-semibold">= + Rs {fmtNum(advTaxTotal)}</p>}
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-1">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Bill Discount</p>
                <div className="flex gap-0.5">
                  <button type="button" onClick={() => setDiscMode('pct')} className={`h-5 px-1.5 rounded text-[10px] font-bold leading-none ${discMode === 'pct' ? 'bg-emerald-600 text-white' : 'bg-white border text-slate-400'}`}>%</button>
                  <button type="button" onClick={() => setDiscMode('rs')} className={`h-5 px-1.5 rounded text-[10px] font-bold leading-none ${discMode === 'rs' ? 'bg-emerald-600 text-white' : 'bg-white border text-slate-400'}`}>Rs</button>
                </div>
              </div>
              <Input type="number" min="0" max={discMode === 'pct' ? 100 : undefined} step="0.01" className="h-8 bg-white" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder={discMode === 'pct' ? 'e.g. 5' : 'Rs'} />
              {discMode === 'pct' && billPct > 0 && <p className="text-[10px] text-emerald-700 font-semibold">= − Rs {fmtNum(billDiscRs)}</p>}
            </div>
            <div><p className="text-[10px] text-red-400 uppercase font-semibold">Net Invoice Amount</p><p className="text-base font-bold text-red-600">{fmtPKR(total)}</p></div>
            <div className="space-y-0.5"><p className="text-[10px] text-slate-400 uppercase font-semibold">Paid Now (advance)</p><Input type="number" min="0" className="h-8 bg-white" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} placeholder="0" /></div>
            <div><p className="text-[10px] text-slate-400 uppercase font-semibold">Remaining Payable</p><p className="text-sm font-bold text-slate-700">{fmtPKR(Math.max(0, remaining))}</p></div>
            <p className="col-span-2 sm:col-span-4 text-[11px] text-slate-500">
              {modeA ? (
                <><span className="font-bold text-amber-700">Tax Mode: Invoice Discount (Noms style)</span> — <b>Gross − Pass On = Net</b> → <b>− Trade Offer</b> → GST (net−TO par) + Advance Tax 236H = <b>Net Invoice</b>. GST % har product ka apna (Products page par set hota hy, yahan override bhi kar sakte hain)</>
              ) : (
                <>Company invoice ka formula: <b>Gross − Pass On = Net Amount</b> (upar items ke Net column ka yahi total banta hy) → − Trade Offer − Bill Discount + GST + Advance Tax 236H = <b>Net Invoice</b> — yehi amount ledger payable banti hy. GST % har product ka apna (Products page par set hota hy, yahan override bhi kar sakte hain)</>
              )}
            </p>
          </div>
        </CardContent></Card>

        {/* notes */}
        <Card className="border-slate-200"><CardContent className="p-4 space-y-1">
          <Label>Notes</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Freight, scheme, remarks..." />
        </CardContent></Card>
      </div>

      {/* ============ STICKY ACTION BAR ============ */}
      <div className="shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>Gross <b className="text-slate-700">{fmtPKR(subtotal)}</b></span>
          <span>Net Amt <b className="text-slate-800">{fmtPKR(afterItemDisc)}</b></span>
          {totalDiscount > 0 && <span>Discount <b className="text-emerald-700">− {fmtPKR(totalDiscount)}</b></span>}
          {taxTotal > 0 && <span>GST <b className="text-slate-700">+ {fmtPKR(taxTotal)}</b></span>}
          {advTaxTotal > 0 && <span>Adv 236H <b className="text-slate-700">+ {fmtPKR(advTaxTotal)}</b></span>}
          <span className="text-sm">Net Invoice <b className="text-red-600 text-base">{fmtPKR(total)}</b></span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={goBack}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 min-w-44" onClick={save} disabled={saving}>{saving ? 'Booking...' : 'Book Purchase (Stock In)'}</Button>
        </div>
      </div>
    </div>
  )
}
