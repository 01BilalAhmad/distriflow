'use client'

// Task 65 — /login page ka gate:
// 1) ANONYMOUS: LoginScreen (login API httpOnly signed cookie set karti hai —
//    middleware isi se page routes protect karta hai).
// 2) COOKIE REFRESH: Task 95 mein legacy userId-bridge band ho gaya (auth bypass tha).
//    Ab gate bina body ke POST karta hai — valid cookie ho to fresh session restore
//    hota hai, warna login form dikhta hai (purane users ek dafa dobara login karenge).
// 3) LOGIN SUCCESS: `next` param (jo section user ne manga tha) par wapas — warna /.

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LoginScreen } from './login-screen'
import { saveSession } from '@/lib/dms-store'

export function LoginGate() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/'

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/auth/session', { method: 'POST' })
        if (!alive) return
        if (res.ok) {
          const data = (await res.json()) as { user: Parameters<typeof saveSession>[0] }
          if (data.user) {
            saveSession(data.user)
            router.replace(next)
            return
          }
        }
        // cookie nahi / invalid — localStorage session bhi clear (stale data na dikhe)
        saveSession(null)
      } catch { /* offline — login form dikhta rahega */ }
    })()
    return () => { alive = false }
  }, [router, next])

  return <LoginScreen nextPath={next} />
}
