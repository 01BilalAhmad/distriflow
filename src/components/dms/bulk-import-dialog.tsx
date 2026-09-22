'use client'

// Task 30 — SHARED BULK IMPORT DIALOG: shops aur products dono isi se import hote hain.
// Flow: Paste ya file (.csv/.txt/.xlsx/.xls) -> parse (delimiter auto + header detect) ->
// preview (valid/error rows) -> import -> result (imported / skipped / warnings).

import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Upload, Download, FileSpreadsheet, ClipboardPaste, CheckCircle2, XCircle, AlertTriangle, ArrowLeft } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export interface BulkColumn {
  key: string
  label: string
  required?: boolean
  hint?: string
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

export interface ImportApiResult {
  imported: number
  skipped: { row: number; name: string; reason: string }[]
  warnings?: { row: number; name: string; reason: string }[]
}

interface Props<T> {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: string
  accent: string // button bg class, e.g. bg-emerald-600 hover:bg-emerald-700
  columns: BulkColumn[]
  sampleRows: string[][]
  parseRow: (row: Record<string, string>) => ParseOutcome<T>
  importRequest: (rows: T[]) => Promise<ImportApiResult>
  onDone: () => void
}

type Stage = 'input' | 'preview' | 'result'

interface PreviewRow {
  row: number
  cells: Record<string, string>
  ok: boolean
  error?: string
}

// ---------- delimited text parsing (RFC-4180-ish: quotes, escaped quotes) ----------

function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } // "" -> literal quote
        else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === delim) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function detectDelim(text: string): string {
  const sample = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
  const counts: [string, number][] = [
    ['\t', (sample.match(/\t/g) ?? []).length],
    [',', (sample.match(/,/g) ?? []).length],
    [';', (sample.match(/;/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

function textToRows(text: string): string[][] {
  const delim = detectDelim(text)
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0).map((l) => splitLine(l, delim))
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Pehli row header hai? — zyada-tar cells kisi column label/key se match karein */
function looksLikeHeader(first: string[], columns: BulkColumn[]): boolean {
  const targets = columns.flatMap((c) => [norm(c.label), norm(c.key)])
  let hits = 0
  for (const cell of first) {
    const n = norm(cell)
    if (n.length < 2) continue
    if (targets.some((t) => t.length >= 3 && (n === t || n.includes(t) || t.includes(n)))) hits++
  }
  return hits >= Math.max(2, Math.ceil(first.filter(Boolean).length / 2))
}

function mapRows(rows: string[][], columns: BulkColumn[]): Record<string, string>[] {
  const first = rows[0] ?? []
  const header = looksLikeHeader(first, columns)
  if (!header) {
    // positional: column order hi mapping hai
    return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c.key, r[i] ?? ''])))
  }
  // header mapping: header cell -> column key (contains-match, pehla match jeet-ta hai)
  const colByKey = new Map<string, string>()
  for (let i = 0; i < first.length; i++) {
    const n = norm(first[i])
    if (!n) continue
    const col = columns.find((c) => {
      const t = norm(c.label), k = norm(c.key)
      return t.length >= 3 && (n === t || n.includes(t) || t.includes(n))
    })
    if (col && !colByKey.has(col.key)) colByKey.set(col.key, String(i))
  }
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {}
    for (const c of columns) {
      const idx = colByKey.get(c.key)
      rec[c.key] = idx != null ? (r[Number(idx)] ?? '') : ''
    }
    return rec
  })
}

