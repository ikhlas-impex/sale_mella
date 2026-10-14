// Free, on-device scan of a paper challan photo.
// Tesseract.js runs OCR in the browser (nothing is uploaded except the one-time
// download of the OCR engine), then a local parser maps the text onto the
// Elkitch delivery-challan layout and matches items to master data.
// Handwriting accuracy is limited, so every result is a draft for the user to check.
import type { Product } from './types'

export interface ScannedItem {
  particulars: string
  product_id: string | null
  quantity: number | null
  weight: number | null
  rate: number | null
  amount: number | null
  confidence: 'high' | 'medium' | 'low'
}

export interface ScanResult {
  dc_no: string | null
  date: string | null
  customer_name: string | null
  customer_details: string | null
  items: ScannedItem[]
  cash_amount: number | null
  bank_amount: number | null
  grand_total: number | null
  notes: string | null
  raw_text: string
}

/** Grayscale + contrast stretch + max 2000px: helps OCR on coloured (pink) challan paper. */
async function prepare(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  let min = 255
  let max = 0
  for (let i = 0; i < d.length; i += 4) {
    // Ink (blue/black) is dark in the red channel-weighted gray; pink paper goes light
    const g = 0.5 * d[i] + 0.35 * d[i + 1] + 0.15 * d[i + 2]
    d[i] = g
    if (g < min) min = g
    if (g > max) max = g
  }
  const range = Math.max(max - min, 1)
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) / range) * 255
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

// ----- fuzzy product matching ------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function bigrams(s: string) {
  const out = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2)
    out.set(b, (out.get(b) ?? 0) + 1)
  }
  return out
}

/** Dice similarity on character bigrams, 0..1 */
function similarity(a: string, b: string) {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const bx = bigrams(x)
  const by = bigrams(y)
  let overlap = 0
  for (const [k, n] of bx) overlap += Math.min(n, by.get(k) ?? 0)
  return (2 * overlap) / (Math.max(x.length - 1, 1) + Math.max(y.length - 1, 1))
}

function bestProduct(text: string, products: Product[]) {
  let best: Product | null = null
  let score = 0
  for (const p of products) {
    const s = similarity(text, p.name)
    if (s > score) {
      score = s
      best = p
    }
  }
  return { product: best, score }
}

// ----- text parsing -----------------------------------------------------------
/** Read a number token, tolerating common OCR slips (O→0, l/I→1, comma decimals). */
function toNumber(tok: string): number | null {
  const t = tok.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(',', '.').replace(/[^\d.]/g, '')
  if (!t || t === '.' || !/\d/.test(t)) return null
  const n = Number(t.startsWith('.') ? `0${t}` : t)
  return Number.isFinite(n) ? n : null
}
const isNumTok = (tok: string) => /^[\dOolI|.,]+$/.test(tok) && /\d/.test(tok)

function parseItemLine(line: string, products: Product[]): ScannedItem | null {
  const tokens = line.split(/\s+/).filter(Boolean)
  let tail = 0
  while (tail < tokens.length && isNumTok(tokens[tokens.length - 1 - tail])) tail++
  if (tail === tokens.length) return null // no words → not an item row

  // The item name can end in a number ("SS SP 240"): try each split and keep the one whose name matches best
  let best: { name: string; nums: number[]; product: Product | null; score: number } | null = null
  for (let take = Math.min(tail, 4); take >= 0; take--) {
    const name = tokens.slice(0, tokens.length - take).join(' ')
    const nums = tokens
      .slice(tokens.length - take)
      .map(toNumber)
      .filter((n): n is number => n != null)
    const { product, score } = bestProduct(name, products)
    if (!best || score > best.score + 0.02) best = { name, nums, product, score }
  }
  if (!best || norm(best.name).length < 2) return null

  // Columns, right to left: Amount, Rate, Unit(weight, has a decimal point), Qty
  const nums = [...best.nums]
  const amount = nums.pop() ?? null
  let rate = nums.pop() ?? null
  let weight: number | null = null
  let quantity: number | null = null
  for (const n of nums) {
    if (!Number.isInteger(n) || n < 1) weight = n
    else quantity = n
  }
  // Per-piece rows often have only Qty and Amount ("lid 240 1 60"): a tiny "rate" is really the quantity
  if (weight == null && quantity == null && rate != null && Number.isInteger(rate) && rate <= 20) {
    quantity = rate
    rate = null
  }

  const matched = best.score >= 0.35 ? best.product : null
  return {
    particulars: best.name,
    product_id: matched?.id ?? null,
    quantity,
    weight,
    rate,
    amount,
    confidence: best.score >= 0.7 ? 'high' : best.score >= 0.5 ? 'medium' : 'low',
  }
}

function parseDate(text: string): string | null {
  const m = text.match(/(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2000
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseChallanText(text: string, products: Product[]): ScanResult {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const dateLine = lines.find((l) => /date/i.test(l)) ?? text
  const date = parseDate(dateLine) ?? parseDate(text)

  // Challan number: "No. 2812" (skip the address's "Plot No. 153/1")
  const dcMatch = text.match(/(?<!plot\s?)\bNo\.?\s*[:\-]?\s*([\dOolI]{3,6})\b(?!\s*\/)/i)
  const dc_no = dcMatch ? String(toNumber(dcMatch[1]) ?? '') || null : null

  const msIdx = lines.findIndex((l) => /\bM\s*\/\s*s\b/i.test(l))
  const clean = (s: string) => s.replace(/[.·…_]{2,}/g, ' ').replace(/\s+/g, ' ').trim()
  const customer_name = msIdx >= 0 ? clean(lines[msIdx].replace(/^.*?\bM\s*\/\s*s\b\.?\s*:?/i, '')) || null : null
  const detailLines = msIdx >= 0 ? lines.slice(msIdx + 1, msIdx + 3).filter((l) => !/particular|sl\.?\s*no/i.test(l)) : []
  const customer_details = clean(detailLines.join(' ').replace(/party\s*mob\.?\s*:?/i, 'Mob: ')) || null

  // Item rows sit between the table header and GRAND TOTAL / payment notes
  const start = lines.findIndex((l) => /particular|qty|rate|amount/i.test(l))
  const endRel = lines.slice(start + 1).findIndex((l) => /grand|total|cash|bank|signature|requester/i.test(l))
  const itemLines = start >= 0 ? lines.slice(start + 1, endRel >= 0 ? start + 1 + endRel : undefined) : []
  const activeProducts = products.filter((p) => p.active)
  const items = itemLines.map((l) => parseItemLine(l, activeProducts)).filter((i): i is ScannedItem => i != null)

  const grab = (re: RegExp) => {
    const m = text.match(re)
    return m ? toNumber(m[1]) : null
  }
  const cash_amount = grab(/cash\W{0,3}([\dOolI.,]{2,})/i)
  const bank_amount = grab(/bank\W{0,3}([\dOolI.,]{2,})/i)
  const grand_total = grab(/grand\s*total\W{0,3}([\dOolI.,]{2,})/i)

  return {
    dc_no,
    date,
    customer_name,
    customer_details,
    items,
    cash_amount,
    bank_amount,
    grand_total,
    notes: null,
    raw_text: text,
  }
}

export async function scanChallan(
  file: File,
  products: Product[],
  onProgress?: (pct: number) => void,
): Promise<ScanResult> {
  const [{ createWorker }, canvas] = await Promise.all([import('tesseract.js'), prepare(file)])
  const worker = await createWorker('eng', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100))
    },
  })
  try {
    const { data } = await worker.recognize(canvas)
    return parseChallanText(data.text, products)
  } finally {
    await worker.terminate()
  }
}
