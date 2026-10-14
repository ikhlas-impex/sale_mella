// Supabase Edge Function: read a photo of a handwritten Elkitch delivery challan
// with Claude (vision + structured output) and return fields to prefill the form.
// Particulars are matched to the product master list.
//
// Setup:
//   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   npx supabase functions deploy scan-challan
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Nullable fields use anyOf (supported by structured outputs)
const num = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const str = { anyOf: [{ type: 'string' }, { type: 'null' }] }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dc_no', 'date', 'customer_name', 'customer_details', 'items', 'cash_amount', 'bank_amount', 'grand_total', 'notes'],
  properties: {
    dc_no: { ...str, description: 'The challan number printed/written next to "No." (digits only as written, e.g. "2812")' },
    date: { ...str, description: 'Challan date as YYYY-MM-DD. Handwritten dates are day/month/year (Indian format).' },
    customer_name: { ...str, description: 'Name written after "M/s"' },
    customer_details: { ...str, description: 'Any other text on the M/s lines or Party Mob. line (phone, address, account no.)' },
    items: {
      type: 'array',
      description: 'Line items in order. EXCLUDE rows that are struck through / crossed out.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['particulars', 'product_id', 'quantity', 'weight', 'rate', 'amount', 'confidence'],
        properties: {
          particulars: { type: 'string', description: 'Item text exactly as handwritten' },
          product_id: { ...str, description: 'id of the best matching master product, or null if no reasonable match' },
          quantity: { ...num, description: 'Qty column' },
          weight: { ...num, description: 'Unit column (weight in kg, e.g. .885 or 1.780); null if blank' },
          rate: { ...num, description: 'Rate column' },
          amount: { ...num, description: 'Amount column' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence in the product match and numbers' },
        },
      },
    },
    cash_amount: { ...num, description: 'Amount written next to "Cash", if any' },
    bank_amount: { ...num, description: 'Amount written next to "Bank" / UPI / card, if any' },
    grand_total: { ...num, description: 'GRAND TOTAL (if corrected, the final un-struck value)' },
    notes: { ...str, description: 'Anything unclear the person checking should know, in one short sentence; null if nothing' },
  },
}

const SYSTEM = `You read photos of handwritten "DELIVERY CHALLAN" pages from ELKITCH PRIVATE LIMITED's challan book and extract them as data.

Page layout: printed "No." with a red challan number; "Date"; "M/s" customer lines; "Party Mob."; a table with columns Sl. No. | Particulars | HSN Code | Qty | Unit | Rate | Amount; "GRAND TOTAL" at the bottom. Payment split is often handwritten under the items, e.g. "Cash 2250" and "Bank 975".

Rules:
- The "Unit" column holds the WEIGHT in kg (e.g. ".885", "1.780"), not a unit name. Rate is price per kg for weighed items; Amount ≈ weight × rate.
- Items without a weight are priced per piece: Amount ≈ Qty × Rate (Rate may be blank).
- Skip any row that is crossed out or struck through. Use corrected (un-struck) values when a number was overwritten.
- Match each Particulars text to one product from the master list. Handwriting uses short forms (e.g. "NS SP 240", "SS cooker 5L", "lid 240"). Prefer the product whose name, size and type agree. If nothing fits, set product_id to null - never invent an id.
- Dates are day/month/year; a 2-digit year means 20YY.
- Use null for anything you cannot read. Do not guess numbers.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set for this function' }, 500)

  // Only signed-in, approved users may scan
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: approved, error: authErr } = await supabase.rpc('is_approved')
  if (authErr || !approved) return json({ error: 'Not allowed' }, 403)

  const { image, media_type } = await req.json().catch(() => ({}))
  if (typeof image !== 'string' || !image) return json({ error: 'image (base64) is required' }, 400)
  if (image.length > 7_000_000) return json({ error: 'Image too large – please retake the photo' }, 413)
  const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(media_type) ? media_type : 'image/jpeg'

  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, unit, price_basis, price')
    .eq('active', true)
    .order('name')
  if (prodErr) return json({ error: prodErr.message }, 500)

  const productList = (products ?? [])
    .map((p) => `${p.id} | ${p.name} | ${p.price_basis === 'weight' ? 'per kg' : `per ${p.unit}`} | ${p.price}`)
    .join('\n')

  const client = new Anthropic({ apiKey })

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Product master list (id | name | priced | price):\n${productList}` },
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: 'Extract this challan.' },
          ],
        },
      ],
    } as never)

    if (response.stop_reason === 'refusal') return json({ error: 'The photo could not be read. Please enter it manually.' }, 422)
    if (response.stop_reason === 'max_tokens') return json({ error: 'The photo could not be read completely.' }, 422)

    const text = response.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined
    if (!text) return json({ error: 'No result from the reader' }, 502)
    return json(JSON.parse(text.text))
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'Too many scans right now – try again in a minute' }, 429)
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY is invalid' }, 500)
    if (err instanceof Anthropic.APIError) return json({ error: `Reader error ${err.status}: ${err.message}` }, 502)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
