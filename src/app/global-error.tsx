'use client'

// Task 95 (P1 quality) — root/global error boundary (layout khud fail ho to).
// fonts/global CSS load fail hone par bhi user ko actionable screen mile.

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global-error]', { message: error.message, digest: error.digest })
  }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>App mein masla hai</h1>
          <p style={{ color: '#666', margin: 0 }}>Aik unexpected error aya hai. Page reload karein.</p>
          <button
            onClick={reset}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2a4fd0', color: '#fff', fontSize: 14, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
