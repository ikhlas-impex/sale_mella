import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3">
          <div className="mr-4 text-lg font-bold text-indigo-700">Elkitch Mega Sale</div>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/challan/new" className={linkClass}>
              New Challan
            </NavLink>
            <NavLink to="/challans" className={linkClass} end>
              Challans
            </NavLink>
            {isAdmin && (
              <>
                <NavLink to="/products" className={linkClass}>
                  Master Data
                </NavLink>
                <NavLink to="/users" className={linkClass}>
                  Users
                </NavLink>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {profile?.full_name || profile?.email}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${isAdmin ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
              >
                {profile?.role}
              </span>
            </span>
            <button className="btn-secondary py-1.5" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
