import { useEffect, useState, type FormEvent } from 'react'
import { fmtMoney } from '../lib/format'
import { errorMessage, supabase } from '../lib/supabase'
import type { PriceBasis, Product } from '../lib/types'

interface Draft {
  id?: string
  name: string
  unit: string
  price_basis: PriceBasis
  price: string
  active: boolean
}

const blank: Draft = { name: '', unit: 'pcs', price_basis: 'quantity', price: '', active: true }

export default function Products() {
  const [products, setProducts] = useState<Product[]>([])
  const [draft, setDraft] = useState<Draft>(blank)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')

  const load = async () => {
    const { data, error } = await supabase.from('products').select('*').order('name')
    if (error) setError(errorMessage(error))
    else setProducts((data ?? []) as Product[])
  }

  useEffect(() => {
    load()
  }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const price = Number(draft.price)
    if (!draft.name.trim() || !Number.isFinite(price) || price < 0) {
      setError('Enter a name and a valid price')
      return
    }
    setBusy(true)
    setError('')
    const row = {
      name: draft.name.trim(),
      unit: draft.unit.trim() || 'pcs',
      price_basis: draft.price_basis,
      price,
      active: draft.active,
      updated_at: new Date().toISOString(),
    }
    const { error } = draft.id
      ? await supabase.from('products').update(row).eq('id', draft.id)
      : await supabase.from('products').insert(row)
    setBusy(false)
    if (error) setError(error.code === '23505' ? 'A product with this name already exists' : errorMessage(error))
    else {
      setDraft(blank)
      load()
    }
  }

  const toggleActive = async (p: Product) => {
    const { error } = await supabase.from('products').update({ active: !p.active }).eq('id', p.id)
    if (error) setError(errorMessage(error))
    else load()
  }

  const shown = products.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Master Data – Products</h1>
        <p className="text-sm text-slate-500">
          Only admins can change items and prices. Prices here are applied automatically on every challan.
        </p>
      </div>

      <form onSubmit={save} className="card grid items-end gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label">Particulars (item name)</label>
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Unit</label>
          <input className="input" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
        </div>
        <div>
          <label className="label">Price per</label>
          <select
            className="input"
            value={draft.price_basis}
            onChange={(e) => setDraft({ ...draft, price_basis: e.target.value as PriceBasis })}
          >
            <option value="quantity">Quantity</option>
            <option value="weight">Weight</option>
          </select>
        </div>
        <div>
          <label className="label">Price</label>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={busy}>
            {draft.id ? 'Update' : 'Add'}
          </button>
          {draft.id && (
            <button type="button" className="btn-secondary" onClick={() => setDraft(blank)}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {error && <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="card overflow-x-auto p-0 sm:p-0">
        <div className="border-b border-slate-100 p-3">
          <input
            className="input max-w-xs"
            placeholder="Filter items…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Particulars</th>
              <th className="th">Unit</th>
              <th className="th">Price per</th>
              <th className="th text-right">Price</th>
              <th className="th">Status</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'text-slate-400'}>
                <td className="td font-medium">{p.name}</td>
                <td className="td">{p.unit}</td>
                <td className="td capitalize">{p.price_basis}</td>
                <td className="td text-right font-mono">{fmtMoney(p.price)}</td>
                <td className="td">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {p.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="td whitespace-nowrap text-right">
                  <button
                    className="font-medium text-indigo-600 hover:underline"
                    onClick={() =>
                      setDraft({
                        id: p.id,
                        name: p.name,
                        unit: p.unit,
                        price_basis: p.price_basis,
                        price: String(p.price),
                        active: p.active,
                      })
                    }
                  >
                    Edit
                  </button>
                  <button className="ml-3 font-medium text-slate-600 hover:underline" onClick={() => toggleActive(p)}>
                    {p.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="td py-8 text-center text-slate-500">
                  No products yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
