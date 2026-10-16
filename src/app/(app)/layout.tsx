import { DMSApp } from '@/components/dms/app-shell'

// Task 65 — har section ka apna alag page: ye shared shell layout hai jo (app)
// group ke sab routes par chalta hai (top nav + session/role guards + children).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <DMSApp>{children}</DMSApp>
}
