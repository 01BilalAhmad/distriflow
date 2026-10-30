import { PostedSummariesView } from '@/components/dms/posted-summaries-view'

// Task 33 — posted (settled) summaries ki history apna poora page — user: "settled
// summaries side pr aa rhi hn in ka alg page bnao jis ka name hoga posted ya settled
// summaries". Settlement page ab sirf unsettled ka kaam karta hai (kam crowding).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Posted Summaries — DistriFlow' }

export default function PostedSummariesPage() {
  return <PostedSummariesView />
}
