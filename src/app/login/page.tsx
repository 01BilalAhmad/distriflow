import { Suspense } from 'react'
import { LoginGate } from '@/components/dms/login-gate'

// Task 65 — dedicated secure login page. Middleware anonymous users ko yahan bhejta hai
// (next=<section> ke sath) — login ke baad seedha usi section par wapas.
export const metadata = { title: 'Sign in — DistriFlow' }

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LoginGate />
    </Suspense>
  )
}
