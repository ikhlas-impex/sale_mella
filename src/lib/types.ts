export type Role = 'admin' | 'user'
export type PriceBasis = 'quantity' | 'weight'
export type PaymentMode = 'cash' | 'bank'

export interface Profile {
  id: string
  email: string | null
  full_name: string
  role: Role
  approved: boolean
  disabled?: boolean
  created_at: string
}

export interface Product {
  id: string
  name: string
  unit: string
  price_basis: PriceBasis
  price: number
  active: boolean
}

export interface ChallanItem {
  id?: string
  sl_no: number
  product_id: string
  product_name: string
  weight: number | null
  quantity: number
  price: number
  amount: number
}

export interface Challan {
  id: string
  dc_no: string
  dc_date: string
  customer_name: string
  sub_total: number
  discount: number
  remarks?: string | null
  final_amount: number
  payment_mode: PaymentMode
  is_split: boolean
  cash_amount: number
  bank_amount: number
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
  creator?: { full_name: string } | null
  editor?: { full_name: string } | null
  challan_items?: ChallanItem[]
}
