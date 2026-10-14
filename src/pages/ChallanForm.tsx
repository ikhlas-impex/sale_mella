import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import ProductPicker from '../components/ProductPicker'
import { CHALLAN_SELECT, exportChallans } from '../lib/excel'
import { fmtMoney, round2, toNum, today } from '../lib/format'
import { errorMessage, supabase } from '../lib/supabase'
import type { Challan, PaymentMode, Product } from '../lib/types'

interface Line {
  key: number
  product_id: string
  weight: string
  quantity: string
}

let lineKey = 0
const emptyLine = (): Line => ({ key: ++lineKey, product_id: '', weight: '', quantity: '' })

type DupState = 'idle' | 'checking' | 'ok' | 'duplicate'

export default function ChallanForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()

  const [products, setProducts] = useState<Product[]>([])
  const [dcNo, setDcNo] = useState('')
  const [dcDate, setDcDate] = useState(today())
  const [name, setName] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [discount, setDiscount] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash')
  const [isSplit, setIsSplit] = useState(false)
  const [cash, setCash] = useState('')
  const [bank, setBank] = useState('')
  const [meta, setMeta] = useState<Pick<Challan, 'creator' | 'editor' | 'created_at' | 'updated_at'> | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState((location.state as { saved?: string } | null)?.saved ?? '')
  const [dup, setDup] = useState<DupState>('idle')

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  // ----- load master data + challan / new DC number -------------------------
  const requestedDc = useRef(false)

  const fetchNextDc = useCallback(async () => {
    const { data, error } = await supabase.rpc('next_dc_no')
    if (error) setError(errorMessage(error))
    else setDcNo(data as string)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: prods, error: pErr } = await supabase.from('products').select('*').order('name')
      if (cancelled) return
      if (pErr) setError(errorMessage(pErr))
      setProducts((prods ?? []) as Product[])

      if (id) {
        const { data, error } = await supabase.from('challans').select(CHALLAN_SELECT).eq('id', id).single()
        if (cancelled) return
        if (error) {
          setError(errorMessage(error))
        } else {
          const c = data as unknown as Challan
          setDcNo(c.dc_no)
          setDcDate(c.dc_date)
          setName(c.customer_name)
          setDiscount(Number(c.discount) ? String(c.discount) : '')
          setPaymentMode(c.payment_mode)
          setIsSplit(c.is_split)
          setCash(c.is_split ? String(c.cash_amount) : '')
          setBank(c.is_split ? String(c.bank_amount) : '')
          setMeta({ creator: c.creator, editor: c.editor, created_at: c.created_at, updated_at: c.updated_at })
          const items = (c.challan_items ?? []).slice().sort((a, b) => a.sl_no - b.sl_no)
          setLines(
            items.length
              ? items.map((i) => ({
                  key: ++lineKey,
                  product_id: i.product_id,
                  weight: i.weight == null ? '' : String(i.weight),
                  quantity: String(i.quantity),
                }))
              : [emptyLine()],
          )
        }
      } else if (!requestedDc.current) {
        // DC No. is generated as soon as the form opens (guarded so StrictMode doesn't burn two numbers)
        requestedDc.current = true
        await fetchNextDc()
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id, fetchNextDc])

  // ----- live duplicate DC check ---------------------------------------------
  useEffect(() => {
    const value = dcNo.trim()
    if (!value) {
      setDup('idle')
      return
    }
    setDup('checking')
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('dc_exists', { p_dc_no: value, p_exclude_id: id ?? null })
      if (!error) setDup(data ? 'duplicate' : 'ok')
    }, 350)
    return () => clearTimeout(t)
  }, [dcNo, id])

  // ----- calculations --------------------------------------------------------
  const computed = lines.map((l) => {
    const p = productMap.get(l.product_id)
    const price = p ? Number(p.price) : 0
    const basis = p?.price_basis === 'weight' ? toNum(l.weight) : toNum(l.quantity)
    return { ...l, product: p, price, amount: round2(price * (basis ?? 0)) }
  })
  const subTotal = round2(computed.reduce((s, l) => s + l.amount, 0))
  const discountNum = toNum(discount) ?? 0
  const finalAmount = round2(subTotal - discountNum)
  const splitDiff = round2((toNum(cash) ?? 0) + (toNum(bank) ?? 0) - finalAmount)

  const usableLines = computed.filter((l) => l.product_id)
  const validationError =
    !dcNo.trim()
      ? 'DC No. is required'
      : dup === 'duplicate'
        ? 'This DC No. is already used – change it before submitting'
        : !name.trim()
          ? 'Name is required'
          : usableLines.length === 0
            ? 'Add at least one item'
            : discountNum < 0 || discountNum > subTotal
              ? 'Discount must be between 0 and the sub total'
              : isSplit && splitDiff !== 0
                ? `Split payment must add up to the final amount (difference ${fmtMoney(splitDiff)})`
                : ''

  // ----- line handlers -------------------------------------------------------
  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((l) => l.key !== key)))
  const [focusKey, setFocusKey] = useState<number | null>(null)
  const addLine = () => {
    const line = emptyLine()
    setFocusKey(line.key)
    setLines((ls) => [...ls, line])
  }

  // After picking an item, jump to the field its price is based on
  const pickProduct = (key: number, productId: string) => {
    updateLine(key, { product_id: productId })
    const field = productMap.get(productId)?.price_basis === 'weight' ? 'weight' : 'qty'
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-${field}="${key}"]`)?.focus())
  }

  const toggleSplit = (on: boolean) => {
    setIsSplit(on)
    if (on) {
      setCash(String(finalAmount))
      setBank('0')
    }
  }
  const onCashChange = (v: string) => {
    setCash(v)
    const n = toNum(v)
    if (n !== null) setBank(String(round2(Math.max(finalAmount - n, 0))))
  }

  // ----- actions -------------------------------------------------------------
  const resetForNew = async () => {
    setNotice('')
    setError('')
    setName('')
    setDcDate(today())
    setLines([emptyLine()])
    setDiscount('')
    setPaymentMode('cash')
    setIsSplit(false)
    setCash('')
    setBank('')
    setMeta(null)
    if (isEdit) navigate('/challan/new')
    else await fetchNextDc()
  }

  const submit = async () => {
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    const payload = {
      id: id ?? null,
      dc_no: dcNo.trim(),
      dc_date: dcDate,
      customer_name: name.trim(),
      discount: discountNum,
      payment_mode: paymentMode,
      is_split: isSplit,
      cash_amount: toNum(cash) ?? 0,
      bank_amount: toNum(bank) ?? 0,
      items: usableLines.map((l) => ({
        product_id: l.product_id,
        weight: toNum(l.weight),
        quantity: toNum(l.quantity) ?? 0,
      })),
    }
    const { data, error } = await supabase.rpc('save_challan', { payload })
    setSaving(false)
    if (error) {
      if (error.code === '23505') setDup('duplicate')
      setError(errorMessage(error))
      return
    }
    const msg = `Delivery challan ${payload.dc_no} saved`
    if (isEdit) {
      setNotice(msg)
      setMeta((m) => (m ? { ...m, updated_at: new Date().toISOString() } : m))
    } else {
      navigate(`/challan/${data}`, { replace: true, state: { saved: msg } })
    }
  }

  const exportCurrent = () => {
    const now = new Date().toISOString()
    const challan: Challan = {
      id: id ?? '',
      dc_no: dcNo,
      dc_date: dcDate,
      customer_name: name,
      sub_total: subTotal,
      discount: discountNum,
      final_amount: finalAmount,
      payment_mode: paymentMode,
      is_split: isSplit,
      cash_amount: isSplit ? (toNum(cash) ?? 0) : paymentMode === 'cash' ? finalAmount : 0,
      bank_amount: isSplit ? (toNum(bank) ?? 0) : paymentMode === 'bank' ? finalAmount : 0,
      created_by: session?.user.id ?? '',
      updated_by: null,
      created_at: meta?.created_at ?? now,
      updated_at: meta?.updated_at ?? now,
      creator: meta?.creator ?? null,
      editor: meta?.editor ?? null,
      challan_items: usableLines.map((l, i) => ({
        sl_no: i + 1,
        product_id: l.product_id,
        product_name: l.product?.name ?? '',
        weight: toNum(l.weight),
        quantity: toNum(l.quantity) ?? 0,
        price: l.price,
        amount: l.amount,
      })),
    }
    exportChallans([challan], `${dcNo || 'challan'}_${dcDate}`)
  }

  // Inactive products stay selectable only on lines that already use them
  const optionsFor = (current: string) => products.filter((p) => p.active || p.id === current)

  if (loading) return <div className="p-8 text-center text-slate-500">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{isEdit ? 'Edit Delivery Challan' : 'New Delivery Challan'}</h1>
        {meta && (
          <span className="text-xs text-slate-500">
            Entered by <b>{meta.creator?.full_name ?? '—'}</b>
            {meta.editor && (
              <>
                {' '}
                · last edited by <b>{meta.editor.full_name}</b> on {new Date(meta.updated_at).toLocaleString()}
              </>
            )}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={resetForNew}>
            + New
          </button>
          <Link to="/challans" className="btn-secondary">
            All challans
          </Link>
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✓ {notice}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Header */}
      <section className="card grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Delivery Challan No. (DC)</label>
          <input
            className={`input font-mono ${dup === 'duplicate' ? 'border-rose-500 bg-rose-50 focus:border-rose-500 focus:ring-rose-200' : ''}`}
            value={dcNo}
            onChange={(e) => setDcNo(e.target.value)}
          />
          <p className="mt-1 h-4 text-xs">
            {dup === 'checking' && <span className="text-slate-400">Checking…</span>}
            {dup === 'ok' && <span className="text-emerald-600">✓ Available</span>}
            {dup === 'duplicate' && <span className="font-semibold text-rose-600">⚠ Duplicate DC No. – already used</span>}
          </p>
        </div>
        <div>
          <label className="label">Date</label>
          <input className="input" type="date" value={dcDate} onChange={(e) => setDcDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            placeholder="Customer name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </section>

      {/* Line items */}
      <section className="card overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th w-14">Sl. No.</th>
              <th className="th">Particulars</th>
              <th className="th w-28">Weight</th>
              <th className="th w-28">Quantity</th>
              <th className="th w-32 text-right">Price</th>
              <th className="th w-36 text-right">Amount</th>
              <th className="th w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {computed.map((l, idx) => (
              <tr key={l.key}>
                <td className="td text-center text-slate-500">{idx + 1}</td>
                <td className="td">
                  <ProductPicker
                    products={optionsFor(l.product_id)}
                    value={l.product_id}
                    onChange={(pid) => pickProduct(l.key, pid)}
                    autoFocus={l.key === focusKey}
                  />
                </td>
                <td className="td">
                  <input
                    className={`input ${l.product?.price_basis === 'weight' ? 'border-indigo-400' : ''}`}
                    type="number"
                    min="0"
                    step="any"
                    data-weight={l.key}
                    value={l.weight}
                    onChange={(e) => updateLine(l.key, { weight: e.target.value })}
                  />
                </td>
                <td className="td">
                  <input
                    className={`input ${l.product?.price_basis !== 'weight' && l.product ? 'border-indigo-400' : ''}`}
                    type="number"
                    min="0"
                    step="any"
                    data-qty={l.key}
                    value={l.quantity}
                    onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                  />
                </td>
                <td className="td text-right font-mono text-slate-600">
                  {l.product ? fmtMoney(l.price) : '—'}
                  {l.product && (
                    <div className="text-[10px] text-slate-400">
                      per {l.product.price_basis === 'weight' ? 'weight' : l.product.unit}
                    </div>
                  )}
                </td>
                <td className="td text-right font-mono font-semibold">{fmtMoney(l.amount)}</td>
                <td className="td text-center">
                  <button
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Remove row"
                    onClick={() => removeLine(l.key)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-slate-100 p-3">
          <button className="btn-secondary" onClick={addLine}>
            + Add item
          </button>
        </div>
      </section>

      {/* Summary & payment */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-4">
          <div>
            <span className="label">Payment Mode</span>
            <div className="flex gap-2">
              {(['cash', 'bank'] as const).map((m) => (
                <label
                  key={m}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                    !isSplit && paymentMode === m
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-300 text-slate-600'
                  } ${isSplit ? 'opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name="payment"
                    checked={paymentMode === m}
                    disabled={isSplit}
                    onChange={() => setPaymentMode(m)}
                  />
                  {m === 'cash' ? 'Cash' : 'Bank'}
                </label>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-600"
              checked={isSplit}
              onChange={(e) => toggleSplit(e.target.checked)}
            />
            <span className="text-sm font-medium">Split payment (Cash + Bank)</span>
          </label>

          {isSplit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cash amount</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="any"
                  value={cash}
                  onChange={(e) => onCashChange(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Bank amount</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="any"
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                />
              </div>
              <p className={`col-span-2 text-xs ${splitDiff === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {splitDiff === 0
                  ? '✓ Split matches final amount'
                  : splitDiff > 0
                    ? `Over by ${fmtMoney(splitDiff)}`
                    : `Short by ${fmtMoney(-splitDiff)}`}
              </p>
            </div>
          )}
        </div>

        <div className="card space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Sub Total</span>
            <span className="font-mono">{fmtMoney(subTotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <label className="text-slate-600" htmlFor="discount">
              Discount Amount
            </label>
            <input
              id="discount"
              className="input w-40 text-right font-mono"
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold">
            <span>Final Amount</span>
            <span className="font-mono text-indigo-700">{fmtMoney(finalAmount)}</span>
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-3">
        <button className="btn-success" onClick={exportCurrent} disabled={usableLines.length === 0}>
          ⬇ Export (Excel)
        </button>
        <button className="btn-primary min-w-32" onClick={submit} disabled={saving || dup === 'checking'}>
          {saving ? 'Saving…' : isEdit ? 'Update' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
