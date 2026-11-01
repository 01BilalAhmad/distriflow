'use client'

/**
 * Task 127 — MAINTENANCE SCREEN (distributor portal + salesman session ka friendly band).
 *
 * Jab MEGA_ADMIN global ya per-distributor maintenance ON karta hai:
 * - session API 503 + maintenance payload deta hai
 * - shell ye full-screen page render karta hai (koi business UI nahi)
 * - "Check status" button session dobara verify karta hai — window khatam hote hi
 *   user khud-ba-khud wapis portal mein (bina login ke).
 * Mobile app ka data-safe message bhi yahi hai: device-first orders local save hoti
 * hain aur maintenance ke baad auto-sync (koi manual kaam nahi).
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Wrench, Loader2, RefreshCw } from 'lucide-react'

function fmtWhen(until: string | null): string {
  if (!until) return null as unknown as string
  try {
    return new Intl.DateTimeFormat('en-PK', {
      timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(until))
  } catch {
    return until
  }
}

export function MaintenanceScreen({ until, note }: { until: string | null; note: string | null }) {
  const [checking, setChecking] = useState(false)

  async function checkStatus() {
    setChecking(true)
    try {
      const res = await fetch('/api/auth/session', { method: 'POST' })
      if (res.ok) {
        // window khatam — shell session refresh khud karega (full reload simplest)
        window.location.reload()
        return
      }
    } catch { /* abhi bhi down — toast ki zaroorat nahi, button hi reh jata hai */ }
    setChecking(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-[#141c30] dark:via-[#0c0f14] dark:to-[#141c30] p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2f56d6] to-[#6b98ee] shadow-lg shadow-[#2f56d6]/25">
          <Wrench className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Scheduled Maintenance</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
          We are upgrading DistriFlow to serve you better.
          {until ? <> Service resumes by <span className="font-semibold text-slate-800 dark:text-slate-100">{fmtWhen(until)} (PKT)</span>.</> : ' Please check back shortly.'}
        </p>
        {note ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] font-medium text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300">
            {note}
          </p>
        ) : null}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white/70 px-5 py-4 text-[13px] leading-relaxed text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
          Your data is safe. Orders booked on the mobile app are stored on the device
          and will sync automatically once maintenance ends — no manual work needed.
        </div>
        <Button onClick={checkStatus} disabled={checking} className="mt-6 gap-2">
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {checking ? 'Checking…' : 'Check status'}
        </Button>
      </div>
    </div>
  )
}
