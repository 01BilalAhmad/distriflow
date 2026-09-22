'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useDMS, saveSession } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import type { SessionUser } from '@/lib/dms-types'
import { Boxes, Building2, ShieldCheck, Truck, Loader2, MapPin, Package, Route } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

const DEMO_USERS = [
  { email: 'admin@dms.pk', role: 'MEGA_ADMIN', label: 'Mega Admin (Software Seller)', desc: 'Distributor accounts banaye — subscription active/inactive + renew', icon: ShieldCheck },
  { email: 'distributor@dms.pk', role: 'DISTRIBUTOR', label: 'Distributor (Subscriber)', desc: 'Al-Madina Distribution — apna business, apne orderbookers khud banaye', icon: Building2 },
  { email: 'salesman@dms.pk', role: 'SALESMAN', label: 'Salesman / Order Booker', desc: 'Ali Raza — PJP, order booking, check-in/out', icon: Truck },
]

export function LoginScreen() {
  const { setUser } = useDMS()
  const [email, setEmail] = useState('admin@dms.pk')
  const [password, setPassword] = useState('demo123')
  const [loading, setLoading] = useState(false)

  async function doLogin(em?: string) {
    const loginEmail = em ?? email
    setLoading(true)
    try {
      const res = await api<{ user: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: em ? 'demo123' : password }),
      })
      saveSession(res.user)
      setUser(res.user)
      toast({ title: 'Welcome, ' + res.user.name, description: 'Role: ' + res.user.role.replaceAll('_', ' ') })
    } catch (e) {
      toast({ title: 'Login Failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center">
        {/* Branding side */}
        <div className="hidden lg:block space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-600/20">
              <Package className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">DistriFlow</h1>
              <p className="text-sm text-emerald-700 font-medium">FMCG Distribution Management System</p>
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-slate-900 leading-tight">
              FMCG Secondary Sales<br />ko <span className="text-emerald-600">Automate</span> karein
            </h2>
            <p className="text-slate-600 leading-relaxed">
              Order booking se delivery tak — PJP route planning, geo-tagged outlets,
              real-time inventory (FIFO/FEFO), schemes, claims aur powerful reports.
              Complete distribution chain ek jagah.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Route, t: 'PJP & Route Planning', d: 'Daily journey plans' },
              { icon: MapPin, t: 'Geo-tagged Outlets', d: 'GPS check-in/out' },
              { icon: Package, t: 'FEFO Inventory', d: 'Batch-wise stock' },
              { icon: Boxes, t: 'Mega Admin Model', d: 'Dist → Order Bookers' },
            ].map((f) => (
              <div key={f.t} className="flex items-start gap-3 rounded-lg border bg-white/70 p-3">
                <f.icon className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">{f.t}</p>
                  <p className="text-xs text-slate-500">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500 flex-wrap">
            <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">1500+ Distributors</Badge>
            <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">FMCG Specialized</Badge>
            <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">Real-time</Badge>
          </div>
        </div>

        {/* Login side */}
        <Card className="shadow-xl border-emerald-100">
          <CardHeader className="pb-3">
            <div className="lg:hidden flex items-center gap-2 mb-1">
              <div className="h-9 w-9 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Package className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">DistriFlow</h1>
            </div>
            <CardTitle className="text-lg">Sign in to your workspace</CardTitle>
            <CardDescription>
              Demo users — ek click mein login karein (password: <code className="text-emerald-700 font-semibold">demo123</code>)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2.5">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  onClick={() => doLogin(u.email)}
                  disabled={loading}
                  className="w-full text-left rounded-xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/50 transition-all p-3.5 flex items-center gap-3 group disabled:opacity-60"
                >
                  <div className="h-10 w-10 rounded-lg bg-emerald-100 group-hover:bg-emerald-600 transition-colors flex items-center justify-center shrink-0">
                    <u.icon className="h-5 w-5 text-emerald-700 group-hover:text-white transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-slate-900">{u.label}</p>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-300 text-slate-500">{u.role}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 truncate">{u.desc}</p>
                  </div>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : <span className="text-emerald-600 text-sm font-medium">Login →</span>}
                </button>
              ))}
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-slate-400">ya manually login karein</span></div>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@dms.pk" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="demo123" />
              </div>
              <Button onClick={() => doLogin()} disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700">
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Sign In
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
