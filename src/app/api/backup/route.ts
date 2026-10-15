import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

/**
 * Task 36 — Backup & Safety (MEGA_ADMIN only).
 *
 * SQLite file contains ALL tenants' business data, so backup download sirf mega admin
 * ke liye hai — distributor ko apne tenant ka data export karne ke liye Excel exports hain.
 *
 * Consistency: SQLite `VACUUM INTO` reads a single consistent snapshot (WAL included),
 * so backup lena chalte server par bhi safe hai — live DB copy corruption-free rehti hai.
 *
 * GET  /api/backup?userId=                -> list backups (name, size, createdAt)
 * GET  /api/backup?userId=&download=name  -> stream one backup file (Content-Disposition)
 * POST /api/backup { userId }             -> create new snapshot via VACUUM INTO
 */

const BACKUP_DIR = path.join(process.cwd(), 'db', 'backups')
const NAME_RE = /^distriflow-backup-\d{4}-\d{2}-\d{2}-\d{6}\.db$/

// Task 38: file-based backup (VACUUM INTO) sirf local SQLite deployment par kaam karta hai.
// Cloud (Neon Postgres on Vercel) par filesystem ephemeral hota hai — wahan Neon ka automatic
// backup / point-in-time restore built-in hai, is liye ye feature gracefully disable hota hai.
const CLOUD_BACKUP_MSG =
  'Backup cloud deployment par available nahi — Neon Postgres ke apne automatic backups aur point-in-time restore use ho rahe hain (Neon Console se manage karein)'

function isCloudDb() {
  const url = process.env.DATABASE_URL ?? ''
  return url.startsWith('postgres://') || url.startsWith('postgresql://')
}

async function requireMegaAdmin(userId: string | null) {
  if (!userId) return { error: jsonError('userId required') }
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return { error: jsonError('User not found', 404) }
  if (user.role !== 'MEGA_ADMIN') return { error: jsonError('Backup sirf Mega Admin kar sakta hai', 403) }
  return { user }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return []
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f))
      return { name: f, sizeBytes: st.size, createdAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

export async function GET(req: Request) {
  try {
    if (isCloudDb()) {
      return jsonError(CLOUD_BACKUP_MSG, 400)
    }
    const { searchParams } = new URL(req.url)
    const guard = await requireMegaAdmin(searchParams.get('userId'))
    if ('error' in guard) return guard.error

    const download = searchParams.get('download')
    if (download) {
      // path traversal guard: sirf strict backup naam allow
      if (!NAME_RE.test(download)) return jsonError('Invalid backup filename')
      const file = path.join(BACKUP_DIR, download)
      if (!fs.existsSync(file)) return jsonError('Backup file nahi mili', 404)
      const buf = fs.readFileSync(file)
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${download}"`,
          'Content-Length': String(buf.length),
        },
      })
    }

    return Response.json({ backups: listBackups(), dbFile: 'db/custom.db' })
  } catch (e) {
    console.error(e)
    return jsonError('Backup list failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    if (isCloudDb()) {
      return jsonError(CLOUD_BACKUP_MSG, 400)
    }
    const b = (await req.json()) as { userId?: string }
    const guard = await requireMegaAdmin(b.userId ?? null)
    if ('error' in guard) return guard.error

    fs.mkdirSync(BACKUP_DIR, { recursive: true })

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const target = path.join(BACKUP_DIR, `distriflow-backup-${stamp}.db`)

    // VACUUM INTO: consistent snapshot — live traffic ke beech me bhi safe
    await db.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`)

    const st = fs.statSync(target)
    return Response.json({
      backup: { name: path.basename(target), sizeBytes: st.size, createdAt: st.mtime.toISOString() },
      backups: listBackups(),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Backup create failed', 500)
  }
}
