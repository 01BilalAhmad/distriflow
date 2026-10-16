'use client'

// Task 65 — /login page ka gate:
// 1) ANONYMOUS: LoginScreen (login API ab httpOnly signed cookie bhi set karti hai —
//    middleware isi se page routes protect karta hai).
// 2) LEGACY BRIDGE: deploy se pehle ke logged-in users ke paas sirf localStorage session
//    hai, cookie nahi. Ye gate localStorage session dekh kar /api/auth/session ko
//    userId bhejta hai — user DB mein mojood ho to cookie set → bina dobara login ke
//    seedha andar (production users seamless upgrade).
// 3) LOGIN SUCCESS: `next` param (jo section user ne manga tha) par wapas — warna /.

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LoginScreen } from './login-screen'
import { loadSession, saveSession } from '@/lib/dms-store'

export function LoginGate() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/'

  useEffect(() => {
    const s = loadSession()
    if (!s?.id) return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: s.id }),
        })
        if (!alive) return
        if (res.ok) {
          const data = (await res.json()) as { user: Parameters<typeof saveSession>[0] }
          if (data.user) {
            saveSession(data.user)
            router.replace(next)
          }
        } else {
          saveSession(null)
        }
      } catch { /* offline — login form dikhta rahega */ }
    })()
    return () => { alive = false }
  }, [router, next])

  return <LoginScreen nextPath={next} />
}
