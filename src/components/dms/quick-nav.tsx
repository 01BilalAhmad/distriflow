'use client'

// Task 70 — QUICK NAV (⌘K command menu):
// Dark top bar ke search button / Ctrl+K shortcut se khulne wala lightweight command
// dialog. Saare nav sections fuzzy search + keyboard navigation (↑ ↓ ↵ esc) ke sath.
// - Hand-rolled hai (koi naya dependency nahi) — input + list + highlight index.
// - Items already role-filtered hoti hain (app-shell se aati hain) — SALESMAN ko sirf
//   apne sections nazar aayenge.
// - Escape / backdrop click se band; Enter par highlighted item navigate hota hai.
// - Navigation ke baad dialog band (app-shell ka quickNavigate router.push karta hai).
// - Reset pattern: open=false par poora component UNMOUNT hota hai, is liye query/index
//   state dobara khulne par khud fresh milta hai — koi reset-effect ki zaroorat nahi
//   (react-hooks/set-state-in-effect rule bhi khush, stale state ka bug bhi namumkin).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'

export type QuickNavItem = {
  key: string
  label: string
  group: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
}

export function QuickNav(props: {
  open: boolean
  onOpenChange: (v: boolean) => void
  items: QuickNavItem[]
  onNavigate: (key: string) => void
}) {
  if (!props.open) return null
  // Key stable hai lekin open toggle par parent conditional render = fresh mount →
  // inner ka useState initial values se shuru hota hai (query '', idx 0)
  return <QuickNavInner {...props} />
}

function QuickNavInner({
  onOpenChange,
  items,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  items: QuickNavItem[]
  onNavigate: (key: string) => void
}) {
  const [query, setQuery] = useState('')
  const [rawIdx, setRawIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // case-insensitive multi-word match: "shop led" → label+group+desc par
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    const words = q.split(/\s+/)
    return items.filter((it) => {
      const hay = `${it.label} ${it.group} ${it.desc}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [items, query])

  // idx ko filtered list ke size par clamp — effect ke baghair derived-safe
  const idx = Math.min(rawIdx, Math.max(filtered.length - 1, 0))

  // highlighted item scroll mein visible rakho (sirf DOM op — setState nahi)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-qi="${idx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  function onQueryChange(v: string) {
    setQuery(v)
    setRawIdx(0)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setRawIdx(Math.min(idx + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setRawIdx(Math.max(idx - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = filtered[idx]; if (it) onNavigate(it.key) }
    else if (e.key === 'Escape') { e.preventDefault(); onOpenChange(false) }
  }

  // group-wise sections (original order preserve)
  const groups: { name: string; items: { it: QuickNavItem; gi: number }[] }[] = []
  let running = 0
  for (const it of filtered) {
    const last = groups[groups.length - 1]
    if (last && last.name === it.group) last.items.push({ it, gi: running++ })
    else groups.push({ name: it.group, items: [{ it, gi: running++ }] })
  }

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" onClick={() => onOpenChange(false)} />
      <div
        className="absolute left-1/2 top-[12vh] w-[min(580px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/30"
        role="dialog" aria-modal="true"
      >
        {/* search input — autoFocus attribute se effect-free focus */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Sections search karein — orders, ledger, tax report…"
            className="h-12 w-full bg-transparent text-[13.5px] text-slate-800 outline-none placeholder:text-slate-400"
          />
          <kbd className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">ESC</kbd>
        </div>
        {/* results */}
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-[12.5px] text-slate-400">
              &quot;{query}&quot; ke liye koi section nahi mila
            </div>
          )}
          {groups.map((g) => (
            <div key={g.name} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-[9.5px] font-bold uppercase tracking-widest text-slate-400">{g.name}</div>
              {g.items.map(({ it, gi }) => (
                <button
                  key={it.key}
                  data-qi={gi}
                  onMouseEnter={() => setRawIdx(gi)}
                  onClick={() => onNavigate(it.key)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    gi === idx ? 'bg-emerald-50' : ''
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    gi === idx ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <it.icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-semibold ${gi === idx ? 'text-emerald-800' : 'text-slate-800'}`}>{it.label}</span>
                    <span className="block truncate text-[10.5px] text-slate-400">{it.desc}</span>
                  </span>
                  {gi === idx && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                </button>
              ))}
            </div>
          ))}
        </div>
        {/* footer hints */}
        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[10.5px] text-slate-400">
          <span><kbd className="rounded border border-slate-200 bg-white px-1">↑</kbd> <kbd className="rounded border border-slate-200 bg-white px-1">↓</kbd> navigate</span>
          <span><kbd className="rounded border border-slate-200 bg-white px-1">↵</kbd> open</span>
          <span><kbd className="rounded border border-slate-200 bg-white px-1">esc</kbd> close</span>
          <span className="ml-auto font-semibold text-slate-300">DistriFlow QuickNav</span>
        </div>
      </div>
    </div>
  )
}
