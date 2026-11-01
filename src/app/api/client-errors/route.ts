import { clientIp, rateLimit } from '@/lib/rate-limit'
import { captureError } from '@/lib/error-log'

/**
 * Task 128 — client-side error intake (portal-only).
 *
 * error.tsx / global-error.tsx boundary errors yahan POST hote hain (fire-and-forget).
 * AUTH-FREE hai (boundary crash ke waqt session bhi toot sakta hai) — magar:
 * - IP rate limit 10 / 5 min (spam/flood band)
 * - message 1KB / stack 2KB cap
 * - sirf WARN level (server 5xx se zyada emergency nahi hota)
 * Koi sensitive data expected nahi — sirf message/stack/path likhe jate hain.
 */

export async function POST(req: Request) {
  try {
    const ip = clientIp(req)
    const rl = rateLimit(`clienterr:${ip}`, { windowMs: 5 * 60 * 1000, max: 10 })
    if (!rl.ok) return new Response(null, { status: 429 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body.message !== 'string') {
      return Response.json({ error: 'message required' }, { status: 400 })
    }

    await captureError({
      level: 'WARN',
      source: 'client',
      message: String(body.message).slice(0, 1000),
      route: typeof body.path === 'string' ? body.path.slice(0, 200) : null,
      stack: typeof body.stack === 'string' ? body.stack.slice(0, 2000) : null,
    })
    return Response.json({ ok: true })
  } catch {
    return new Response(null, { status: 204 })
  }
}
