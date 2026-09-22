import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

/**
 * MEGA ADMIN subscription model (Task 22):
 * - MEGA_ADMIN (software seller): distributor accounts banata hai, active/inactive karta hai,
 *   monthly subscription control karta hai — business data ka koi access nahi.
 * - DISTRIBUTOR (subscriber): apna poora business portal — inactive/expired subscription par login BLOCK.
 * - SALESMAN (order booker): distributor ki team — us ka distributor band ho to ye bhi
 *   login nahi kar sakta (subscription poori team par lagti hai).
 */

interface GateUser {
  id: string
  role: string
  isActive: boolean
  subscriptionExpiry: Date | null
  parentId: string | null
}

function expired(u: GateUser): boolean {
  return !!u.subscriptionExpiry && u.subscriptionExpiry.getTime() < Date.now()
}

/** Distributor account gate — null = OK, warna error message */
function distributorGate(u: GateUser): string | null {
  if (!u.isActive) {
    return 'Aap ka distributor account INACTIVE hai — subscription renew ke liye Mega Admin se rabta karein'
  }
  if (expired(u)) {
    return 'Aap ki monthly subscription khatam ho gayi hai — renew ke liye Mega Admin se rabta karein'
  }
  return null
}

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) return jsonError('Email aur password required hai')

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { profile: true, parent: { select: { name: true } } },
    })
    if (!user) return jsonError('Invalid credentials - ye email registered nahi hai', 401)
    if (user.password !== password) return jsonError('Invalid credentials', 401)

    // ---- Subscription gate ----
    if (user.role === 'DISTRIBUTOR') {
      const msg = distributorGate(user)
      if (msg) return jsonError(msg, 403)
    } else if (user.role === 'SALESMAN') {
      // team member: owner distributor tak walk-up (max 3 levels)
      let cursorId = user.parentId
      let hops = 0
      while (cursorId && hops < 3) {
        const owner = await db.user.findUnique({ where: { id: cursorId } })
        if (!owner) break
        if (owner.role === 'DISTRIBUTOR') {
          const msg = distributorGate(owner)
          if (msg) return jsonError(`${owner.name}: ${msg}`, 403)
          break
        }
        cursorId = owner.parentId
        hops++
      }
    }

    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        region: user.region,
        parentName: user.parent?.name ?? null,
        isActive: user.isActive,
        subscriptionExpiry: user.subscriptionExpiry ? user.subscriptionExpiry.toISOString() : null,
        profile: user.profile
          ? {
              id: user.profile.id,
              businessName: user.profile.businessName,
              city: user.profile.city,
              region: user.profile.region,
              tier: user.profile.tier,
              creditLimit: user.profile.creditLimit,
            }
          : null,
      },
    })
  } catch {
    return jsonError('Login failed', 500)
  }
}
