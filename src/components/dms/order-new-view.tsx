'use client'

/**
 * Task 31 — NEW ORDER BOOKING: FULL PAGE (dialog ki jagah)
 *
 * User ka masla: order booking ek CHOTI dialog window mein thi — 630+ lines ka
 * poora booking form (company cascade + lines + schemes + taxes) 672px ke dialog
 * mein bhich tha tha, ghalati se ESC/overlay click par saara data zaya.
 *
 * Purchase-entry (Task 49) wale template par — 4 protection layers:
 *   1) POORA PAGE — kahin overlay nahi, random click se kuch band nahi hota
 *   2) DRAFT AUTO-SAVE — har keystroke par localStorage mein save; wapas aane par
 *      adhoora draft restore (toast ke saath)
 *   3) BACK/CANCEL confirm — agar data mojood ho to pooch kar jata hai
 *   4) beforeunload + side-nav guard (app-shell 'orders-new' draft flag)
 *
 * Calc chain ka ikhtasar NAI — dialog ka EXACT client mirror yahan move hua hai
 * (Task 55/57/58 scheme stack, Task 45/52 merge + advance tax, Task 26/26-b/27
 * company cascade + tax mode hints) — booking preview == booked bill barkarar.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command'
import { useDMS } from '@/lib/dms-store'
import { api, fmtPKR } from '@/lib/dms-api'
import type { OutletDTO, ProductDTO, SchemeDTO, SalesmanPerfDTO, CompanyFullDTO } from '@/lib/dms-types'
import { UnitQtyInputs, splitPcs, fmtQty, packHint } from '@/components/dms/unit-qty'
import { ProductCombobox } from '@/components/dms/product-combobox'
import { splitManualByNet, retailGstAmt } from '@/lib/dms-order-calc'
import {
  ArrowLeft, Plus, XCircle, Loader2, Gift, Percent, ChevronsUpDown, Check,
  Store, ShieldCheck, RotateCcw, ShoppingCart,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface DraftLine {
  productId: string
  qtyPcs: number // base unit = PIECE (Ctn/Box/Pcs inputs se banta hai)
  tradeOffer: string // Task 45: per-SKU Trade Offer Rs (string input state, discount ke ILAWA)
}

type DiscType = 'NONE' | 'PERCENT' | 'FLAT'

/** Task 57: booking preview ki per-scheme breakdown entry — har promotion apni
 * chip/row par dikhti hai (combined "Eclair + Khushhali" nahi), jitni schemes
 * qualify karein utni entries auto. */
interface PreviewStackEntry {
  id: string
  name: string
  type: string
  /** money scheme (PERCENT/FLAT) ka is line par apna Rs contribution */
  amount: number
  /** BxGy scheme ke is line par apne free pcs */
  freeGiven: number
}

/** Task 31 draft — poora cascade + lines + discount (restore par cascade memos
 * khud derive hote hain; bookerTouched bhi mehfooz hota hai) */
interface OrderDraft {
  companyId: string
  bookerId: string
  bookerTouched: boolean
  outletId: string
  lines: DraftLine[]
  notes: string
  discType: DiscType
  discValue: string
  savedAt: string
}

/** Kya draft mein ASLI data hai? (sirf company/shop select hona ginne ke qabil nahi) */
function draftHasData(d: OrderDraft): boolean {
  if (d.notes?.trim()) return true
  if (d.discType && d.discType !== 'NONE' && d.discValue) return true
  return (d.lines ?? []).some((l) => l.productId && (l.qtyPcs > 0 || (l.tradeOffer ?? '') !== ''))
}

