import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export interface ScannerBasketItem {
  productId: string
  quantity: number
  barcode: string
  lastScannedAt: string
}

interface ScannerBasketValue {
  items: ScannerBasketItem[]
  addProduct: (productId: string, barcode: string, scannedAt?: string) => 'added' | 'incremented'
  updateQuantity: (productId: string, quantity: number) => void
  removeProduct: (productId: string) => void
  clear: () => void
}

const ScannerBasketContext = createContext<ScannerBasketValue | null>(null)

export function ScannerBasketProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ScannerBasketItem[]>([])
  const itemsRef = useRef(items)
  const value = useMemo<ScannerBasketValue>(() => ({
    items,
    addProduct: (productId, barcode, scannedAt = new Date().toISOString()) => {
      const current = itemsRef.current
      const exists = current.some((item) => item.productId === productId)
      const next = exists
        ? current.map((item) => item.productId === productId ? { ...item, quantity: item.quantity + 1, barcode, lastScannedAt: scannedAt } : item)
        : [...current, { productId, quantity: 1, barcode, lastScannedAt: scannedAt }]
      itemsRef.current = next
      setItems(next)
      return exists ? 'incremented' : 'added'
    },
    updateQuantity: (productId, quantity) => {
      if (!Number.isInteger(quantity) || quantity < 1) return
      const next = itemsRef.current.map((item) => item.productId === productId ? { ...item, quantity } : item)
      itemsRef.current = next
      setItems(next)
    },
    removeProduct: (productId) => {
      const next = itemsRef.current.filter((item) => item.productId !== productId)
      itemsRef.current = next
      setItems(next)
    },
    clear: () => {
      itemsRef.current = []
      setItems([])
    },
  }), [items])
  return <ScannerBasketContext.Provider value={value}>{children}</ScannerBasketContext.Provider>
}

export function useScannerBasket() {
  const context = useContext(ScannerBasketContext)
  if (!context) throw new Error('useScannerBasket cần được dùng bên trong ScannerBasketProvider.')
  return context
}
