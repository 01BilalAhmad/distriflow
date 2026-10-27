'use client'

// Task 91 — SELVAR DARK MODE provider (Light / Dark / System)
// next-themes class strategy: .dark <html> par lagta hai (globals.css ke @custom-variant
// dark + .dark token blocks isi par chalte hain). localStorage 'distriflow-theme',
// system preference follow, aur no-flash inline script next-themes khud inject karta hai.
// defaultTheme 'light' — existing users ka experience unchanged.

import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      storageKey="distriflow-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
