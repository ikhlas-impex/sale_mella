import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import Layout from './components/Layout'
import { isConfigured } from './lib/supabase'
import ChallanForm from './pages/ChallanForm'
import ChallanList from './pages/ChallanList'
import Login from './pages/Login'
import Products from './pages/Products'
import Users from './pages/Users'

function Protected({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { session, profile, isAdmin, loading } = useAuth()
  if (loading) return <div className="p-8 text-center text-slate-500">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  if (!profile)
    return <div className="p-8 text-center text-rose-600">No profile found for this account. Ask an admin.</div>
  if (admin && !isAdmin) return <Navigate to="/challan/new" replace />
  return children
}

export default function App() {
  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <div className="card">
          <h1 className="mb-2 text-lg font-bold">Supabase not configured</h1>
          <p className="text-sm text-slate-600">
            Copy <code>.env.example</code> to <code>.env.local</code>, fill in <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route path="/challan/new" element={<ChallanForm key="new" />} />
            <Route path="/challan/:id" element={<ChallanForm />} />
            <Route path="/challans" element={<ChallanList />} />
            <Route
              path="/products"
              element={
                <Protected admin>
                  <Products />
                </Protected>
              }
            />
            <Route
              path="/users"
              element={
                <Protected admin>
                  <Users />
                </Protected>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/challan/new" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
