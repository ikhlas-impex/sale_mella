import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage, supabase } from '../lib/supabase'
import type { Profile, Role } from '../lib/types'

const blank = { email: '', password: '', full_name: '', role: 'user' as Role }

export default function Users() {
  const { profile: me } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [form, setForm] = useState(blank)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at')
    if (error) setError(errorMessage(error))
    else setUsers((data ?? []) as Profile[])
  }

  useEffect(() => {
    load()
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error } = await supabase.functions.invoke('admin-create-user', { body: form })
    setBusy(false)
    if (error || data?.error) {
      let msg = data?.error ?? errorMessage(error)
      // FunctionsHttpError carries the JSON body in context
      const ctx = (error as { context?: Response } | null)?.context
      if (ctx && typeof ctx.json === 'function') {
        try {
          msg = (await ctx.json()).error ?? msg
        } catch {
          /* ignore */
        }
      }
      setError(msg)
      return
    }
    setNotice(`User ${form.email} created`)
    setForm(blank)
    load()
  }

  const update = async (u: Profile, patch: Partial<Pick<Profile, 'full_name' | 'role'>>) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', u.id)
    if (error) setError(errorMessage(error))
    else load()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-slate-500">
          Each challan is recorded against the user who entered it. Admins can manage master data and users.
        </p>
      </div>

      <form onSubmit={create} className="card grid items-end gap-3 sm:grid-cols-5">
        <div>
          <label className="label">Full name</label>
          <input
            className="input"
            required
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="text"
            minLength={6}
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Role</label>
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create user'}
        </button>
      </form>

      {notice && <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">✓ {notice}</div>}
      {error && <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[600px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Email</th>
              <th className="th">Role</th>
              <th className="th">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="td">
                  <input
                    className="input"
                    defaultValue={u.full_name}
                    onBlur={(e) => e.target.value !== u.full_name && update(u, { full_name: e.target.value })}
                  />
                </td>
                <td className="td text-slate-600">{u.email}</td>
                <td className="td">
                  <select
                    className="input"
                    value={u.role}
                    disabled={u.id === me?.id}
                    title={u.id === me?.id ? 'You cannot change your own role' : ''}
                    onChange={(e) => update(u, { role: e.target.value as Role })}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="td text-slate-500">{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
