// Supabase Edge Function: lets an admin create a new user profile.
// Deploy: supabase functions deploy admin-create-user
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Verify the caller is a signed-in admin
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin')
  if (adminErr || !isAdmin) return json({ error: 'Admin permission required' }, 403)

  const { email, password, full_name, role } = await req.json().catch(() => ({}))
  if (!email || !password || String(password).length < 6) {
    return json({ error: 'Email and a password of at least 6 characters are required' }, 400)
  }

  const admin = createClient(url, serviceKey)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name ?? '' },
    app_metadata: { role: role === 'admin' ? 'admin' : 'user', approved: true },
  })
  if (error) return json({ error: error.message }, 400)

  return json({ id: data.user?.id })
})
