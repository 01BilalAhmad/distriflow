'use client'

// Task 95 (P1 quality) — route-level error boundary.
// Pehle koi error boundary nahi thi — runtime error par poora app white screen
// ho jata tha (Next default production message ke sath, koi recovery action nahi).

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Console structured — baad mein Sentry/logger yahan plug hoga
    console.error('[app-error]', { message: error.message, digest: error.digest })
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-4xl">⚠️</div>
      <h2 className="text-xl font-semibold">Kuch ghalat ho gaya</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Page load karte waqt masla preet aya hai. Dobara koshish karein — masla rahe to
        page refresh karein ya dobara login karein.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground/70">Ref: {error.digest}</p>
      ) : null}
      <button
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Dobara koshish karein
      </button>
    </div>
  )
}
