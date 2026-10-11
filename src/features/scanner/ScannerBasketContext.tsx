import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

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
  const value = useMemo<ScannerBasketValue>(() => ({
    items,
    addProduct: (productId, barcode, scannedAt = new Date().toISOString()) => {
      const exists = items.some((item) => item.productId === productId)
      setItems((current) => {
        const previous = current.find((item) => item.productId === productId)
        return previous
          ? current.map((item) => item.productId === productId ? { ...item, quantity: item.quantity + 1, barcode, lastScannedAt: scannedAt } : item)
          : [...current, { productId, quantity: 1, barcode, lastScannedAt: scannedAt }]
      })
      return exists ? 'incremented' : 'added'
    },
    updateQuantity: (productId, quantity) => setItems((current) => current.map((item) => item.productId === productId ? { ...item, quantity: Math.max(1, Math.floor(quantity)) } : item)),
    removeProduct: (productId) => setItems((current) => current.filter((item) => item.productId !== productId)),
    clear: () => setItems([]),
  }), [items])
  return <ScannerBasketContext.Provider value={value}>{children}</ScannerBasketContext.Provider>
}

export function useScannerBasket() {
  const context = useContext(ScannerBasketContext)
  if (!context) throw new Error('useScannerBasket cần được dùng bên trong ScannerBasketProvider.')
  return context
}
