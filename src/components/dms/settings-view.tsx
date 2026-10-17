'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useDMS, saveSession } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import { Loader2, Save, Store, Receipt, Phone, Percent } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

/**
 * Task 78 — SETTINGS PAGE (user: "setting page bnao Jahan ya sb chezain manage ki ja skin
 * or wahan pr Distributor Number name distribution name ko update kia jay sky").
 *
 * 2 sections:
 *  1. Distributor Profile — Distribution (business) name + Distributor name + Cell number +
 *     City. Ye wahi fields hain jo BILL PRINT ke header par chapte hain (Cell No naam ke
 *     neeche). Storage: businessName/city → DistributorProfile, name/phone → User
 *     (koi naya DB column nahi).
 *  2. Bill & Tax — Filer/Non-Filer advance tax rates + GST on/off + GST rate
 *     (yehi rates order booking + purchase invoice use karte hain).
 */

interface ProfileForm {
  businessName: string
  distributorName: string
  phone: string
  city: string
}

interface TaxForm {
  filerTaxRate: string
  nonFilerTaxRate: string
  gstEnabled: boolean
  gstRate: string
}

export function SettingsView() {
  const user = useDMS((s) => s.user)
  const setUser = useDMS((s) => s.setUser)
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingTax, setSavingTax] = useState(false)
  const [profile, setProfile] = useState<ProfileForm>({ businessName: '', distributorName: '', phone: '', city: '' })
  const [tax, setTax] = useState<TaxForm>({ filerTaxRate: '0.5', nonFilerTaxRate: '2.5', gstEnabled: true, gstRate: '18' })

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const res = await api<{
        settings: { filerTaxRate: number; nonFilerTaxRate: number; gstEnabled: boolean; gstRate: number }
        profile: { distributorName: string; phone: string; businessName: string; city: string }
      }>(`/api/settings?userId=${user.id}`)
      setProfile({
        businessName: res.profile.businessName ?? '',
        distributorName: res.profile.distributorName ?? '',
        phone: res.profile.phone ?? '',
        city: res.profile.city ?? '',
      })
      setTax({
        filerTaxRate: String(res.settings.filerTaxRate),
        nonFilerTaxRate: String(res.settings.nonFilerTaxRate),
        gstEnabled: res.settings.gstEnabled,
        gstRate: String(res.settings.gstRate),
      })
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Settings load failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [user])

  async function saveProfile() {
    if (!user) return
    if (!profile.businessName.trim()) {
      toast({ title: 'Distribution ka naam khali hai', variant: 'destructive' })
      return
    }
    if (!profile.distributorName.trim()) {
      toast({ title: 'Distributor ka naam khali hai', variant: 'destructive' })
      return
    }
    setSavingProfile(true)
    try {
      const res = await api<{ profile: ProfileForm }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          userId: user.id,
          businessName: profile.businessName.trim(),
          distributorName: profile.distributorName.trim(),
          phone: profile.phone.trim(),
          city: profile.city.trim(),
        }),
      })
      setProfile((p) => ({
        ...p,
        businessName: res.profile.businessName ?? p.businessName,
        distributorName: res.profile.distributorName ?? p.distributorName,
        phone: res.profile.phone ?? p.phone,
        city: res.profile.city ?? p.city,
      }))
      // Sidebar/topbar ka naam + phone live update (localStorage session bhi)
      const next = { ...user, name: res.profile.distributorName || user.name, phone: res.profile.phone || null }
      setUser(next)
      saveSession(next)
      toast({ title: 'Profile Save ✓', description: 'Ab naya print Cell No ke sath aayega' })
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Save failed', variant: 'destructive' })
    } finally {
      setSavingProfile(false)
    }
  }

  async function saveTax() {
    if (!user) return
    const fr = Number(tax.filerTaxRate)
    const nr = Number(tax.nonFilerTaxRate)
    const gr = Number(tax.gstRate)
    if (!Number.isFinite(fr) || fr < 0 || fr > 100 || !Number.isFinite(nr) || nr < 0 || nr > 100) {
      toast({ title: 'Tax rates 0-100 ke beech hon', variant: 'destructive' })
      return
    }
    if (tax.gstEnabled && (!Number.isFinite(gr) || gr < 0 || gr > 100)) {
      toast({ title: 'GST rate 0-100 ke beech hon', variant: 'destructive' })
      return
    }
    setSavingTax(true)
    try {
      const res = await api<{ settings: { filerTaxRate: number; nonFilerTaxRate: number; gstEnabled: boolean; gstRate: number } }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          userId: user.id,
          filerTaxRate: fr,
          nonFilerTaxRate: nr,
          gstEnabled: tax.gstEnabled,
          gstRate: gr,
        }),
      })
      setTax({
        filerTaxRate: String(res.settings.filerTaxRate),
        nonFilerTaxRate: String(res.settings.nonFilerTaxRate),
        gstEnabled: res.settings.gstEnabled,
        gstRate: String(res.settings.gstRate),
      })
      toast({ title: 'Tax Settings Save ✓', description: 'Naye orders isi rate se book honge' })
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Save failed', variant: 'destructive' })
    } finally {
      setSavingTax(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div><Skeleton className="h-7 w-48" /><Skeleton className="mt-1.5 h-4 w-72" /></div>
        <div className="grid gap-3 lg:grid-cols-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-72" />)}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-0.5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Settings</h2>
        <p className="text-sm text-slate-500">Distributor profile, bill print aur tax rates — sab kuch aik jagah</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ===== Distributor Profile — bill print ke naam/cell ===== */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100"><Store className="h-4 w-4 text-emerald-600" /></span>
              Distributor Profile
            </CardTitle>
            <CardDescription>
              Ye details <b>bill print</b> ke header par chapte hain — Cell No naam ke neeche &ldquo;Cell No:&rdquo; ki tarah
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="businessName">Distribution (Business) Name</Label>
              <Input id="businessName" value={profile.businessName} onChange={(e) => setProfile((p) => ({ ...p, businessName: e.target.value }))} placeholder="e.g. Al-Falah Traders" />
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="distributorName">Distributor Name</Label>
                <Input id="distributorName" value={profile.distributorName} onChange={(e) => setProfile((p) => ({ ...p, distributorName: e.target.value }))} placeholder="e.g. Ahmed Bhai" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />Cell Number</Label>
                <Input id="phone" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} placeholder="03001234567" inputMode="tel" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" value={profile.city} onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))} placeholder="e.g. KhanPur" />
            </div>
            <Button onClick={saveProfile} disabled={savingProfile} className="w-full bg-emerald-600 hover:bg-emerald-700">
              {savingProfile ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              Profile Save Karein
            </Button>
          </CardContent>
        </Card>

        {/* ===== Bill & Tax — advance tax rates + GST ===== */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100"><Receipt className="h-4 w-4 text-blue-600" /></span>
              Bill &amp; Tax Settings
            </CardTitle>
            <CardDescription>Advance tax (236H) ke rates aur GST — naye orders/purchase invoices isi se compute honge</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="filerRate" className="flex items-center gap-1.5"><Percent className="h-3.5 w-3.5 text-slate-400" />Filer Rate %</Label>
                <Input id="filerRate" type="number" min={0} max={100} step="0.01" value={tax.filerTaxRate} onChange={(e) => setTax((t) => ({ ...t, filerTaxRate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nonFilerRate">Non-Filer Rate %</Label>
                <Input id="nonFilerRate" type="number" min={0} max={100} step="0.01" value={tax.nonFilerTaxRate} onChange={(e) => setTax((t) => ({ ...t, nonFilerTaxRate: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">GST (Sales Tax)</p>
                <p className="text-xs text-slate-500">Bills par GST calculation on/off</p>
              </div>
              <Switch checked={tax.gstEnabled} onCheckedChange={(on) => setTax((t) => ({ ...t, gstEnabled: on }))} />
            </div>
            {tax.gstEnabled && (
              <div className="space-y-1.5">
                <Label htmlFor="gstRate">GST Rate %</Label>
                <Input id="gstRate" type="number" min={0} max={100} step="0.01" value={tax.gstRate} onChange={(e) => setTax((t) => ({ ...t, gstRate: e.target.value }))} />
              </div>
            )}
            <Button onClick={saveTax} disabled={savingTax} className="w-full bg-slate-800 hover:bg-slate-900 text-white">
              {savingTax ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              Tax Settings Save Karein
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
