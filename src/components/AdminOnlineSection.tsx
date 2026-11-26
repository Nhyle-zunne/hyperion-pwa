import type { ReactNode } from 'react'
import { useOfflineAdminAccess, useOnlineStatus } from '../hooks/useOfflineAdminAccess'
import AdminNavigation from './AdminNavigation'

export default function AdminOnlineSection({ title, children }: { title: string; children: ReactNode }) {
  const online = useOnlineStatus()
  const access = useOfflineAdminAccess(!online)
  if (online) return children

  return <section className="screen">
    {access.allowed && <AdminNavigation />}
    <h1>{title}</h1>
    <p role="status">{!access.checked ? 'Checking your saved admin pass…' : 'Reconnect to manage this section.'}</p>
  </section>
}
