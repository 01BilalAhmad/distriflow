import type { Metadata } from "next";
// Task 90 — SELVAR THEME: font Urbanist (Selvar demo ka signature font). CSS variable
// ka naam (--font-geist-sans) INTENTIONALLY wahi rakha gaya hai — @theme mapping aur
// saari utilities bina kisi touch ke naye font par switch ho jati hain.
import { Urbanist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Urbanist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DistriFlow — FMCG Distribution Management System",
  description: "DistriFlow — Sales & Distribution Management for FMCG distributors: order booking, PJP route planning, geo-tagged outlets, FEFO inventory, schemes, claims aur real-time reports.",
  keywords: ["DMS", "Distribution Management", "FMCG", "Sales Force Automation", "PJP", "Secondary Sales"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
