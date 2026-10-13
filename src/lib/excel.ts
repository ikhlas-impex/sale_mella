import type { Challan } from './types'

const paymentLabel = (c: Challan) => (c.is_split ? 'Split' : c.payment_mode === 'cash' ? 'Cash' : 'Bank')

/** Flatten challans to raw rows: one row per line item, header & payment repeated. */
export function challanRows(challans: Challan[]) {
  return challans.flatMap((c) =>
    (c.challan_items ?? [])
      .slice()
      .sort((a, b) => a.sl_no - b.sl_no)
      .map((i) => ({
        'DC No': c.dc_no,
        Date: c.dc_date,
        Name: c.customer_name,
        'Sl No': i.sl_no,
        Particulars: i.product_name,
        Weight: i.weight ?? '',
        Quantity: Number(i.quantity),
        Price: Number(i.price),
        Amount: Number(i.amount),
        'Sub Total': Number(c.sub_total),
        Discount: Number(c.discount),
        'Final Amount': Number(c.final_amount),
        'Payment Mode': paymentLabel(c),
        Cash: Number(c.cash_amount),
        Bank: Number(c.bank_amount),
        'Entered By': c.creator?.full_name ?? '',
        'Last Edited By': c.editor?.full_name ?? '',
        'Created At': new Date(c.created_at).toLocaleString(),
        'Updated At': new Date(c.updated_at).toLocaleString(),
      })),
  )
}

export async function exportChallans(challans: Challan[], fileName: string) {
  // Loaded on demand so the spreadsheet library is not in the main bundle
  const { utils, writeFile } = await import('xlsx')
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.json_to_sheet(challanRows(challans)), 'Challan Items')
  utils.book_append_sheet(
    wb,
    utils.json_to_sheet(
      challans.map((c) => ({
        'DC No': c.dc_no,
        Date: c.dc_date,
        Name: c.customer_name,
        'Sub Total': Number(c.sub_total),
        Discount: Number(c.discount),
        'Final Amount': Number(c.final_amount),
        'Payment Mode': paymentLabel(c),
        Cash: Number(c.cash_amount),
        Bank: Number(c.bank_amount),
        'Entered By': c.creator?.full_name ?? '',
      })),
    ),
    'Challans',
  )
  writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`)
}

/** Select string that loads a challan with items and user names. */
export const CHALLAN_SELECT =
  '*, challan_items(*), creator:profiles!challans_created_by_fkey(full_name), editor:profiles!challans_updated_by_fkey(full_name)'
