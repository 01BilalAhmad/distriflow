/**
 * Task 128 — Next.js instrumentation hooks.
 *
 * onRequestError: koi bhi route handler / server component MEIN UNCAUGHT error
 * (jo route ke try/catch tak nahi pohancha) yahan capture hota hai → ErrorLog
 * (source 'unhandled', level ERROR). Handled errors jsonError() se jaate hain.
 *
 * NOTE: import module-top par nahi — serverless bundling edge/node dono runtimes
 * target karta hai; capture ko handler ke andar dynamic import karte hain.
 */

export async function register() {
  // noop — sirf hook registration ke liye zaroori
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | undefined> },
) {
  try {
    const { captureError } = await import('@/lib/error-log')
    await captureError({
      level: 'ERROR',
      source: 'unhandled',
      message: error instanceof Error ? error.message : String(error),
      route: request?.path ?? null,
      method: request?.method ?? null,
      stack: error instanceof Error ? (error.stack ?? null) : null,
    })
  } catch {
    // instrumentation kabhi request flow nahi todta
  }
}
