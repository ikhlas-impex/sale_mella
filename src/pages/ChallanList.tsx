import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { CHALLAN_SELECT, exportChallans } from '../lib/excel'
import { fmtMoney, today } from '../lib/format'
import { errorMessage, supabase } from '../lib/supabase'
import type { Challan } from '../lib/types'

const FETCH_BATCH = 1000
const PAGE_SIZE = 200

export default function ChallanList() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<Challan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [shown, setShown] = useState(PAGE_SIZE)
  const requestId = useRef(0)

  // Supabase returns at most 1000 rows per request, so fetch in pages until everything is loaded.
  // Totals and Excel export use all rows; the table renders PAGE_SIZE at a time.
  const load = useCallback(async () => {
    const myRequest = ++requestId.current
    setLoading(true)
    const term = search.trim().replace(/[,()]/g, ' ')
    const all: Challan[] = []
    for (let offset = 0; ; offset += FETCH_BATCH) {
      let q = supabase
        .from('challans')
        .select(CHALLAN_SELECT)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + FETCH_BATCH - 1)
      if (from) q = q.gte('dc_date', from)
      if (to) q = q.lte('dc_date', to)
      if (term) q = q.or(`dc_no.ilike.%${term}%,customer_name.ilike.%${term}%`)
      const { data, error } = await q
      if (myRequest !== requestId.current) return // a newer search/filter started
      if (error) {
        setError(errorMessage(error))
        setLoading(false)
        return
      }
      const batch = (data ?? []) as unknown as Challan[]
      all.push(...batch)
      if (batch.length < FETCH_BATCH) break
    }
    setError('')
    setRows(all)
    setShown(PAGE_SIZE)
    setLoading(false)
  }, [from, to, search])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  const remove = async (c: Challan) => {
    if (!confirm(`Delete challan ${c.dc_no}? This cannot be undone.`)) return
    const { error } = await supabase.from('challans').delete().eq('id', c.id)
    if (error) setError(errorMessage(error))
    else load()
  }

  const totals = rows.reduce(
    (t, c) => ({
      final: t.final + Number(c.final_amount),
      cash: t.cash + Number(c.cash_amount),
      bank: t.bank + Number(c.bank_amount),
    }),
    { final: 0, cash: 0, bank: 0 },
  )

  // Highlight any DC No. that appears more than once (e.g. legacy data)
  const dcCounts = rows.reduce<Record<string, number>>((m, c) => {
    const k = c.dc_no.trim().toUpperCase()
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Delivery Challans</h1>
        <div className="ml-auto flex gap-2">
          <button
            className="btn-success"
            disabled={rows.length === 0}
            onClick={() => exportChallans(rows, `challans_${from || 'all'}_${to || today()}`)}
          >
            ⬇ Export to Excel
          </button>
          <Link to="/challan/new" className="btn-primary">
            + New Challan
          </Link>
        </div>
      </div>

      <div className="card grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="DC No. or Name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="label">From</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Challans', String(rows.length)],
          ['Total', fmtMoney(totals.final)],
          ['Cash', fmtMoney(totals.cash)],
          ['Bank', fmtMoney(totals.bank)],
        ].map(([k, v]) => (
          <div key={k} className="card py-3 sm:py-3">
            <div className="text-xs font-semibold text-slate-500 uppercase">{k}</div>
            <div className="font-mono text-lg font-bold">{v}</div>
          </div>
        ))}
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">DC No.</th>
              <th className="th">Date</th>
              <th className="th">Name</th>
              <th className="th text-right">Items</th>
              <th className="th text-right">Final Amount</th>
              <th className="th">Payment</th>
              <th className="th">Entered by</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="td py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="td py-8 text-center text-slate-500">
                  No challans found
                </td>
              </tr>
            )}
            {rows.slice(0, shown).map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="td font-mono font-semibold">
                  {c.dc_no}
                  {dcCounts[c.dc_no.trim().toUpperCase()] > 1 && (
                    <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                      DUPLICATE
                    </span>
                  )}
                </td>
                <td className="td">{c.dc_date}</td>
                <td className="td">
                  {c.customer_name}
                  {c.remarks && (
                    <div className="max-w-xs truncate text-xs text-slate-400" title={c.remarks}>
                      {c.remarks}
                    </div>
                  )}
                </td>
                <td className="td text-right">{c.challan_items?.length ?? 0}</td>
                <td className="td text-right font-mono">{fmtMoney(c.final_amount)}</td>
                <td className="td">
                  {c.is_split ? (
                    <span title={`Cash ${fmtMoney(c.cash_amount)} / Bank ${fmtMoney(c.bank_amount)}`}>Split</span>
                  ) : c.payment_mode === 'cash' ? (
                    'Cash'
                  ) : (
                    'Bank'
                  )}
                </td>
                <td className="td text-slate-600">
                  {c.creator?.full_name}
                  {c.editor && c.editor.full_name !== c.creator?.full_name && (
                    <div className="text-xs text-slate-400">edited by {c.editor.full_name}</div>
                  )}
                </td>
                <td className="td whitespace-nowrap text-right">
                  <Link to={`/challan/${c.id}`} className="font-medium text-indigo-600 hover:underline">
                    Edit
                  </Link>
                  {isAdmin && (
                    <button className="ml-3 font-medium text-rose-600 hover:underline" onClick={() => remove(c)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > shown && (
          <div className="flex items-center justify-between border-t border-slate-100 p-3 text-sm text-slate-500">
            Showing {shown} of {rows.length} challans (totals and export include all)
            <button className="btn-secondary" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Show more
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
