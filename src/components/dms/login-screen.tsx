'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useDMS, saveSession } from '@/lib/dms-store'
import { api } from '@/lib/dms-api'
import type { SessionUser } from '@/lib/dms-types'
import { Boxes, Loader2, MapPin, Package, Route } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export function LoginScreen({ nextPath }: { nextPath?: string }) {
  const { setUser } = useDMS()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function doLogin() {
    setLoading(true)
    try {
      const res = await api<{ user: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      saveSession(res.user)
      setUser(res.user)
      toast({ title: 'Welcome, ' + res.user.name, description: 'Role: ' + res.user.role.replaceAll('_', ' ') })
      // Task 65: login API ne httpOnly cookie set ki — ab URL route par jao (jo section
      // user ne manga tha — next param — warna dashboard). Middleware cookie dekh kar allow karega.
      router.replace(nextPath || '/')
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
            <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">FMCG Specialized</Badge>
            <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">Real-time</Badge>
            <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">Multi-tenant</Badge>
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
              Apne account ki email aur password se login karein
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="apna@email.com"
                  autoComplete="username"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !loading) doLogin() }}
                />
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
