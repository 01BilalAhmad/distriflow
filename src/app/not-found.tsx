import Link from 'next/link'

// Task 95 (P1 quality) — 404 page (pehle default Next page dikhta tha).

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-4xl">🔍</div>
      <h2 className="text-xl font-semibold">Page nahi mila</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Jo page aap dhoond rahe hain wo mojood nahi ya move ho gaya hai.
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Dashboard par wapas
      </Link>
    </div>
  )
}
