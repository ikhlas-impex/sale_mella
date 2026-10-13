const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtMoney = (n: number | null | undefined) => money.format(Number(n ?? 0))

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export const today = () => {
  const d = new Date()
  const offset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - offset).toISOString().slice(0, 10)
}

/** Parse an input value into a number, empty → null */
export const toNum = (v: string): number | null => {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
