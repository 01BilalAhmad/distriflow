import { FieldForceView } from '@/components/dms/field-force-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Field Force — DistriFlow' }

export default function FieldForcePage() {
  return <FieldForceView />
}
