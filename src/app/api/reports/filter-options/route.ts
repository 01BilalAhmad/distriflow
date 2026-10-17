import { jsonError } from '@/lib/dms-scope'
import { distributorGuard, bookerList, companyList } from '@/lib/reports-kit-server'

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
    const url = new URL(req.url)
    const g = await distributorGuard(url.searchParams.get('userId'))
    if (g instanceof Response) return g
    const { profileId } = g
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
