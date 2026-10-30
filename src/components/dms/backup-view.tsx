'use client'

/**
 * Task 36 — Backup & Safety view (MEGA_ADMIN only).
 *
 * - "Create Backup Now" -> POST /api/backup (VACUUM INTO consistent snapshot)
 * - Backup list: name / size / date + Download (GET ?download=name)
 * - Live DB (db/custom.db) kabhi directly download nahi hoti — sirf snapshots.
 */

import { useEffect, useState } from 'react'
import { CloudCheck, Database, Download, ExternalLink, Loader2, PlusCircle, ShieldCheck, AlertTriangle, Clock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useDMS } from '@/lib/dms-store'

interface BackupMeta {
  name: string
  sizeBytes: number
  createdAt: string
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function fmtDT(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function BackupView() {
  const { user } = useDMS()
  const { toast } = useToast()
  const [backups, setBackups] = useState<BackupMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  // Task 40: cloud (Neon Postgres) par file-backup feature disable hai — ye error nahi,
  // normal state hai. cloudMode par info panel dikhta hai, red toast nahi.
  const [cloudMode, setCloudMode] = useState(false)
  const [cloudMsg, setCloudMsg] = useState('')
  const [downloading, setDownloading] = useState(false)
  // Task 36: BACKUP FRESHNESS — aakhri backup kab liya (AuditLog ki BACKUP_EXPORT row se).
  // User: "backup lazmi hy" — 7 din se purana (ya kabhi nahi liya) par red warning.
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null)
  const [backupChk, setBackupChk] = useState<'loading' | 'ok' | 'stale' | 'never'>('loading')

  const load = async () => {
    if (!user) return
    try {
      const res = await fetch(`/api/backup?userId=${user.id}`)
      const data = await res.json()
      if (data.cloudMode) {
        setCloudMode(true)
        setCloudMsg(data.message || '')
        setBackups([])
        return
      }
      if (!res.ok) throw new Error(data.error || 'Backup list failed')
      setBackups(data.backups ?? [])
    } catch (e) {
      toast({ title: 'Backup list fail', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [user?.id])

  // Task 36: aakhri BACKUP_EXPORT audit row — backup freshness ka source
  useEffect(() => {
    if (!user) return
    fetch('/api/audit?action=BACKUP_EXPORT&take=1')
      .then((r) => (r.ok ? r.json() : { logs: [] }))
      .then((d) => {
        const at: string | null = d?.logs?.[0]?.at ?? null
        setLastBackupAt(at)
        if (!at) setBackupChk('never')
        else setBackupChk(Date.now() - new Date(at).getTime() > 7 * 24 * 3600 * 1000 ? 'stale' : 'ok')
      })
      .catch(() => setBackupChk('never'))
  }, [user?.id])

  const createBackup = async () => {
    if (!user) return
    setCreating(true)
    try {
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      const data = await res.json()
      if (data.cloudMode) {
        // race safety: button load hone se pehle click ho gaya — info toast, error nahi
        setCloudMode(true)
        setCloudMsg(data.message || data.error || '')
        toast({ title: 'Cloud backup', description: data.error })
        return
      }
      if (!res.ok) throw new Error(data.error || 'Backup create failed')
      setBackups(data.backups ?? [])
      toast({ title: 'Backup ban gaya', description: `${data.backup.name} (${fmtSize(data.backup.sizeBytes)})` })
    } catch (e) {
      toast({ title: 'Backup create fail', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  // Task 42: cloud par bhi poora data JSON file me download ho sakta hai —
  // user apna data khud apne paas safe rakhe (har hafte / bare change se pehle)
  const downloadJson = async () => {
    if (!user) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/backup/export?userId=${user.id}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Backup download failed')
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename="?([^";]+)"?/)
      const name = m?.[1] || `distriflow-backup-${Date.now()}.json`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'Backup download ho gaya ✓', description: `${name} — ise apne paas (email/Drive) safe rakhein` })
    } catch (e) {
      toast({ title: 'Backup download fail', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 flex items-center justify-center shadow-md shadow-emerald-600/25">
                <Database className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg leading-tight">Backup &amp; Safety</CardTitle>
                <CardDescription>
                  {cloudMode
                    ? 'Cloud database (Neon Postgres) — automatic backups, point-in-time restore'
                    : 'Poore database ka consistent snapshot — live traffic ke beech me bhi safe'}
                </CardDescription>
              </div>
            </div>
            {!cloudMode && (
              <Button onClick={createBackup} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700">
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlusCircle className="h-4 w-4 mr-2" />}
                {creating ? 'Backup ban raha hai...' : 'Create Backup Now'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {cloudMode ? (
            <>
              <div className="flex items-start gap-3 text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-4 py-3">
                <CloudCheck className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <p className="font-semibold">Cloud database (Neon Postgres) — deploy/hot-reload se data par asar nahi padta</p>
                  <p className="text-sky-800 leading-relaxed">{cloudMsg}</p>
                  <a
                    href="https://console.neon.tech"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sky-700 font-medium underline underline-offset-2 hover:text-sky-900"
                  >
                    Neon Console kholein <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 flex-wrap bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                <div className="text-sm text-emerald-900">
                  <p className="font-semibold">Apna data khud bhi safe rakhein (lazmi)</p>
                  <p className="text-emerald-800 leading-relaxed mt-0.5">Neeche button se poora database JSON file me download hota hai. Har hafte ya koi bhi bara kaam shuru karne se pehle ek backup download karke apne paas (email/Drive/USB) rakh lein.</p>
                  {/* Task 36: backup freshness — aakhri backup kab liya, 7 din se purana ho to warning */}
                  <p className={`mt-2 text-xs font-semibold flex items-center gap-1.5 ${backupChk === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
                    {backupChk === 'loading' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Backup history check ho rahi hai…</>}
                    {backupChk === 'ok' && <><Clock className="h-3.5 w-3.5" /> Aakhri backup: {lastBackupAt ? fmtDT(lastBackupAt) : ''} — sab theek ✓</>}
                    {backupChk === 'stale' && <><AlertTriangle className="h-3.5 w-3.5" /> Aakhri backup {lastBackupAt ? `(${fmtDT(lastBackupAt)})` : ''} 7 din se purana hai — ABHI naya backup lein!</>}
                    {backupChk === 'never' && <><AlertTriangle className="h-3.5 w-3.5" /> Abhi tak KOI backup download nahi hua — pehla backup ABHI lein, ye lazmi hai!</>}
                  </p>
                </div>
                <Button onClick={downloadJson} disabled={downloading} className="bg-emerald-600 hover:bg-emerald-700 shrink-0">
                  {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  {downloading ? 'Download ho raha hai...' : 'Download Backup (JSON)'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                Backup sirf Mega Admin ke liye hai — sab tenants ka data ek hi SQLite file me hota hai, is liye ye view distributor/salesman ko nahi dikhta. Download hamesha snapshot se hota hai, live DB se nahi.
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading backups...
                </div>
              ) : backups.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  Abhi koi backup nahi — <b>Create Backup Now</b> dabayen aur pehla snapshot banayein.
                </div>
              ) : (
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-3 py-2 font-semibold">Backup File</th>
                    <th className="px-3 py-2 font-semibold">Size</th>
                    <th className="px-3 py-2 font-semibold">Created</th>
                    <th className="px-3 py-2 font-semibold text-right">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b, i) => (
                    <tr key={b.name} className={i % 2 ? 'bg-slate-50/50' : ''}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{b.name}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-[11px]">{fmtSize(b.sizeBytes)}</Badge></td>
                      <td className="px-3 py-2 text-xs text-slate-500">{fmtDT(b.createdAt)}</td>
                      <td className="px-3 py-2 text-right">
                        <a href={`/api/backup?userId=${user?.id}&download=${encodeURIComponent(b.name)}`} download>
                          <Button size="sm" variant="outline" className="h-7">
                            <Download className="h-3.5 w-3.5 mr-1" /> Download
                          </Button>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
