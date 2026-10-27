import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { bookerList, companyList } from '@/lib/reports-kit-server'

// ============================================================
// Task 74 — FILTER-OPTIONS (light endpoint — filter-first reports)
// Report pages ab khulte hi heavy report query NAHI chalati —
// sirf ye chhota endpoint load hota hai jis se booker/company
// dropdowns barte hain. Actual report data tab fetch hota hai
// jab user filters set kar ke "Report Load Karein" dabata hai
// (useReportGate — reports-kit).
// ============================================================

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'DISTRIBUTOR') return jsonError('Reports sirf distributor account ke liye hain', 403)
    if (!user.profile) return jsonError('Distributor profile not found', 404)
    const profileId = user.profile.id
    const [bookers, companies] = await Promise.all([bookerList(profileId), companyList(profileId)])
    return Response.json({
      bookers: bookers.map((b) => ({ id: b.id, label: b.name })),
      companies: companies.map((c) => ({ id: c.id, label: c.name })),
    })
  } catch (e) {
    console.error('reports/filter-options error', e)
    return jsonError('Filter options load nahi hue', 500)
  }
}
