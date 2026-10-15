'use client'

/**
 * Task 36 — Backup & Safety view (MEGA_ADMIN only).
 *
 * - "Create Backup Now" -> POST /api/backup (VACUUM INTO consistent snapshot)
 * - Backup list: name / size / date + Download (GET ?download=name)
 * - Live DB (db/custom.db) kabhi directly download nahi hoti — sirf snapshots.
 */

import { useEffect, useState } from 'react'
import { Database, Download, Loader2, PlusCircle, ShieldCheck } from 'lucide-react'
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

  const load = async () => {
    if (!user) return
    try {
      const res = await fetch(`/api/backup?userId=${user.id}`)
      const data = await res.json()
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
      if (!res.ok) throw new Error(data.error || 'Backup create failed')
      setBackups(data.backups ?? [])
      toast({ title: 'Backup ban gaya', description: `${data.backup.name} (${fmtSize(data.backup.sizeBytes)})` })
    } catch (e) {
      toast({ title: 'Backup create fail', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setCreating(false)
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
                <CardDescription>Poore database ka consistent snapshot — live traffic ke beech me bhi safe</CardDescription>
              </div>
            </div>
            <Button onClick={createBackup} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700">
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlusCircle className="h-4 w-4 mr-2" />}
              {creating ? 'Backup ban raha hai...' : 'Create Backup Now'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
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
        </CardContent>
      </Card>
    </div>
  )
}
