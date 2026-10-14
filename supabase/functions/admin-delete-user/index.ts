// Supabase Edge Function: lets an admin remove a user.
// Users with no challans are deleted; users with challan history are disabled
// (login banned, access revoked) so their name stays on old challans.
// Deploy: supabase functions deploy admin-delete-user
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
  const { data: me } = await caller.auth.getUser()

  const { user_id } = await req.json().catch(() => ({}))
  if (!user_id) return json({ error: 'user_id is required' }, 400)
  if (user_id === me.user?.id) return json({ error: 'You cannot delete your own account' }, 400)

  const admin = createClient(url, serviceKey)

  const { count, error: countErr } = await admin
    .from('challans')
    .select('id', { count: 'exact', head: true })
    .or(`created_by.eq.${user_id},updated_by.eq.${user_id}`)
  if (countErr) return json({ error: countErr.message }, 500)

  if (!count) {
    const { error } = await admin.auth.admin.deleteUser(user_id)
    if (error) return json({ error: error.message }, 400)
    return json({ mode: 'deleted' })
  }

  const { error: banErr } = await admin.auth.admin.updateUserById(user_id, { ban_duration: '876000h' })
  if (banErr) return json({ error: banErr.message }, 400)
  const { error: profErr } = await admin
    .from('profiles')
    .update({ disabled: true, approved: false, role: 'user' })
    .eq('id', user_id)
  if (profErr) return json({ error: profErr.message }, 400)

  return json({ mode: 'disabled', challans: count })
})
