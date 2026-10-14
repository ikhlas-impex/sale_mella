import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage, supabase } from '../lib/supabase'

type Mode = 'login' | 'register'

const UserIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
  </svg>
)
const MailIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5Z" />
  </svg>
)
const LockIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M17 9V7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2ZM9 7a3 3 0 0 1 6 0v2H9Z" />
  </svg>
)

function Field({ icon, ...props }: { icon: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <input
        {...props}
        className="w-full rounded-full border-2 border-white/40 bg-transparent py-3 pr-12 pl-6 text-white placeholder-white/80 outline-none focus:border-white"
      />
      <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-white">{icon}</span>
    </div>
  )
}

export default function Login() {
  const { session } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/challan/new" replace />

  const switchMode = (m: Mode) => {
    setMode(m)
    setError('')
    setNotice('')
    setPassword('')
    setConfirm('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')

    if (mode === 'register') {
      if (password.length < 6) return setError('Password must be at least 6 characters')
      if (password !== confirm) return setError('Passwords do not match')
    }

    setBusy(true)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(errorMessage(error))
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: window.location.origin },
      })
      if (error) setError(errorMessage(error))
      else if (!data.session) {
        // Email confirmation is switched on in Supabase
        switchMode('login')
        setNotice('Account created. Check your email to confirm it, then sign in. An admin will approve your access.')
      }
      // With email confirmation off, the new session signs them in and they see the approval screen
    }
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-700 to-fuchsia-600 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-white/20 bg-white/10 p-8 text-white shadow-2xl backdrop-blur-md"
      >
        <div className="text-center">
          <h1 className="text-3xl font-bold">{mode === 'login' ? 'Login' : 'Register'}</h1>
          <p className="mt-1 text-sm text-white/70">Elkitch Mega Sale · Delivery Challan</p>
        </div>

        {mode === 'register' && (
          <Field
            icon={UserIcon}
            placeholder="Full name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        )}
        <Field
          icon={mode === 'login' ? UserIcon : MailIcon}
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          icon={LockIcon}
          type="password"
          placeholder="Password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === 'register' && (
          <Field
            icon={LockIcon}
            type="password"
            placeholder="Confirm password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}

        {error && <p className="rounded-lg bg-rose-500/30 px-4 py-2 text-sm">{error}</p>}
        {notice && <p className="rounded-lg bg-emerald-500/30 px-4 py-2 text-sm">{notice}</p>}

        <button
          className="w-full rounded-full bg-white py-3 font-semibold text-purple-800 shadow transition hover:bg-white/90 disabled:opacity-60"
          disabled={busy}
        >
          {busy ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create account'}
        </button>

        <p className="text-center text-sm">
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button type="button" className="font-bold hover:underline" onClick={() => switchMode('register')}>
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className="font-bold hover:underline" onClick={() => switchMode('login')}>
                Login
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  )
}
