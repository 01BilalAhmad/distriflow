// T140 — local test users for Playwright e2e (recreated after sandbox recycle;
// lives inside distriflow/ so PrismaClient/bcryptjs resolve without a symlink).
// admin@dms.pk / demo123      -> MEGA_ADMIN (lands on console)
// t138-dist@distriflow.test / Test138!x -> DISTRIBUTOR (full sidebar + dashboard)
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

const distributor = await db.distributorProfile.findFirst({ orderBy: { id: 'asc' } })
if (!distributor) throw new Error('No DistributorProfile found — run prisma db push + base seed first')

const users = [
  { email: 'admin@dms.pk', name: 'Super Admin', role: 'MEGA_ADMIN', password: 'demo123' },
  { email: 't138-dist@distriflow.test', name: 'Bilal Ahmad', role: 'DISTRIBUTOR', password: 'Test138!x' },
]

for (const u of users) {
  const passwordHash = await bcrypt.hash(u.password, 10)
  const data = { email: u.email, name: u.name, role: u.role, passwordHash, distributorId: distributor.id, isActive: true }
  await db.user.upsert({
    where: { email: u.email },
    update: { passwordHash, isActive: true, name: u.name },
    create: data,
  })
  console.log('upserted', u.email, u.role)
}

await db.$disconnect()
console.log('seed-t140 done')