function downloadTemplate(columns: BulkColumn[], sampleRows: string[][], filename: string) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const csv = [columns.map((c) => esc(c.label)).join(','), ...sampleRows.map((r) => r.map(esc).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ---------- component ----------

export function BulkImportDialog<T>({ open, onOpenChange, title, description, accent, columns, sampleRows, parseRow, importRequest, onDone }: Props<T>) {
  const [stage, setStage] = useState<Stage>('input')
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportApiResult | null>(null)
  const [fileName, setFileName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStage('input'); setText(''); setPreview([]); setResult(null); setFileName('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleOpenChange(v: boolean) {
    if (!v) reset()
    onOpenChange(v)
  }

  function runParse(rows: string[][], srcName: string) {
    if (rows.length === 0) {
      toast({ title: 'Koi data nahi mila', description: 'Rows khali hain — pehle data paste karein ya file select karein', variant: 'destructive' })
      return
    }
    const records = mapRows(rows, columns)
    const pv: PreviewRow[] = records.map((cells, i) => {
      const out = parseRow(cells)
      return out.ok ? { row: i + 1, cells, ok: true } : { row: i + 1, cells, ok: false, error: out.error }
    })
    if (pv.length > 500) {
      toast({ title: 'Bohat zyada rows', description: 'Ek dafa mein max 500 rows import ho sakti hain', variant: 'destructive' })
      return
    }
    setPreview(pv)
    setFileName(srcName)
    setStage('preview')
  }

  function parsePasted() { runParse(textToRows(text), 'pasted-data') }

  async function parseFile(f: File) {
    try {
      let rows: string[][]
      if (/\.(xlsx|xls)$/i.test(f.name)) {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(await f.arrayBuffer())
        const ws = wb.Sheets[wb.SheetNames[0]]
        rows = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' }) as unknown[][])
          .map((r) => (r as unknown[]).map((c) => (c == null ? '' : String(c).trim())))
      } else {
        rows = textToRows(await f.text())
      }
      runParse(rows, f.name)
    } catch {
      toast({ title: 'File parhi nahi ja saki', description: 'CSV ya Excel (.xlsx) file select karein', variant: 'destructive' })
    }
  }

  async function doImport() {
    const valid = preview.filter((p) => p.ok)
    if (valid.length === 0) return
    setImporting(true)
    try {
      const r = await importRequest(valid.map((p) => parseRow(p.cells)).filter((o): o is Extract<ParseOutcome<T>, { ok: true }> => o.ok).map((o) => o.value))
      setResult(r)
      setStage('result')
      onDone()
    } catch (e) {
      toast({ title: 'Import failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' })
    } finally { setImporting(false) }
  }

  const validCount = preview.filter((p) => p.ok).length
  const errCount = preview.length - validCount
  const previewCols = columns.slice(0, 4)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /> {title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {stage === 'input' && (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <StepLabel icon={<ClipboardPaste className="h-3.5 w-3.5 text-slate-400" />}>1) Data paste karein (CSV/Excel columns copy-paste)</StepLabel>
                <button type="button" onClick={() => downloadTemplate(columns, sampleRows, `${columns[0]?.key ?? 'bulk'}-import-template.csv`)}
                  className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-800">
                  <Download className="h-3.5 w-3.5" /> Template CSV
                </button>
              </div>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7}
                placeholder={sampleRows.map((r) => r.join(', ')).join('\n')}
                className="font-mono text-[11px] min-h-[140px]" />
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <div className="h-px flex-1 bg-slate-200" /> YA <div className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="grid gap-1.5">
              <StepLabel icon={<Upload className="h-3.5 w-3.5 text-slate-400" />}>2) File upload (.csv, .txt ya .xlsx)</StepLabel>
              <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void parseFile(f) }} />
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex h-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-emerald-400 hover:bg-emerald-50/40 hover:text-emerald-700 transition-colors">
                <Upload className="h-5 w-5" />
                <span className="text-xs font-medium">Excel ya CSV file chunein</span>
                <span className="text-[10px] text-slate-400">Pehli row header ho to column order kuch bhi ho sakta hai</span>
              </button>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
              <p className="text-[11px] font-semibold text-slate-600 mb-1">Columns (isi order se paste karein):</p>
              <div className="flex flex-wrap gap-1">
                {columns.map((c) => (
                  <span key={c.key} title={c.hint}
                    className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${c.required ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                    {c.label}{c.required ? ' *' : ''}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">* = zaroori — baqi khali chhor sakte hain. Duplicate rows skip ho jayengi, baqi import hongi.</p>
            </div>
          </div>
        )}

        {stage === 'preview' && (
          <div className="grid gap-3">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-slate-700 truncate">{fileName}</span>
              <span className="flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 className="h-3.5 w-3.5" /> {validCount} theek</span>
              {errCount > 0 && <span className="flex items-center gap-1 text-red-600 font-bold"><XCircle className="h-3.5 w-3.5" /> {errCount} ghalat</span>}
            </div>
            <div className="max-h-[320px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/70">
                    <TableHead className="w-10">#</TableHead>
                    {previewCols.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((p) => (
                    <TableRow key={p.row} className={p.ok ? 'hover:bg-emerald-50/30' : 'bg-red-50/40'}>
                      <TableCell className="text-slate-400 text-xs">{p.row}</TableCell>
                      {previewCols.map((c) => (
                        <TableCell key={c.key} className="text-xs text-slate-700 max-w-[140px] truncate">{p.cells[c.key] || '—'}</TableCell>
                      ))}
                      <TableCell className="text-xs">
                        {p.ok ? (
                          <span className="flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Import hoga</span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600"><XCircle className="h-3.5 w-3.5 shrink-0" /> {p.error}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {stage === 'result' && result && (
          <div className="grid gap-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="flex items-center gap-1.5 font-bold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> {result.imported} rows import ho gayin</p>
              {result.warnings && result.warnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  {result.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-[11px] text-blue-700"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> Row {w.row} ({w.name}): {w.reason}</p>
                  ))}
                </div>
              )}
            </div>
            {result.skipped.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-bold text-amber-800 mb-1.5">{result.skipped.length} rows skip hui (ye problem thin):</p>
                <div className="space-y-1 max-h-[180px] overflow-y-auto">
                  {result.skipped.map((s, i) => (
                    <p key={i} className="text-[11px] text-amber-900"><b>Row {s.row}</b> — {s.name}: {s.reason}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-row gap-2">
          {stage === 'input' && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1">Band Karein</Button>
              <Button onClick={parsePasted} disabled={!text.trim()} className={`flex-1 ${accent}`}>
                <ClipboardPaste className="h-4 w-4 mr-1.5" /> Data Check Karein
              </Button>
            </>
          )}
          {stage === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStage('input')} className="flex-1"><ArrowLeft className="h-4 w-4 mr-1.5" /> Wapas</Button>
              <Button onClick={doImport} disabled={importing || validCount === 0} className={`flex-1 ${accent}`}>
                {importing && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                Import {validCount} Rows
              </Button>
            </>
          )}
          {stage === 'result' && (
            <Button onClick={() => handleOpenChange(false)} className={`w-full ${accent}`}>Mukammal Hua — Band Karein</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Chhota label-with-icon helper (Label import se conflict na ho) */
function StepLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">{icon}{children}</span>
}