export function OrderNewView() {
  const user = useDMS((s) => s.user)
  // Task 67: Outlets page / Zero-Purchase report se "Order Book" — us shop ka id yahan aata hai
  const focusOutlet = useDMS((s) => s.focusOrderOutletId)
  const setFocusOrderOutlet = useDMS((s) => s.setFocusOrderOutlet)
  const setOrderDraftDirty = useDMS((s) => s.setOrderDraftDirty)
  const router = useRouter()

  const draftKey = `dms_order_new_draft_${user?.id ?? 'anon'}`
  const hydrated = useRef(false)
  const prefillDone = useRef<string | null>(null)

  const [outlets, setOutlets] = useState<OutletDTO[]>([])
  const [products, setProducts] = useState<ProductDTO[]>([])
  const [schemes, setSchemes] = useState<SchemeDTO[]>([])
  const [salesmen, setSalesmen] = useState<SalesmanPerfDTO[]>([])
  const [outletId, setOutletId] = useState('')
  const [bookerId, setBookerId] = useState('')
  const [bookerTouched, setBookerTouched] = useState(false) // manual booker choice auto-fill override karta hai
  const [lines, setLines] = useState<DraftLine[]>([])
  const [notes, setNotes] = useState('')
  const [discType, setDiscType] = useState<DiscType>('NONE')
  const [discValue, setDiscValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [taxRates, setTaxRates] = useState<{ filer: number; nonFiler: number } | null>(null)
  // Task 67: searchable shop picker + shop-focused prefill
  const [outletPickerOpen, setOutletPickerOpen] = useState(false)
  const [outletsLoaded, setOutletsLoaded] = useState(false)
  const [salesmenLoaded, setSalesmenLoaded] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  // Task 27: COMPANY-FIRST cascade — booking kis company ke products ka hai (isi se
  // bookers/shops/SKUs filter hote hain + company ka tax mode is bill par apply hota hai)
  const [companies, setCompanies] = useState<CompanyFullDTO[]>([])
  const [companyId, setCompanyId] = useState('')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [restoredAt, setRestoredAt] = useState<string | null>(null)

  // ---------- data load (page mount par ek dafa) ----------
  useEffect(() => {
    if (!user) return
    let alive = true
    Promise.allSettled([
      api<{ outlets: OutletDTO[] }>(`/api/outlets?userId=${user.id}`),
      api<{ products: ProductDTO[] }>(`/api/products?userId=${user.id}`),
      api<{ schemes: SchemeDTO[] }>(`/api/schemes?userId=${user.id}`),
      api<{ salesmen: SalesmanPerfDTO[] }>(`/api/field-force?userId=${user.id}`),
      api<{ companies: CompanyFullDTO[] }>(`/api/companies?userId=${user.id}`),
      api<{ settings: { filerTaxRate: number; nonFilerTaxRate: number } }>(`/api/settings?userId=${user.id}`),
    ]).then((rs) => {
      if (!alive) return
      const [o, p, sc, sm, cp, st] = rs
      if (o.status === 'fulfilled') { setOutlets(o.value.outlets); setOutletsLoaded(true) }
      if (p.status === 'fulfilled') setProducts(p.value.products)
      if (sc.status === 'fulfilled') setSchemes(sc.value.schemes.filter((s) => s.isActive))
      if (sm.status === 'fulfilled') { setSalesmen(sm.value.salesmen); setSalesmenLoaded(true) }
      if (cp.status === 'fulfilled') setCompanies(cp.value.companies)
      if (st.status === 'fulfilled') setTaxRates({ filer: st.value.settings.filerTaxRate, nonFiler: st.value.settings.nonFilerTaxRate })
      if (rs.some((r) => r.status === 'rejected')) {
        toast({ title: 'Kuch data load nahi hua', description: 'Booking form adhoora ho sakta hai — page refresh kar ke dobara koshish karein', variant: 'destructive' })
      }
      setDataLoading(false)
    })
    return () => { alive = false }
  }, [user])

  // ---------- DRAFT RESTORE (mount par ek dafa) ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const d = JSON.parse(raw) as OrderDraft
        if (draftHasData(d)) {
          setCompanyId(d.companyId ?? '')
          setBookerId(d.bookerId ?? '')
          setBookerTouched(!!d.bookerTouched)
          setOutletId(d.outletId ?? '')
          setLines(d.lines ?? [])
          setNotes(d.notes ?? '')
          setDiscType(d.discType ?? 'NONE')
          setDiscValue(d.discValue ?? '')
          setRestoredAt(d.savedAt ?? null)
          toast({
            title: 'Adhoora order draft wapas load ho gaya ✓',
            description: `Aap ka kaam mehfooz tha${(d.lines ?? []).length > 0 ? ` — ${(d.lines ?? []).length} lines ready` : ''}. Jahan chhora tha wahin se jari rakhein.`,
          })
        }
      }
    } catch { /* corrupt draft — fresh start */ }
    hydrated.current = true
  }, [draftKey])

  // ---------- Task 67: Outlets/Zero-Purchase se aya shop prefill — outlets + salesmen
  // dono load hone par apply. Task 68: booker ab salesmanId se match hota hai.
  // Draft ke sath takrar: shop/booker/company prefill par set hote hain; agar lines
  // naye company se match na karein to reset (single-company order guarantee).
  useEffect(() => {
    if (!focusOutlet || !outletsLoaded || !salesmenLoaded) return
    if (prefillDone.current === focusOutlet) return
    prefillDone.current = focusOutlet
    const o = outlets.find((x) => x.id === focusOutlet)
    if (o) {
      setOutletId(o.id)
      const match = o.salesmanId ? salesmen.find((s) => s.id === o.salesmanId) : null
      if (match) {
        setBookerId(match.id)
        setBookerTouched(false)
        if (match.companyId && match.companyId !== companyId) {
          if (lines.length > 0) {
            setLines([])
            toast({ title: 'Order lines reset ho gayin', description: 'Prefill shop doosri company ki hai — naye company ke products dobara add karein' })
          }
          setCompanyId(match.companyId)
        }
      }
    } else {
      toast({ title: 'Shop nahi mili', description: 'Jo shop aayi thi wo ab mojood nahi — dobara select karein', variant: 'destructive' })
    }
    setFocusOrderOutlet(null) // consume — wapas nav par dobara trigger na ho
  }, [focusOutlet, outletsLoaded, salesmenLoaded, outlets, salesmen, companyId, lines.length, setFocusOrderOutlet])

  // ---------- DRAFT AUTO-SAVE (har change par) ----------
  const draftPayload = useMemo(() => ({
    companyId, bookerId, bookerTouched, outletId, lines, notes, discType, discValue,
  }), [companyId, bookerId, bookerTouched, outletId, lines, notes, discType, discValue])
  const dirty = useMemo(() => draftHasData({ ...draftPayload, savedAt: '' }), [draftPayload])

  useEffect(() => {
    if (!hydrated.current) return
    setOrderDraftDirty(dirty)
    try {
      if (dirty) {
        const draft: OrderDraft = { ...draftPayload, savedAt: new Date().toISOString() }
        localStorage.setItem(draftKey, JSON.stringify(draft))
        setLastSaved(new Date())
      } else {
        localStorage.removeItem(draftKey)
        setLastSaved(null)
      }
    } catch { /* storage full etc — form phir bhi chalta rahega */ }
  }, [draftPayload, dirty, draftKey, setOrderDraftDirty])

  // ---------- PROTECTION: refresh / tab close par warn ----------
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const outlet = outlets.find((o) => o.id === outletId)
  const booker = salesmen.find((s) => s.id === bookerId)

  // Task 27: COMPANY-FIRST CASCADING FILTER — company pehle, phir usi ke bookers, phir shops, phir SKUs.
  // Company khali = kuch select nahi hota (strict tarteeb: Company → Booker → Shop → Products).
  const selectedCompany = companies.find((c) => c.id === companyId)
  const salesmanCompany = useMemo(() => new Map(salesmen.map((s) => [s.id, s.companyId ?? null])), [salesmen])
  const visibleSalesmen = useMemo(
    () => (companyId ? salesmen.filter((s) => s.companyId === companyId) : []),
    [salesmen, companyId]
  )
  const visibleProducts = useMemo(
    () => (companyId ? products.filter((p) => p.company?.id === companyId) : []),
    [products, companyId]
  )
  // Task 68: booker select hua to sirf USI ki assigned shops — warna (Task 27) company ke
  // bookers ki saari shops. Shop jis booker ki hai wo doosri company ki list mein kabhi nahi.
  const visibleOutlets = useMemo(() => {
    if (bookerId) return outlets.filter((o) => o.salesmanId === bookerId)
    if (companyId) return outlets.filter((o) => (o.salesmanId ? salesmanCompany.get(o.salesmanId) === companyId : false))
    return []
  }, [outlets, bookerId, companyId, salesmanCompany])

  // Outlet select hote hi uska default order booker auto-fill — LEKIN sirf jab booker manually
  // chuna na gaya ho (bookerTouched): shop badla to booker bhi shop ke route par shift hota hai
  function selectOutlet(id: string) {
    setOutletId(id)
    if (bookerTouched) return
    const o = outlets.find((x) => x.id === id)
    if (!o) return
    // Task 68: salesmanId se direct match (pehle name matching thi)
    const match = o.salesmanId ? salesmen.find((s) => s.id === o.salesmanId) : null
    if (match) setBookerId(match.id)
  }

  // Task 27: company badli to poora cascade dobara — booker/shop/lines jo naye company se
  // match na karein wo reset (single-company order guarantee + tax mode unambiguous)
  function selectCompany(id: string) {
    if (id === companyId) return
    setCompanyId(id)
    const b = salesmen.find((s) => s.id === bookerId)
    if (b && b.companyId !== id) { setBookerId(''); setBookerTouched(false) }
    const o = outlets.find((x) => x.id === outletId)
    if (o) {
      const sComp = o.salesmanId ? salesmen.find((s) => s.id === o.salesmanId)?.companyId ?? null : null
      if (sComp !== id) setOutletId('')
    }
    if (lines.length > 0) {
      setLines([])
      toast({ title: 'Order lines reset', description: 'Add the new company\u2019s products again — one order can only contain SKUs of a single company' })
    }
  }

  function addLine() {
    if (!companyId) {
      toast({ title: 'Select a company first', description: 'Order lines are added from the company selected above', variant: 'destructive' })
      return
    }
    const used = new Set(lines.map((l) => l.productId))
    const avail = visibleProducts.find((p) => !used.has(p.id) && p.available > 0) // Task 26: out-of-stock pehle hi select na ho
    if (avail) setLines([...lines, { productId: avail.id, qtyPcs: Math.max(1, avail.unitsPerCarton), tradeOffer: '' }]) // default 1 ctn
  }

  const computed = useMemo(() => {
    if (!outlet) return { subtotal: 0, discount: 0, gstTotal: 0, toTotal: 0, rows: [] as { name: string; qtyPcs: number; freeQty: number; discount: number; total: number; gross: number; stack: PreviewStackEntry[]; ratePc: number; upc: number; pcsPerBox: number; tradeOffer: number; gstRate: number; gstAmt: number; modeA: boolean; retail: boolean; retailMode: boolean }[] }
    let subtotal = 0, discount = 0, gstTotal = 0, toTotal = 0
    const rows = lines.map((l) => {
      const p = products.find((x) => x.id === l.productId)
      if (!p) return { name: '', qtyPcs: l.qtyPcs, freeQty: 0, discount: 0, total: 0, gross: 0, stack: [] as PreviewStackEntry[], ratePc: 0, upc: 1, pcsPerBox: 0, tradeOffer: 0, gstRate: 0, gstAmt: 0, modeA: false, retail: false, retailMode: false }
      const upc = Math.max(1, p.unitsPerCarton)
      const pcsPerBox = p.pcsPerBox > 0 ? p.pcsPerBox : 0
      const ratePc = p.tradePrice / upc
      const ctnEquiv = l.qtyPcs / upc
      let freeQty = 0, disc = 0
      // Task 55: server computeOrderLines ka client mirror — same filters (product + channel
      // + category + filer scope), warna booking preview server-booked discount se alag dikhta.
      // Task 58: FULL STACK mirror — jitni schemes bill qualify karein wo SAB lagti hain
      // (product + category + blanket, koi tier competition nahi). Har scheme apni chip/row.
      const tierOf = (s: SchemeDTO) => (s.productId ? 0 : s.categoryName ? 1 : 2)
      const qualifiesBxGy = (s: SchemeDTO) => s.type === 'BUY_X_GET_Y' && s.buyQty > 0 && ctnEquiv >= s.buyQty
      // Task 57: har scheme ka APNA contribution — per-scheme chips/rows isi se bante hain
      const stackAgg: PreviewStackEntry[] = []
      schemes
        .filter((s) =>
          (!s.productId || s.productId === p.id)
          && (!s.channel || s.channel === outlet.channel)
          && (!s.categoryName || s.categoryName === p.category)
          && (!s.filerScope || s.filerScope === outlet.filerStatus)
        )
        .sort((a, b) => tierOf(a) - tierOf(b))
        .forEach((s) => {
          if (s.type === 'BUY_X_GET_Y') {
            if (!qualifiesBxGy(s)) return
            const given = Math.round(Math.floor(ctnEquiv / s.buyQty) * s.freeQty * upc)
            freeQty += given
            stackAgg.push({ id: s.id, name: s.name ?? 'Scheme', type: s.type, amount: 0, freeGiven: given })
            return
          }
          const amount = s.type === 'PERCENT_DISCOUNT'
            ? Math.round(ratePc * l.qtyPcs * (s.value / 100) * 100) / 100
            : Math.round(s.value * ctnEquiv * 100) / 100
          disc += amount
          stackAgg.push({ id: s.id, name: s.name ?? 'Scheme', type: s.type, amount, freeGiven: 0 })
        })
      const gross = Math.round(ratePc * l.qtyPcs * 100) / 100
      // Task 45: GST per product (Products page ka rate — hardcoded nahi); TO discount ke ILAWA
      // Task 26 MIRROR: company INVOICE_DISCOUNT ho to Trade Offer pehle minus — GST (net − TO)
      // par (server computeOrderLines ka same rule — preview == booked bill)
      // Task 109 MIRROR: company RETAIL_GST (Cadbury) ho to GST RETAIL price se — qty ×
      // consumerPrice × r/(100+r) (sheet exact formula; server jaisa hi fallback bhi)
      const modeA = p.company?.taxMode === 'INVOICE_DISCOUNT'
      const tradeOffer = Math.max(0, Math.round((parseFloat(l.tradeOffer) || 0) * 100) / 100)
      const gstRate = p.gstEnabled === false ? 0 : Math.max(0, Number(p.gstRate) || 0)
      const retailGst = p.company?.taxMode === 'RETAIL_GST' ? retailGstAmt(l.qtyPcs, p.consumerPrice, gstRate) : null
      const gstAmt = retailGst != null
        ? retailGst
        : Math.round(Math.max(0, gross - disc - (modeA ? tradeOffer : 0)) * (gstRate / 100) * 100) / 100
      const lineTotal = gross - disc
      subtotal += gross
      discount += disc
      gstTotal += gstAmt
      toTotal += tradeOffer
      return { name: p.name, qtyPcs: l.qtyPcs, freeQty, discount: disc, total: lineTotal, gross, stack: stackAgg, ratePc, upc, pcsPerBox, tradeOffer, gstRate, gstAmt, modeA, retail: retailGst != null, retailMode: p.company?.taxMode === 'RETAIL_GST' }
    })
    return { subtotal, discount, gstTotal: Math.round(gstTotal * 100) / 100, toTotal: Math.round(toTotal * 100) / 100, rows }
  }, [lines, products, schemes, outlet])

  // Task 57: bill summary ki per-scheme rows — jitni schemes utni rows (auto).
  // Σ per-scheme amounts == computed.discount (Pass On column) — reconciliation barkarar.
  const schemePromos = useMemo(() => {
    const map = new Map<string, { id: string; name: string; amount: number; freePcs: number }>()
    for (const r of computed.rows) {
      for (const s of r.stack) {
        let e = map.get(s.id)
        if (!e) { e = { id: s.id, name: s.name, amount: 0, freePcs: 0 }; map.set(s.id, e) }
        if (s.freeGiven > 0) e.freePcs += s.freeGiven
        else e.amount = Math.round((e.amount + s.amount) * 100) / 100
      }
    }
    return [...map.values()]
  }, [computed])

  // Manual discount (order-level) — server bhi yehi formula dobara calculate karta hai
  const discNum = parseFloat(discValue)
  const discInputValid = Number.isFinite(discNum) && discNum > 0 && (discType === 'FLAT' || discNum <= 100)
  const manualDiscount = useMemo(() => {
    if (discType === 'NONE' || !discInputValid) return 0
    const raw = discType === 'PERCENT'
      ? Math.round(computed.subtotal * (discNum / 100) * 100) / 100
      : Math.round(discNum * 100) / 100
    return Math.round(Math.min(raw, Math.max(0, computed.subtotal - computed.discount)) * 100) / 100
  }, [discType, discNum, discInputValid, computed])
  const netTotal = Math.max(0, computed.subtotal - computed.discount - manualDiscount)

  // ---- Task 52: MANUAL DISCOUNT = PASS ON MERGE (server applyManualMerge ka client mirror) ----
  // Manual ko rows mein pro-rata (by net) tor kar har line par lagao — preview ke numbers
  // booked bill se EXACT match: Pass On (scheme + manual), Net, aur GST merged net par.
  const merged = useMemo(() => {
    const shares = splitManualByNet(computed.rows.map((r) => r.total), manualDiscount)
    let gstTotal = 0
    const rows = computed.rows.map((r, i) => {
      const manualShare = shares[i]
      const total = Math.round(Math.max(0, r.total - manualShare) * 100) / 100
      // Task 26 mirror: INVOICE_DISCOUNT line ka GST base = merged net − TO (server applyManualMerge jaisa)
      // Task 109 mirror: RETAIL (Cadbury) line ka GST discounts se azad — freeze (server jaisa hi)
      const base = r.modeA ? Math.max(0, total - r.tradeOffer) : total
      const gstAmt = r.retail ? r.gstAmt : r.gstRate > 0 ? Math.round(base * (r.gstRate / 100) * 100) / 100 : 0
      gstTotal += gstAmt
      return { ...r, manualShare, total, gstAmt }
    })
    return { rows, gstTotal: Math.round(gstTotal * 100) / 100 }
  }, [computed, manualDiscount])

  // Advance Tax live preview (bill par ADD hota hai) — shop ke filer status + settings rate se (server bhi yehi karta hai)
  // Task 76 (Option A): base = Net − Trade Offer + GST — purchase invoice jaisa (booking preview == booked bill)
  const toTotal = Math.round(merged.rows.reduce((s, r) => s + r.tradeOffer, 0) * 100) / 100
  const advTaxPreview = useMemo(() => {
    if (!outlet || !taxRates || netTotal <= 0) return 0
    const rate = outlet.filerStatus === 'FILER' ? taxRates.filer : taxRates.nonFiler
    const advBase = Math.max(0, Math.round((netTotal - toTotal + merged.gstTotal) * 100) / 100)
    return Math.round(advBase * rate / 100 * 100) / 100
  }, [outlet, taxRates, netTotal, toTotal, merged.gstTotal])

  // Task 45: Grand payable = goods net − trade offer + GST + advance tax (purchase invoice chain)
  // Task 52: GST merged (manual ke baad wale) net par — jaisa server book karta hai
  const grandPayable = Math.round((netTotal - toTotal + merged.gstTotal + advTaxPreview) * 100) / 100

  // Task 26-b: preview ladder mode-aware — SAARI lines Mode A (INVOICE_DISCOUNT companies)
  // hon to Noms/SalesFlo ladder (Less: Trade Offer GST se pehle). Mixed = print jaisa purana ladder.
  // Task 109: SAARI lines retail (Cadbury) hon to GST label 'Retail Basis' ka (ladder default jaisa).
  const previewModeA = computed.rows.length > 0 && computed.rows.every((r) => r.modeA)
  const previewRetail = computed.rows.length > 0 && computed.rows.every((r) => r.retail)
  // Task 110: Retail GST fallback visibility — company RETAIL_GST ho magar product par
  // Consumer Price na ho to wo line SILENTLY net-base GST par fall back hoti hai (purana
  // system jaisa lagta hai). Ye count booking par visible warning deta hai — user ko
  // pata ho ke numbers retail-basis se alag kyun hain aur kya set karna hai.
  const retailActive = selectedCompany?.taxMode === 'RETAIL_GST'
  const retailFallbackCount = computed.rows.filter((r) => r.retailMode && !r.retail).length

  function deleteDiscount() {
    setDiscType('NONE')
    setDiscValue('')
  }

  function goBack() {
    if (dirty) {
      const ok = window.confirm('Order form mein adhoora data hai — draft auto-save ho chuka hai, wapas aaoge to poora milega.\n\nPhir bhi wapas chalein?')
      if (!ok) return
    }
    router.push('/orders')
  }

  function startFresh() {
    if (!window.confirm('Current draft clear kar ke bilkul naya order shuru karein?')) return
    setCompanyId(''); setBookerId(''); setBookerTouched(false); setOutletId(''); setLines([]); setNotes('')
    setDiscType('NONE'); setDiscValue(''); setRestoredAt(null)
    try { localStorage.removeItem(draftKey) } catch {}
    toast({ title: 'Naya order shuru — purana draft clear ho gaya' })
  }

  async function save() {
    // Task 27: company lazmi — cascade (bookers/shops/SKUs) isi par chalta hai
    if (!companyId) {
      toast({ title: 'Company select karein', description: 'Order kis company ke products ka hai — pehle company select karein', variant: 'destructive' })
      return
    }
    if (!outletId || lines.length === 0) {
      toast({ title: 'Missing info', description: 'Shop (Outlet) aur kam az kam 1 product select karein', variant: 'destructive' })
      return
    }
    if (lines.some((l) => l.qtyPcs <= 0)) {
      toast({ title: 'Qty 0 hai', description: 'Har line mein Ctn/Box/Pcs mein kuch quantity enter karein', variant: 'destructive' })
      return
    }
    if (!bookerId) {
      toast({ title: 'Order Booker select karein', description: 'Bill kis order booker ka hai — pehle select karein', variant: 'destructive' })
      return
    }
    // Task 68: assigned shop ka order sirf apne booker ke account par — mismatch UI se bhi block
    if (outlet?.salesmanId && outlet.salesmanId !== bookerId) {
      toast({ title: 'Booker mismatch', description: `${outlet.name} kisi aur booker ki assigned shop hai — order usi ke account par book hoga`, variant: 'destructive' })
      return
    }
    if (discType !== 'NONE' && !discInputValid) {
      toast({ title: 'Invalid discount value', description: discType === 'PERCENT' ? 'Percentage must be between 0 and 100' : 'Flat amount must be greater than 0', variant: 'destructive' })
      return
    }
    // Task 45: Trade Offer validation — line ke net total se zyada nahi (server bhi check karta hai)
    // Task 52: merged net ke against (manual discount ke baad) — server bhi wahi karta hai
    const badTo = merged.rows.findIndex((r) => r.tradeOffer > r.total)
    if (badTo >= 0) {
      toast({ title: 'Invalid trade offer', description: `${merged.rows[badTo].name}: Rs ${merged.rows[badTo].tradeOffer} cannot exceed line total Rs ${merged.rows[badTo].total}`, variant: 'destructive' })
      return
    }
    // Task 112: STOCK LIMIT booking par block NAHI — over-stock bill bhi sync hogi.
    // Kami office par Process Anyway pop-up se handle hoti hai (jitna stock laga utna
    // total, jo cut hua wo cut hua). Pehle yahan UI block tha — poori bill ruk jati thi.
    setSaving(true)
    try {
      // 3-unit split: qtyPcs -> ctn/box/pcs (server dobara verify karta hai) + per-SKU trade offer
      const items = lines.map((l) => {
        const p = products.find((x) => x.id === l.productId)
        const upc = Math.max(1, p?.unitsPerCarton ?? 1)
        const ppb = p?.pcsPerBox && p.pcsPerBox > 0 ? p.pcsPerBox : 0
        const s = splitPcs(l.qtyPcs, upc, ppb)
        return { productId: l.productId, ctn: s.ctn, box: s.box, pcs: s.pcs, tradeOffer: Math.max(0, parseFloat(l.tradeOffer) || 0) }
      })
      const res = await api<{ order: { orderNo: string; total: number; payable?: number; prevBalance?: number; advanceApplied?: number; advanceAppliedNote?: string | null; creditWarning?: { status: string; message: string } | null } }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          outletId, salesmanId: bookerId, items, notes,
          discount: discType !== 'NONE' && discInputValid ? { type: discType, value: discNum } : undefined,
        }),
      })
      // Task 98: credit limit warning (Finexa convention — order block nahi hota, sirf WARNING)
      const cw = res.order.creditWarning
      // Task 102: booking par return advance auto-adjust foran dikhao (amount + kis return ki)
      const advMsg = (res.order.advanceApplied ?? 0) > 0.005
        ? ` • Claim Adj −${fmtPKR(res.order.advanceApplied!)} (return)${res.order.advanceAppliedNote ? ` — ${res.order.advanceAppliedNote}` : ''}`
        : ''
      // Task 31: success par draft clear + orders list par wapas (list mount par fresh load hoti hai)
      hydrated.current = false
      try { localStorage.removeItem(draftKey) } catch {}
      setOrderDraftDirty(false)
      toast({
        title: `Order ${res.order.orderNo} Booked ✓${cw ? ' — Credit Warning!' : ''}`,
        description: `Booker: ${booker?.name ?? ''} • Payable: ${fmtPKR(res.order.payable ?? res.order.total)}${manualDiscount > 0 ? ` (manual disc ${fmtPKR(manualDiscount)})` : ''}${computed.toTotal > 0 ? ` • TO ${fmtPKR(computed.toTotal)}` : ''}${advMsg}${cw ? ` • ⚠ ${cw.message}` : ''}`,
        variant: cw?.status === 'OVER' ? 'destructive' : undefined,
      })
      router.push('/orders')
    } catch (e) {
      toast({ title: 'Order Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* ============ PAGE HEADER (full page — dialog nahi) ============ */}
      <div className="shrink-0 flex flex-wrap items-center gap-3 pb-3">
        <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-900 leading-tight">New Order Booking</h2>
          <p className="text-sm text-slate-500 truncate">A full page — an accidental click will not close the form. Company → booker → shop, schemes auto-apply</p>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {dirty && lastSaved && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
              <ShieldCheck className="h-3 w-3" /> Draft auto-save {lastSaved.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          {dirty && (
            <Button variant="ghost" size="sm" className="h-8 text-slate-400 hover:text-red-500" onClick={startFresh} title="Clear the draft and start a new order">
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Fresh Start
            </Button>
          )}
        </div>
      </div>

      {/* restore banner */}
      {restoredAt && dirty && (
        <div className="shrink-0 mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600" />
          <span>Adhoora order draft restore ho gaya (aakhri auto-save: {new Date(restoredAt).toLocaleString('en-PK')}) — aap ka data mehfooz tha, kaam jari rakhein.</span>
        </div>
      )}

      {/* ============ SCROLLABLE CONTENT ============ */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 pb-4">
        {dataLoading ? (
          <Card className="border-slate-200"><CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Companies, shops, products load ho rahe hain...</div>
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}
          </CardContent></Card>
        ) : (
        <>
        {/* cascade: company → booker → shop */}
        <Card className="border-slate-200"><CardContent className="p-4">
          <div className="grid sm:grid-cols-2 gap-3">
            {/* Task 27: COMPANY-FIRST — company pehle, phir usi ke bookers/shops/SKUs + tax mode hint */}
            <div className="sm:col-span-2 grid gap-1.5">
              <Label>Company <span className="text-red-500">*</span></Label>
              <Select value={companyId} onValueChange={selectCompany}>
                <SelectTrigger className={companyId ? 'border-emerald-300' : 'border-amber-300'}><SelectValue placeholder="Kis company ka order book ho raha hai?" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.shortCode ? ` (${c.shortCode})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCompany?.taxMode === 'INVOICE_DISCOUNT' ? (
                <p className="text-[11px] leading-snug text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">⚡ <b>Invoice Discount mode</b> — Trade Offer is deducted first on this bill, GST is applied on the reduced net (Noms/SalesFlo style — lower GST)</p>
              ) : selectedCompany?.taxMode === 'RETAIL_GST' ? (
                <p className="text-[11px] leading-snug text-violet-800 bg-violet-50 border border-violet-200 rounded-md px-2 py-1">⚡ <b>Retail GST mode (Cadbury)</b> — GST is calculated on the retail price (Consumer Price × qty × 18/118); Pass On / Trade Offer do not affect GST — exactly like the company invoice sheet</p>
              ) : selectedCompany ? (
                <p className="text-[11px] text-slate-500">Claim/Rebate mode — GST applies on net first, Trade Offer is deducted afterwards (default mechanism)</p>
              ) : (
                <p className="text-[11px] text-slate-500">Select a company first — <b>its order bookers</b> and <b>its products</b> will load here</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Order Booker <span className="text-red-500">*</span></Label>
              <Select value={bookerId} onValueChange={(v) => {
                setBookerId(v); setBookerTouched(true)
                // Task 68: booker badla to doosre booker ki assigned shop selected thi to reset —
                // shop picker ab naye booker ki assigned shops dikhayega
                const o = outlets.find((x) => x.id === outletId)
                if (o?.salesmanId && o.salesmanId !== v) {
                  setOutletId('')
                  toast({ title: 'Shop reset ho gayi', description: `${o.name} ${salesmen.find((s) => s.id === o.salesmanId)?.name ?? 'doosre booker'} ki assigned shop hai — naye booker ki shops list hongi` })
                }
              }}>
                <SelectTrigger className={bookerId ? 'border-emerald-300' : 'border-amber-300'}><SelectValue placeholder="Bill kis order booker ka?" /></SelectTrigger>
                <SelectContent>
                  {visibleSalesmen.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-slate-500">{companyId ? 'Is company ka koi order booker assign nahi — Field Force page se booker ko company assign karein' : 'Pehle company select karein'}</div>
                  ) : visibleSalesmen.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}{s.region ? ` — ${s.region}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {booker ? (
                <p className="text-[11px] text-emerald-700 font-medium">✓ Ye bill <b>{booker.name}</b> ke booker account par book ho raha hai</p>
              ) : (
                <p className="text-[11px] text-slate-500">{companyId ? 'Pehle booker select karein — usi ki shops shop list mein aayengi' : 'Pehle company select karein — phir usi ke bookers yahan aayenge'}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Shop (Outlet) <span className="text-red-500">*</span></Label>
              {/* Task 67: SEARCHABLE shop picker — naam/code likh kar shop dhundo (bohat sari shops mein
                  plain dropdown se dhoondhna mushkil tha). Selected par naam + channel trigger par dikhta hai. */}
              <Popover open={outletPickerOpen} onOpenChange={setOutletPickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" aria-expanded={outletPickerOpen}
                    className={`w-full justify-between h-9 font-normal ${outletId ? 'border-emerald-300' : 'border-amber-300'}`}>
                    <span className={`truncate text-sm ${outlet ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
                      {outlet ? `${outlet.name} — ${outlet.channel}` : 'Search kar ke shop select karein...'}
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(22rem,calc(100vw-3rem))] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Shop ka naam ya code likhein..." />
                    <CommandList className="max-h-72">
                      {/* Task 68: empty message booker-filtered state ke hisab se — assign karne ka rasta bhi bataye */}
                      <CommandEmpty>
                        {bookerId && outlets.length > 0 && visibleOutlets.length === 0
                          ? `${booker?.name ?? 'Is booker'} ki koi shop assign nahi — Outlets page se shop Edit kar ke assign karein`
                          : companyId && outlets.length > 0 && visibleOutlets.length === 0
                            ? 'Is company ke bookers ki koi shop assign nahi — Outlets page se shop assign karein'
                            : 'Koi shop nahi mili — Outlets page se add karein'}
                      </CommandEmpty>
                      {visibleOutlets.map((o) => (
                        <CommandItem key={o.id} value={`${o.name} ${o.code} ${o.channel} ${o.salesmanName ?? ''}`}
                          onSelect={() => { selectOutlet(o.id); setOutletPickerOpen(false) }}>
                          <Store className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-800 truncate">{o.name}</p>
                            <p className="text-[10px] text-slate-400 truncate">{o.code} • {o.channel} • {bookerId ? `credit ${o.creditDays}d` : `${o.salesmanName ?? 'booker nahi'} • credit ${o.creditDays}d`}</p>
                          </div>
                          <Check className={`h-3.5 w-3.5 shrink-0 ${outletId === o.id ? 'opacity-100 text-emerald-600' : 'opacity-0'}`} />
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {/* Task 68: booker-filtered state ka live hint — kitni shops aur kis booker ki */}
              {booker && !outlet && (
                <p className="text-[11px] text-emerald-700 font-medium">
                  {visibleOutlets.length > 0
                    ? `Sirf ${booker.name} ki ${visibleOutlets.length} shop${visibleOutlets.length > 1 ? 's' : ''} nazar aa rahi hain ✓`
                    : `${booker.name} ki koi shop assign nahi — Outlets page se assign karein`}
                </p>
              )}
            </div>
            {outlet && (
              <div className="sm:col-span-2 text-xs text-slate-500 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                <span className="font-semibold text-emerald-700">{outlet.channel}</span> channel • Credit {outlet.creditDays} days • Route: {booker?.name ?? outlet.salesmanName ?? '—'}
              </div>
            )}
          </div>
        </CardContent></Card>

        {/* order lines */}
        <Card className="border-slate-200"><CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-800">Order Lines</p>
              {companyId && <p className="text-xs text-slate-400">{visibleProducts.length} products available — {selectedCompany?.name ?? ''}</p>}
            </div>
            <Button size="sm" variant="outline" onClick={addLine} className="h-9 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Product
            </Button>
          </div>
          {lines.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-400">
              {companyId ? 'Start order lines with "Add Product"' : 'Select a company first — then start lines with "Add Product"'}
            </div>
          )}
          {computed.rows.map((r, i) => {
            const mr = merged.rows[i]
            const lineProduct = products.find((x) => x.id === lines[i]?.productId)
            return (
            <div key={i} className="rounded-lg border p-3 space-y-2 bg-slate-50/50">
              {/* Task 46: Trade Offer UPPER bill row ka COLUMN hai (invoice PDF ke table jaisa) — neeche sub-row me nahi */}
              <div className="flex flex-wrap gap-2 items-start">
                {/* Task 81: SEARCHABLE product picker — naam/SKU likh kar dhoond ke add karo
                    (plain dropdown mein products scroll karna mushkil tha) */}
                <div className="flex-1 min-w-[180px]">
                  <ProductCombobox
                    products={visibleProducts.map((p) => {
                      const used = lines.some((l, j) => j !== i && l.productId === p.id)
                      const availCtn = p.available / Math.max(1, p.unitsPerCarton)
                      return {
                        id: p.id, name: p.name, sku: p.sku, brand: p.brand,
                        meta: `${fmtPKR(p.tradePrice)}/crtn (${p.unitsPerCarton} pcs) • ${used ? 'already added' : p.available <= 0 ? 'out of stock — office confirms at processing' : `avail ${availCtn.toFixed(2)} ctn`}`,
                        disabled: used,
                        disabledReason: used ? 'already added' : undefined,
                      }
                    })}
                    value={lines[i]?.productId ?? ''}
                    onSelect={(v) => {
                      const next = [...lines]
                      const np = products.find((x) => x.id === v)
                      next[i] = { ...next[i], productId: v, qtyPcs: Math.max(1, np?.unitsPerCarton ?? 1), tradeOffer: '' }
                      setLines(next)
                    }}
                  />
                </div>
                <UnitQtyInputs
                  pcs={lines[i]?.qtyPcs ?? 0}
                  upc={lineProduct ? Math.max(1, lineProduct.unitsPerCarton) : 1}
                  pcsPerBox={lineProduct?.pcsPerBox && lineProduct.pcsPerBox > 0 ? lineProduct.pcsPerBox : 0}
                  onChange={(totalPcs) => {
                    const next = [...lines]
                    next[i] = { ...next[i], qtyPcs: totalPcs }
                    setLines(next)
                  }}
                />
                <div className="flex flex-col items-center gap-0.5">
                  <Input
                    type="number" min={0} step="0.01" inputMode="decimal"
                    value={lines[i]?.tradeOffer ?? ''}
                    onChange={(e) => {
                      const next = [...lines]
                      next[i] = { ...next[i], tradeOffer: e.target.value }
                      setLines(next)
                    }}
                    placeholder="0"
                    aria-label="Trade Offer Rs"
                    className="h-9 w-24 text-center border-violet-200 focus-visible:ring-violet-300"
                  />
                  <span className="text-[9px] leading-none text-violet-500 font-medium flex items-center gap-0.5"><Gift className="h-2.5 w-2.5" />Trade Offer</span>
                </div>
                <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-red-400" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
              {/* Task 46: chain invoice PDF ke column order me — Gross → Pass On → Net → GST → Trade Offer → Line payable */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                {lineProduct && <span className="text-slate-400 whitespace-nowrap">{packHint(lineProduct.unitsPerCarton, lineProduct.boxesPerCarton, lineProduct.pcsPerBox)} • {fmtPKR(r.ratePc)}/pc</span>}
                <span className="text-slate-500 whitespace-nowrap">Gross <b className="text-slate-600">{fmtPKR(r.gross)}</b></span>
                {/* Task 57: HAR promotion apni chip — combined Pass On chip nahi.
                   Σ per-scheme amounts + Manual == bill ke Pass On column ka total */}
                {r.stack.filter((s) => s.amount > 0).map((s) => (
                  <span key={`m-${s.id}`} className="text-emerald-600 font-medium whitespace-nowrap">🎁 {s.name} − {fmtPKR(s.amount)}</span>
                ))}
                {r.stack.filter((s) => s.freeGiven > 0).map((s) => (
                  <span key={`f-${s.id}`} className="text-emerald-600 font-semibold whitespace-nowrap">🎁 {s.name} +{fmtQty(s.freeGiven, r.upc, r.pcsPerBox)} FREE</span>
                ))}
                {(mr?.manualShare ?? 0) > 0 && <span className="text-amber-600 font-medium whitespace-nowrap">Manual − {fmtPKR(mr!.manualShare)}</span>}
                <span className="text-slate-500 whitespace-nowrap">Net <b className="text-slate-700">{fmtPKR(mr?.total ?? r.total)}</b></span>
                {/* Task 26-b: Mode A line par TO chip GST se PEHLE (Noms ladder — print jaisa) */}
                {r.modeA && r.tradeOffer > 0 && <span className="text-violet-600 font-semibold whitespace-nowrap">Less TO − {fmtPKR(r.tradeOffer)}</span>}
                {(mr?.gstAmt ?? r.gstAmt) > 0 ? (
                  <span className="text-blue-600 font-medium whitespace-nowrap">GST{r.retail ? ' (retail)' : ''} {r.gstRate}% + {fmtPKR(mr?.gstAmt ?? r.gstAmt)}</span>
                ) : (
                  <span className="text-slate-400 whitespace-nowrap">No GST applies</span>
                )}
                {!r.modeA && r.tradeOffer > 0 && <span className="text-violet-600 font-semibold whitespace-nowrap">TO − {fmtPKR(r.tradeOffer)}</span>}
                <span className="text-slate-500 ml-auto whitespace-nowrap">Line payable: <b className="text-slate-700">{fmtPKR(Math.max(0, Math.round(((mr?.total ?? r.total) - r.tradeOffer + (mr?.gstAmt ?? r.gstAmt)) * 100) / 100))}</b></span>
              </div>
              {/* Task 112: over-stock booking allowed — soft info (koi block nahi; office par Process Anyway handle karta hai) */}
              {lineProduct && (
                (lines[i]?.qtyPcs ?? 0) > lineProduct.available ? (
                  <p className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                    Ordered more than available ({fmtQty(lineProduct.available, Math.max(1, lineProduct.unitsPerCarton), lineProduct.pcsPerBox > 0 ? lineProduct.pcsPerBox : 0)}) — the bill will sync; the office confirms stock at processing
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400">Available: <span className="font-semibold text-emerald-700">{fmtQty(lineProduct.available, Math.max(1, lineProduct.unitsPerCarton), lineProduct.pcsPerBox > 0 ? lineProduct.pcsPerBox : 0)}</span> (stock left after open bills)</p>
                )
              )}
            </div>
            )
          })}
        </CardContent></Card>

        {/* Manual Discount — % ya flat Rs; scheme ke ilawa order-level */}
        <Card className="border-slate-200"><CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-slate-700"><Percent className="h-3.5 w-3.5 text-emerald-600" /> Discount (optional)</Label>
            {(discType !== 'NONE' || discValue) && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={deleteDiscount}>
                <XCircle className="h-3.5 w-3.5 mr-1" /> Delete Discount
              </Button>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={discType} onValueChange={(v) => setDiscType(v as DiscType)}>
              <SelectTrigger className="sm:w-44 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No Discount</SelectItem>
                <SelectItem value="PERCENT">Percentage (%)</SelectItem>
                <SelectItem value="FLAT">Flat (Rs)</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number" min={0} step="0.01"
              disabled={discType === 'NONE'}
              value={discValue}
              onChange={(e) => setDiscValue(e.target.value)}
              placeholder={discType === 'FLAT' ? 'e.g. 500' : 'e.g. 5'}
              className="h-9 flex-1"
            />
            {manualDiscount > 0 && (
              <div className="flex items-center h-9 px-3 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 whitespace-nowrap">
                <b>- {fmtPKR(manualDiscount)}</b>
                {discType === 'PERCENT' && <span className="text-[11px] ml-1">({discValue}% of subtotal)</span>}
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400">Scheme discount ke <b>ilawa</b> pura order par lagta hai — invoice ke Discount Summary mein alag row aati hai aur Pass On column mein merge hoti hai (GST naye net par)</p>
        </CardContent></Card>

        <Card className="border-slate-200"><CardContent className="p-4 space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery instructions..." rows={2} />
        </CardContent></Card>

        {/* bill summary — poora ladder (print jaisa) */}
        <Card className="border-slate-200"><CardContent className="p-4 space-y-1 text-sm">
          <p className="font-semibold text-slate-800 mb-1">Bill Summary</p>
          {retailActive && retailFallbackCount > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900">
              <b>Consumer Price missing on {retailFallbackCount} line{retailFallbackCount !== 1 ? 's' : ''}.</b>{' '}
              Retail GST (Cadbury) mode is ON, but those lines are falling back to net-price GST. Set the Consumer (retail) Price on the Products page for the exact retail-basis GST.
            </div>
          )}
          <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtPKR(computed.subtotal)}</span></div>
          {schemePromos.map((p) => (
            <div key={p.id} className="flex justify-between text-emerald-600 font-medium">
              <span>🎁 {p.name}</span>
              <span>{p.freePcs > 0 ? `+${p.freePcs} Pcs Free` : `- ${fmtPKR(p.amount)}`}</span>
            </div>
          ))}
          {manualDiscount > 0 && <div className="flex justify-between text-emerald-600 font-medium"><span>Manual Discount</span><span>- {fmtPKR(manualDiscount)}</span></div>}
          <div className="flex justify-between font-bold text-slate-900"><span>Net Total</span><span>{fmtPKR(netTotal)}</span></div>
          {/* Task 26-b: booking ladder mode-aware (print cbl-print jaisa) —
              INVOICE_DISCOUNT = Noms/SalesFlo ladder: Less: Trade Offer GST se PEHLE */}
          {previewModeA && computed.toTotal > 0 && (
            <div className="flex justify-between text-violet-600 font-medium"><span>Less: Trade Offer (GST se pehle)</span><span>- {fmtPKR(computed.toTotal)}</span></div>
          )}
          {merged.gstTotal > 0 && <div className="flex justify-between text-blue-600 font-medium"><span>{previewModeA ? 'Sales Tax (GST)' : previewRetail ? 'GST (Retail Basis)' : 'GST (Sales Tax)'}</span><span>+ {fmtPKR(merged.gstTotal)}</span></div>}
          {!previewModeA && computed.toTotal > 0 && <div className="flex justify-between text-violet-600 font-medium"><span>Trade Offer</span><span>- {fmtPKR(computed.toTotal)}</span></div>}
          {outlet && taxRates && advTaxPreview > 0 && (
            <div className="flex justify-between text-blue-600"><span>Advance Tax ({outlet.filerStatus === 'FILER' ? `Filer ${taxRates.filer}` : `Non-Filer ${taxRates.nonFiler}`}%)</span><span>+ {fmtPKR(advTaxPreview)}</span></div>
          )}
          {(computed.toTotal > 0 || merged.gstTotal > 0 || advTaxPreview > 0) && (
            <div className="flex justify-between font-bold text-emerald-700 border-t border-slate-200 pt-1"><span>Total Payable</span><span>{fmtPKR(grandPayable)}</span></div>
          )}
          {previewModeA && computed.toTotal > 0 && (
            <p className="text-[11px] text-amber-600 font-medium">Invoice Discount mode active — this company&apos;s Trade Offer is deducted before GST (Noms/SalesFlo style)</p>
          )}
          {retailActive && computed.rows.length > 0 && (
            <p className="text-[11px] text-violet-600 font-medium">Retail GST (Cadbury) mode active — GST is calculated on each product&apos;s Consumer (retail) price and is not affected by discounts or Trade Offer</p>
          )}
        </CardContent></Card>
        </>
        )}
      </div>

      {/* ============ STICKY ACTION BAR ============ */}
      <div className="shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>{computed.rows.length} line{computed.rows.length !== 1 ? 's' : ''}</span>
          <span>Net <b className="text-slate-800">{fmtPKR(netTotal)}</b></span>
          {(computed.toTotal > 0 || merged.gstTotal > 0 || advTaxPreview > 0) && (
            <span className="text-sm">Total Payable <b className="text-emerald-700 text-base">{fmtPKR(grandPayable)}</b></span>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={goBack}>Cancel</Button>
          <Button onClick={save} disabled={saving || dataLoading} className="bg-emerald-600 hover:bg-emerald-700 min-w-44">
            {saving ? (<><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Booking...</>) : 'Book Order'}
          </Button>
        </div>
      </div>
    </div>
  )
}
