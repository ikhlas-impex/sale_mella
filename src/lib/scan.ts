// Scan a photo of a paper challan: the photo is shrunk in the browser and sent to
// the scan-challan Edge Function, which reads it with Google Gemini (free tier)
// and matches items to master data. Results are a draft for the user to check.
import { supabase } from './supabase'

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
  /** Bank/UPI transaction reference written on the sheet; present means paid by bank */
  utr: string | null
  customer_details: string | null
  items: ScannedItem[]
  cash_amount: number | null
  bank_amount: number | null
  grand_total: number | null
  notes: string | null
}

/** Shrink a phone photo to max 2000px JPEG so uploads are quick but handwriting stays readable. */
async function compress(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

export async function scanChallan(file: File): Promise<ScanResult> {
  const image = await compress(file)
  const { data, error } = await supabase.functions.invoke('scan-challan', {
    body: { image, media_type: 'image/jpeg' },
  })
  if (error || data?.error) {
    let msg: string = data?.error ?? error?.message ?? 'Scan failed'
    // FunctionsHttpError carries the JSON body in context
    const ctx = (error as { context?: Response } | null)?.context
    if (ctx && typeof ctx.json === 'function') {
      try {
        msg = (await ctx.json()).error ?? msg
      } catch {
        /* ignore */
      }
    }
    if (/failed to send a request|not found/i.test(msg))
      msg += ' – is the "scan-challan" Edge Function deployed? (npx supabase functions deploy scan-challan)'
    throw new Error(msg)
  }
  const result = data as ScanResult
  return { ...result, items: result.items ?? [] }
}
