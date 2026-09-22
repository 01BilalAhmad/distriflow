'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api, fmtPKR, fmtDate } from '@/lib/dms-api'
import type { LedgerRowDTO, LedgerEntryDTO, LedgerOutletDTO, LedgersData } from '@/lib/dms-types'
import { exportShopLedgerExcel, exportShopSummaryExcel, exportAllShopsFullExcel } from '@/lib/excel-export'
import { ShopLedgerStatementDoc, LedgerSummaryDoc } from '@/components/dms/ledger-print'
import { BookText, Search, ChevronDown, ChevronUp, Landmark, Printer, FileSpreadsheet, Layers, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export function LedgersView() {
  const [data, setData] = useState<LedgersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [printSummary, setPrintSummary] = useState(false)
  const [fullExporting, setFullExporting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      if (!user) return
      const r = await api<LedgersData>(`/api/ledgers?userId=${user.id}`)
      setData(r)
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => (data?.ledgers ?? []).filter((l) =>
    `${l.name} ${l.code} ${l.city} ${l.channel}`.toLowerCase().includes(search.toLowerCase())
  ), [data, search])

  function exportSummaryExcel() {
    if (!data) return
    try {
      exportShopSummaryExcel(data.ledgers, data.totals)
      toast({ title: 'Excel Export', description: `${data.ledgers.length} shops ki summary download ho gayi (.xlsx)` })
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Export failed', variant: 'destructive' })
    }
  }

  async function exportFullWorkbook() {
    if (!data || fullExporting) return
    const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
    if (!user) return
    setFullExporting(true)
    try {
      await exportAllShopsFullExcel(data.ledgers, (outletId) =>
        api<{ outlet: LedgerOutletDTO; balance: number; entries: LedgerEntryDTO[] }>(`/api/ledgers?userId=${user.id}&outletId=${outletId}`)
      )
      toast({ title: 'Excel Export', description: `Full workbook ready — ${data.ledgers.length} sheets (har shop + summary)` })
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Export failed', variant: 'destructive' })
    } finally { setFullExporting(false) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {printSummary && data && <LedgerSummaryDoc data={data} onClose={() => setPrintSummary(false)} />}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Shop Ledgers (Udhaar Khata)</h2>
          <p className="text-sm text-slate-500">Har shop ka debit (invoice) / credit (cash) aur outstanding balance</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={load}>Refresh</Button>
          <Button variant="outline" size="sm" className="border-slate-300 text-slate-700 hover:bg-slate-50" onClick={() => setPrintSummary(true)} disabled={!data || data.ledgers.length === 0}>
            <Printer className="h-4 w-4 mr-1.5" /> Print Summary
          </Button>
          <Button variant="outline" size="sm" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={exportSummaryExcel} disabled={!data || data.ledgers.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export Excel
          </Button>
          <Button variant="outline" size="sm" className="border-violet-300 text-violet-700 hover:bg-violet-50" onClick={exportFullWorkbook} disabled={!data || data.ledgers.length === 0 || fullExporting}>
            {fullExporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Layers className="h-4 w-4 mr-1.5" />}
            Full Workbook ({data?.ledgers.length ?? 0})
          </Button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-slate-200"><CardContent className="p-4">
            <p className="text-xs text-slate-400 uppercase font-semibold">Total Outstanding (Udhaar)</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{fmtPKR(data.totals.outstanding)}</p>
          </CardContent></Card>
          <Card className="border-slate-200"><CardContent className="p-4">
            <p className="text-xs text-slate-400 uppercase font-semibold">Shops with Udhaar</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{data.totals.shopsWithUdhaar}</p>
          </CardContent></Card>
          <Card className="border-slate-200"><CardContent className="p-4">
            <p className="text-xs text-slate-400 uppercase font-semibold">Total Shops</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{data.totals.totalShops}</p>
          </CardContent></Card>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Shop, code, city search karein..." className="pl-9" />
      </div>

      <Card className="border-slate-200 shadow-sm flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/70">
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Shop / Outlet</TableHead>
                    <TableHead className="hidden md:table-cell">City</TableHead>
                    <TableHead className="text-right">Debit (Invoices)</TableHead>
                    <TableHead className="text-right">Credit (Cash)</TableHead>
                    <TableHead className="text-right">Balance (Udhaar)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-slate-400">Koi shop nahi mili — settlement ke baad ledger entries yahan aayengi</TableCell></TableRow>
                  )}
                  {filtered.map((l) => (
                    <LedgerRow key={l.outletId} row={l} expanded={expanded === l.outletId} onToggle={() => setExpanded(expanded === l.outletId ? null : l.outletId)} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LedgerRow({ row, expanded, onToggle }: { row: LedgerRowDTO; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <TableRow className={`hover:bg-emerald-50/30 cursor-pointer ${expanded ? 'bg-emerald-50/40' : ''}`} onClick={onToggle}>
        <TableCell>{expanded ? <ChevronUp className="h-4 w-4 text-emerald-600" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}</TableCell>
        <TableCell>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-400">{row.code} • {row.channel}</p>
        </TableCell>
        <TableCell className="hidden md:table-cell text-slate-500 text-sm">{row.city}</TableCell>
        <TableCell className="text-right text-slate-600">{row.debit > 0 ? fmtPKR(row.debit) : '—'}</TableCell>
        <TableCell className="text-right text-slate-600">{row.credit > 0 ? fmtPKR(row.credit) : '—'}</TableCell>
        <TableCell className="text-right">
          {row.balance > 0.01 ? <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 font-semibold">{fmtPKR(row.balance)}</Badge>
            : row.balance < -0.01 ? <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{fmtPKR(row.balance)} advance</Badge>
            : <span className="text-slate-400 text-sm">Clear ✓</span>}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-slate-50/50">
          <TableCell colSpan={6} className="p-0">
            <div className="px-6 py-3">
              <LedgerEntries outletId={row.outletId} distributorName={row.distributorName} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function LedgerEntries({ outletId, distributorName }: { outletId: string; distributorName: string }) {
  const [entries, setEntries] = useState<LedgerEntryDTO[] | null>(null)
  const [outlet, setOutlet] = useState<LedgerOutletDTO | null>(null)
  const [balance, setBalance] = useState(0)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
    if (!user) return
    api<{ outlet: LedgerOutletDTO; balance: number; entries: LedgerEntryDTO[] }>(`/api/ledgers?userId=${user.id}&outletId=${outletId}`)
      .then((r) => { setOutlet(r.outlet); setBalance(r.balance); setEntries(r.entries) })
      .catch(() => setEntries([]))
  }, [outletId])

  function printStatement() {
    if (!outlet || !entries) return
    setPrinting(true)
  }

  function exportExcel() {
    if (!outlet || !entries) return
    try {
      exportShopLedgerExcel(outlet, distributorName, entries, balance)
      toast({ title: 'Excel Export', description: `${outlet.name} ka khata download ho gaya (.xlsx)` })
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Export failed', variant: 'destructive' })
    }
  }

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      {printing && outlet && entries && (
        <ShopLedgerStatementDoc outlet={outlet} distributorName={distributorName} entries={entries} balance={balance} onClose={() => setPrinting(false)} />
      )}
      <div className="px-3 py-2 border-b bg-slate-50 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Landmark className="h-4 w-4 text-emerald-600" /> {outlet?.name ?? '...'} — Khata History</p>
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-red-600">Outstanding: {fmtPKR(balance)}</p>
          <Button variant="outline" size="sm" className="h-7 border-slate-300 text-slate-700 hover:bg-slate-100" onClick={printStatement} disabled={!outlet || !entries || entries.length === 0}>
            <Printer className="h-3.5 w-3.5 mr-1" /> Print
          </Button>
          <Button variant="outline" size="sm" className="h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={exportExcel} disabled={!outlet || !entries || entries.length === 0}>
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Excel
          </Button>
        </div>
      </div>
      <ScrollArea className="max-h-72">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!entries && <TableRow><TableCell colSpan={6} className="text-center py-6 text-sm text-slate-400">Loading...</TableCell></TableRow>}
            {entries && entries.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-sm text-slate-400">Abhi koi entry nahi — settlement ke baad entries banaingi</TableCell></TableRow>
            )}
            {entries?.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(e.date)}</TableCell>
                <TableCell className="text-xs font-medium text-emerald-700">{e.refNo}</TableCell>
                <TableCell className="text-xs text-slate-600">
                  {e.note ?? e.refType}
                  <Badge variant="outline" className={`ml-2 text-[9px] ${e.type === 'DEBIT' ? 'border-red-200 text-red-600' : 'border-emerald-200 text-emerald-700'}`}>{e.refType}</Badge>
                </TableCell>
                <TableCell className="text-right text-red-600 text-sm font-medium">{e.debit > 0 ? fmtPKR(e.debit) : '—'}</TableCell>
                <TableCell className="text-right text-emerald-700 text-sm font-medium">{e.credit > 0 ? fmtPKR(e.credit) : '—'}</TableCell>
                <TableCell className="text-right font-semibold text-slate-800">{fmtPKR(e.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}
