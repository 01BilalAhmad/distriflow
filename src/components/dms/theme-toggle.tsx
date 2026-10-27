'use client'

// Task 91 — Theme toggle (topbar): Light / Dark / System dropdown.
// Selvar demo ke triple-theme switch jaisa — choice localStorage mein persist hoti hai,
// System option OS preference follow karta hai. Icon: active theme ke hisab se
// Sun (light) / Moon (dark) / Monitor (system). Topbar chips jaisi hi styling —
// dark mode mein globals.css overrides in classes ko khud dark surface par le aate hain.
// Hydration detection useSyncExternalStore se (react-hooks/set-state-in-effect rule
// friendly — koi setState-in-effect nahi): hydration tak Sun render hota hai, phir
// smooth switch. Server/client pehli render match karte hain — mismatch impossible.

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const emptySubscribe = () => () => {}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  // false server-side + hydration par, true client-side baad mein — hydration-safe mounted
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  // Capital name — JSX lowercase tag ko intrinsic element samajhta hai
  const ActiveIcon = mounted && theme === 'dark' ? Moon : mounted && theme === 'system' ? Monitor : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Theme — Light / Dark / System"
          aria-label="Theme badlein"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        >
          <ActiveIcon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        <DropdownMenuItem onClick={() => setTheme('light')} className="gap-2">
          <Sun className="h-4 w-4" />
          Light
          {mounted && theme === 'light' && <Check className="ml-auto h-3.5 w-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')} className="gap-2">
          <Moon className="h-4 w-4" />
          Dark
          {mounted && theme === 'dark' && <Check className="ml-auto h-3.5 w-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')} className="gap-2">
          <Monitor className="h-4 w-4" />
          System
          {mounted && theme === 'system' && <Check className="ml-auto h-3.5 w-3.5" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
