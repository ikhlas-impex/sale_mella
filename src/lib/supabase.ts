import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

/** Public address used in email links. Pinned so links never point at a protected per-deployment Vercel URL. */
export const siteUrl = ((import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin).replace(/\/$/, '')

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing-key')

/** Turn a Supabase/Postgres error into a readable message. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}
