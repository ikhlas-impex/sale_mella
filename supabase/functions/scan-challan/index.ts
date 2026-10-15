// Supabase Edge Function: read a photo of a handwritten Elkitch delivery challan
// with Google Gemini (free tier) and return fields to prefill the form.
// Particulars are matched to the product master list.
//
// Setup (free key from https://aistudio.google.com/apikey):
//   npx supabase secrets set GEMINI_API_KEY=...
//   npx supabase functions deploy scan-challan
// Optional: npx supabase secrets set GEMINI_MODEL=gemini-3.6-flash  (default gemini-3.8-flash)
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Gemini responseSchema (OpenAPI subset)
const nStr = (description: string) => ({ type: 'STRING', nullable: true, description })
const nNum = (description: string) => ({ type: 'NUMBER', nullable: true, description })

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    dc_no: nStr('Challan number printed/written next to "No." (digits as written, e.g. "2812"). Not the Plot No. in the address.'),
    date: nStr('Challan date as YYYY-MM-DD. Handwritten dates are day/month/year (Indian format).'),
    customer_name: nStr('Name written after "M/s"'),
    customer_details: nStr('Other text on the M/s lines or Party Mob. line (phone, address, account no.)'),
    items: {
      type: 'ARRAY',
      description: 'Line items in order. EXCLUDE rows that are struck through / crossed out.',
      items: {
        type: 'OBJECT',
        properties: {
          particulars: { type: 'STRING', description: 'Item text exactly as handwritten' },
          product_id: nStr('id of the best matching master product, or null if no reasonable match'),
          quantity: nNum('Qty column'),
          weight: nNum('Unit column = weight in kg (e.g. 0.885, 1.780); null if blank'),
          rate: nNum('Rate column'),
          amount: nNum('Amount column'),
          confidence: { type: 'STRING', enum: ['high', 'medium', 'low'], description: 'Confidence in match and numbers' },
        },
        required: ['particulars', 'product_id', 'quantity', 'weight', 'rate', 'amount', 'confidence'],
      },
    },
    cash_amount: nNum('Amount written next to "Cash", if any'),
    bank_amount: nNum('Amount written next to "Bank" / UPI / card, if any'),
    grand_total: nNum('GRAND TOTAL (if corrected, the final un-struck value)'),
    notes: nStr('Anything unclear the checker should know, one short sentence; null if nothing'),
  },
  required: ['dc_no', 'date', 'customer_name', 'customer_details', 'items', 'cash_amount', 'bank_amount', 'grand_total', 'notes'],
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

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return json({ error: 'GEMINI_API_KEY is not set for this function' }, 500)
  // Preferred model first, then other free Flash models if it is busy or out of free quota
  const models = [
    ...new Set([Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']),
  ]

  // Only signed-in, approved users may scan
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: approved, error: authErr } = await supabase.rpc('is_approved')
  if (authErr || !approved) return json({ error: 'Not allowed' }, 403)

  const { image, media_type } = await req.json().catch(() => ({}))
  if (typeof image !== 'string' || !image) return json({ error: 'image (base64) is required' }, 400)
  if (image.length > 7_000_000) return json({ error: 'Image too large – please retake the photo' }, 413)
  const mimeType = ['image/jpeg', 'image/png', 'image/webp'].includes(media_type) ? media_type : 'image/jpeg'

  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, unit, price_basis, price')
    .eq('active', true)
    .order('name')
  if (prodErr) return json({ error: prodErr.message }, 500)

  const productList = (products ?? [])
    .map((p) => `${p.id} | ${p.name} | ${p.price_basis === 'weight' ? 'per kg' : `per ${p.unit}`} | ${p.price}`)
    .join('\n')

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        role: 'user',
        parts: [
          { text: `Product master list (id | name | priced | price):
${productList}` },
          { inline_data: { mime_type: mimeType, data: image } },
          { text: 'Extract this challan.' },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  })

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let res: Response | null = null
  let lastStatus = 0
  let lastDetail = ''
  outer: for (const model of models) {
    // Busy (503) / server error (500): retry the same model twice with a short wait.
    // Out of free quota (429) or model unavailable (404): move straight to the next model.
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
      })
      if (r.ok) {
        res = r
        break outer
      }
      lastStatus = r.status
      lastDetail = (await r.text()).slice(0, 300)
      console.warn(`scan-challan: ${model} attempt ${attempt + 1} -> ${r.status}`)
      if (r.status === 503 || r.status === 500) {
        if (attempt < 2) await sleep(1500 * (attempt + 1))
        continue
      }
      if (r.status === 429 || r.status === 404) continue outer
      return json({ error: `Gemini error ${r.status}: ${lastDetail}` }, 502)
    }
  }

  if (!res) {
    if (lastStatus === 429)
      return json({ error: 'Free scan limit reached for now. It resets daily at 12:30 PM IST – please type this challan.' }, 429)
    if (lastStatus === 503 || lastStatus === 500)
      return json({ error: "Google's free reader is busy right now. Please try again in a minute, or type this challan." }, 503)
    return json({ error: `Gemini error ${lastStatus}: ${lastDetail}` }, 502)
  }

  const out = await res.json()
  const cand = out.candidates?.[0]
  const text = (cand?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('')
    .trim()
  if (!text) {
    const reason = cand?.finishReason ?? out.promptFeedback?.blockReason ?? 'unknown'
    return json({ error: `The photo could not be read (${reason}). Please enter it manually.` }, 422)
  }

  try {
    return json(JSON.parse(text))
  } catch {
    return json({ error: 'The photo could not be read completely. Please try a clearer photo.' }, 422)
  }
})
