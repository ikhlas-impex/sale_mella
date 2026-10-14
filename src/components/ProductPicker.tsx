import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { fmtMoney } from '../lib/format'
import type { Product } from '../lib/types'

interface Props {
  products: Product[]
  value: string
  onChange: (productId: string) => void
  autoFocus?: boolean
}

/** Lowercase and strip spaces/punctuation, so "2b" matches "2 B AUTO". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function search(products: Product[], query: string) {
  const q = norm(query)
  if (!q) return products
  const tokens = query.split(/\s+/).map(norm).filter(Boolean)
  const hits = products.filter((p) => {
    const name = norm(p.name)
    return name.includes(q) || tokens.every((t) => name.includes(t))
  })
  // Names that start with the query first
  return hits.sort((a, b) => Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q)))
}

export default function ProductPicker({ products, value, onChange, autoFocus }: Props) {
  const selected = products.find((p) => p.id === value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const matches = search(products, query)

  // The list is position:fixed so the table's horizontal scroll container can't clip it
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom
      const maxHeight = Math.min(288, Math.max(below, r.top) - 12)
      setPos(
        below >= 200 || below >= r.top
          ? { top: r.bottom + 4, left: r.left, width: r.width, maxHeight }
          : { bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width, maxHeight },
      )
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => {
    if (open) (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (p: Product) => {
    onChange(p.id)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && matches[active]) choose(matches[active])
    } else if (e.key === 'Tab' && open && query && matches[active]) {
      choose(matches[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className="input pr-8"
        placeholder={selected ? selected.name : 'Type to search item…'}
        autoFocus={autoFocus}
        value={open ? query : (selected?.name ?? '')}
        onFocus={(e) => {
          setOpen(true)
          setQuery('')
          setActive(0)
          e.target.select()
        }}
        onBlur={() => {
          setOpen(false)
          setQuery('')
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-400">⌕</span>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          style={{ position: 'fixed', ...pos }}
          className="z-50 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          // Keep focus in the input so blur doesn't close the list before the click lands
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No item matches "{query}"</li>}
          {matches.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={p.id === value}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                i === active ? 'bg-indigo-50 text-indigo-800' : ''
              } ${p.id === value ? 'font-semibold' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(p)}
            >
              <span>
                {p.name}
                {!p.active && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}
              </span>
              <span className="shrink-0 font-mono text-xs text-slate-500">
                {fmtMoney(p.price)} / {p.price_basis === 'weight' ? 'wt' : p.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
