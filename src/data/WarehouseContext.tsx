import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { seedData } from './seed'
import type { Product, Supplier, UserRecord, Warehouse, WarehouseDocument, WarehouseState } from '../types'

const STORAGE_KEY = 'smart-warehouse-data-v1'
const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
export const warehouseApiEnabled = Boolean(import.meta.env.VITE_API_BASE_URL?.trim())

interface WarehouseContextValue {
  data: WarehouseState
  loading: boolean
  loadError: string
  retryLoad: () => void
  lookupProduct: (code: string) => Promise<Product | null>
  lookupBarcode: (barcode: string) => Promise<Product | null>
  getNextSku: () => Promise<string>
  saveProduct: (product: Omit<Product, 'id' | 'createdAt'>, productId?: string) => Promise<Product>
  deleteProduct: (productId: string) => Promise<void>
  saveCategory: (name: string, previousName?: string) => Promise<void>
  removeCategory: (name: string) => Promise<void>
  adjustStock: (productId: string, warehouseId: string, quantity: number, reason: string) => Promise<void>
  saveWarehouse: (warehouse: Omit<Warehouse, 'id'>, warehouseId?: string) => Promise<void>
  deleteWarehouse: (warehouseId: string) => Promise<void>
  saveSupplier: (supplier: Omit<Supplier, 'id'>, supplierId?: string) => Promise<void>
  deleteSupplier: (supplierId: string) => Promise<void>
  saveUser: (user: Omit<UserRecord, 'id' | 'createdAt'>, userId?: string) => Promise<void>
  saveDocument: (document: Omit<WarehouseDocument, 'id' | 'code' | 'createdAt' | 'status'>) => Promise<string>
  confirmDocument: (documentId: string) => Promise<void>
  cancelDocument: (documentId: string) => Promise<void>
  resetData: () => boolean
}

const WarehouseContext = createContext<WarehouseContextValue | null>(null)

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''
const apiEnabled = warehouseApiEnabled
const emptyState: WarehouseState = { products: [], warehouses: [], inventory: [], documents: [], transactions: [], suppliers: [], users: [], categories: [], auditLogs: [] }

export class WarehouseApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'WarehouseApiError'
  }
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch {
    throw new Error('Không thể kết nối backend. Hãy kiểm tra API server và cấu hình VITE_API_BASE_URL.')
  }
  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  if (!response.ok) throw new WarehouseApiError(payload?.error?.message ?? `Backend trả về lỗi HTTP ${response.status}.`, payload?.error?.code)
  return payload as T
}

function readInitialData(): WarehouseState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? { ...seedData, ...JSON.parse(saved) as Partial<WarehouseState> } : seedData
  } catch {
    return seedData
  }
}

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WarehouseState>(apiEnabled ? emptyState : readInitialData)
  const [loading, setLoading] = useState(apiEnabled)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)

  const reloadFromApi = async () => {
    const snapshot = await apiRequest<WarehouseState>('/bootstrap')
    setData(snapshot)
    setLoadError('')
    return snapshot
  }

  useEffect(() => {
    if (!apiEnabled) return
    let active = true
    setLoading(true)
    apiRequest<WarehouseState>('/bootstrap').then((snapshot) => {
      if (active) setData(snapshot)
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Không thể tải dữ liệu từ backend.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [loadAttempt])

  useEffect(() => {
    if (apiEnabled || loading) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { /* Lưu trữ có thể bị trình duyệt chặn. */ }
  }, [data, loading])

  const value = useMemo<WarehouseContextValue>(() => {
    const audit = (message: string) => ({ id: id(), message, createdAt: new Date().toISOString(), actor: 'Lê Hoàng Nam' })
    return {
      data,
      loading,
      loadError,
      retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
      lookupProduct: async (code) => {
        const normalized = code.trim()
        if (!normalized) return null
        if (apiEnabled) {
          try {
            return await apiRequest<Product>(`/products/lookup?code=${encodeURIComponent(normalized)}`)
          } catch (error) {
            if (error instanceof WarehouseApiError && error.code === 'PRODUCT_NOT_FOUND') return null
            throw error
          }
        }
        return data.products.find((product) => product.sku.trim().toLowerCase() === normalized.toLowerCase() || product.barcode.trim().toLowerCase() === normalized.toLowerCase()) ?? null
      },
      lookupBarcode: async (barcode) => {
        const normalized = barcode.trim()
        if (!normalized) return null
        if (apiEnabled) {
          try {
            return await apiRequest<Product>(`/products/lookup?barcode=${encodeURIComponent(normalized)}`)
          } catch (error) {
            if (error instanceof WarehouseApiError && error.code === 'PRODUCT_NOT_FOUND') return null
            throw error
          }
        }
        return data.products.find((product) => product.barcode.trim() === normalized) ?? null
      },
      getNextSku: async () => {
        if (apiEnabled) {
          const result = await apiRequest<{ sku: string }>('/products/next-sku')
          return result.sku
        }
        const next = data.products.reduce((maximum, item) => {
          const match = /^SP-(\d+)$/i.exec(item.sku.trim())
          return match ? Math.max(maximum, Number(match[1])) : maximum
        }, 0) + 1
        return `SP-${String(next).padStart(6, '0')}`
      },
      saveProduct: async (product, productId) => {
        if (apiEnabled) {
          const savedProduct = await apiRequest<Product>(`/products${productId ? `/${productId}` : ''}`, { method: productId ? 'PUT' : 'POST', body: JSON.stringify(product) })
          await reloadFromApi()
          return savedProduct
        }
        const normalizedSku = product.sku.trim().toLowerCase()
        const normalizedBarcode = product.barcode.trim()
        const duplicate = data.products.some((item) => item.id !== productId && (item.sku.trim().toLowerCase() === normalizedSku || (normalizedBarcode && item.barcode.trim() === normalizedBarcode)))
        if (duplicate) throw new Error('Mã SKU hoặc barcode đã được sử dụng.')
        const previous = productId ? data.products.find((item) => item.id === productId) : undefined
        const savedProduct: Product = productId && previous
          ? { ...previous, ...product }
          : { ...product, id: id(), createdAt: new Date().toISOString() }
        setData((current) => ({
          ...current,
          products: productId
            ? current.products.map((item) => item.id === productId ? savedProduct : item)
            : [...current.products, savedProduct],
          auditLogs: [audit(`${productId ? 'Cập nhật' : 'Tạo'} sản phẩm ${product.name}`), ...current.auditLogs],
        }))
        return savedProduct
      },
      deleteProduct: async (productId) => {
        if (apiEnabled) {
          await apiRequest(`/products/${productId}`, { method: 'DELETE' })
          await reloadFromApi()
          return
        }
        if (data.transactions.some((transaction) => transaction.productId === productId)) throw new Error('Sản phẩm đã có lịch sử giao dịch, hãy chuyển sang ngừng kinh doanh thay vì xóa.')
        setData((current) => ({ ...current, products: current.products.filter((item) => item.id !== productId), inventory: current.inventory.filter((item) => item.productId !== productId) }))
      },
      saveCategory: async (name, previousName) => {
        if (apiEnabled) {
          const path = previousName ? `/categories/by-name/${encodeURIComponent(previousName)}` : '/categories'
          await apiRequest(path, { method: previousName ? 'PATCH' : 'POST', body: JSON.stringify({ name }) })
          await reloadFromApi()
          return
        }
        const cleanName = name.trim()
        if (!cleanName) throw new Error('Tên danh mục không được để trống.')
        if (data.categories.some((item) => item.toLowerCase() === cleanName.toLowerCase() && item !== previousName)) throw new Error('Tên danh mục đã tồn tại.')
        setData((current) => ({
          ...current,
          categories: previousName ? current.categories.map((item) => item === previousName ? cleanName : item) : [...current.categories, cleanName],
          products: previousName ? current.products.map((item) => item.category === previousName ? { ...item, category: cleanName } : item) : current.products,
          auditLogs: [audit(`${previousName ? 'Cập nhật' : 'Tạo'} danh mục ${cleanName}`), ...current.auditLogs],
        }))
      },
      removeCategory: async (name) => {
        if (apiEnabled) {
          await apiRequest(`/categories/by-name/${encodeURIComponent(name)}`, { method: 'DELETE' })
          await reloadFromApi()
          return
        }
        if (data.products.some((product) => product.category === name)) throw new Error('Danh mục đang được sản phẩm sử dụng, không thể xóa.')
        setData((current) => ({ ...current, categories: current.categories.filter((item) => item !== name) }))
      },
      adjustStock: async (productId, warehouseId, quantity, reason) => {
        if (apiEnabled) {
          await apiRequest('/inventory/adjust', { method: 'POST', body: JSON.stringify({ productId, warehouseId, quantity, reason }) })
          await reloadFromApi()
          return
        }
        if (!Number.isInteger(quantity) || quantity === 0 || !reason.trim()) throw new Error('Số lượng điều chỉnh phải khác 0 và cần có lý do.')
        const existing = data.inventory.find((item) => item.productId === productId && item.warehouseId === warehouseId)
        if ((existing?.quantity ?? 0) + quantity < 0) throw new Error('Số lượng điều chỉnh không thể làm tồn kho âm.')
        const code = `DC-${Date.now().toString().slice(-6)}`
        setData((current) => {
          const index = current.inventory.findIndex((item) => item.productId === productId && item.warehouseId === warehouseId)
          const inventory = [...current.inventory]
          if (index < 0) inventory.push({ productId, warehouseId, quantity, location: 'Khu mới' })
          else inventory[index] = { ...inventory[index], quantity: inventory[index].quantity + quantity }
          return { ...current, inventory, transactions: [{ id: id(), code, type: 'Điều chỉnh', productId, warehouseId, quantity, actor: 'Lê Hoàng Nam', createdAt: new Date().toISOString(), source: reason.trim() }, ...current.transactions], auditLogs: [audit(`Điều chỉnh tồn kho ${code}: ${reason.trim()}`), ...current.auditLogs] }
        })
      },
      saveWarehouse: async (warehouse, warehouseId) => {
        if (apiEnabled) {
          await apiRequest(`/warehouses${warehouseId ? `/${warehouseId}` : ''}`, { method: warehouseId ? 'PUT' : 'POST', body: JSON.stringify(warehouse) })
          await reloadFromApi()
          return
        }
        if (data.warehouses.some((item) => item.id !== warehouseId && item.code.toLowerCase() === warehouse.code.toLowerCase())) throw new Error('Mã kho đã tồn tại.')
        setData((current) => ({ ...current, warehouses: warehouseId ? current.warehouses.map((item) => item.id === warehouseId ? { ...item, ...warehouse } : item) : [...current.warehouses, { ...warehouse, id: id() }], auditLogs: [audit(`${warehouseId ? 'Cập nhật' : 'Tạo'} kho ${warehouse.name}`), ...current.auditLogs] }))
      },
      deleteWarehouse: async (warehouseId) => {
        if (apiEnabled) {
          await apiRequest(`/warehouses/${warehouseId}`, { method: 'DELETE' })
          await reloadFromApi()
          return
        }
        if (!data.warehouses.some((item) => item.id === warehouseId)) throw new Error('Không tìm thấy kho.')
        const referenced = data.inventory.some((item) => item.warehouseId === warehouseId)
          || data.documents.some((item) => item.warehouseId === warehouseId)
          || data.transactions.some((item) => item.warehouseId === warehouseId)
        if (referenced) throw new Error('Kho đã có tồn kho, phiếu hoặc giao dịch; hãy tạm ngưng thay vì xóa.')
        setData((current) => ({ ...current, warehouses: current.warehouses.filter((item) => item.id !== warehouseId) }))
      },
      saveSupplier: async (supplier, supplierId) => {
        if (apiEnabled) {
          await apiRequest(`/suppliers${supplierId ? `/${supplierId}` : ''}`, { method: supplierId ? 'PUT' : 'POST', body: JSON.stringify(supplier) })
          await reloadFromApi()
          return
        }
        if (data.suppliers.some((item) => item.id !== supplierId && item.code.toLowerCase() === supplier.code.toLowerCase())) throw new Error('Mã nhà cung cấp đã tồn tại.')
        setData((current) => ({ ...current, suppliers: supplierId ? current.suppliers.map((item) => item.id === supplierId ? { ...item, ...supplier } : item) : [...current.suppliers, { ...supplier, id: id() }], auditLogs: [audit(`${supplierId ? 'Cập nhật' : 'Tạo'} nhà cung cấp ${supplier.name}`), ...current.auditLogs] }))
      },
      deleteSupplier: async (supplierId) => {
        if (apiEnabled) {
          await apiRequest(`/suppliers/${supplierId}`, { method: 'DELETE' })
          await reloadFromApi()
          return
        }
        const supplier = data.suppliers.find((item) => item.id === supplierId)
        if (supplier && data.documents.some((document) => document.partner === supplier.name)) throw new Error('Nhà cung cấp đã có phiếu nhập lịch sử, không thể xóa.')
        setData((current) => ({ ...current, suppliers: current.suppliers.filter((item) => item.id !== supplierId) }))
      },
      saveUser: async (user, userId) => {
        if (apiEnabled) {
          await apiRequest(`/users${userId ? `/${userId}` : ''}`, { method: userId ? 'PUT' : 'POST', body: JSON.stringify(user) })
          await reloadFromApi()
          return
        }
        if (data.users.some((item) => item.id !== userId && item.email.toLowerCase() === user.email.toLowerCase())) throw new Error('Email tài khoản đã tồn tại.')
        setData((current) => ({ ...current, users: userId ? current.users.map((item) => item.id === userId ? { ...item, ...user } : item) : [...current.users, { ...user, id: id(), createdAt: new Date().toISOString() }], auditLogs: [audit(`${userId ? 'Cập nhật' : 'Tạo'} tài khoản ${user.name}`), ...current.auditLogs] }))
      },
      saveDocument: async (document) => {
        if (apiEnabled) {
          const result = await apiRequest<{ id: string }>('/documents', { method: 'POST', body: JSON.stringify(document) })
          await reloadFromApi()
          return result.id
        }
        const documentId = id()
        const prefix = document.type === 'Nhập kho' ? 'PN' : 'PX'
        const number = String(data.documents.filter((item) => item.type === document.type).length + 1).padStart(4, '0')
        const next: WarehouseDocument = { ...document, id: documentId, code: `${prefix}-${new Date().getFullYear()}-${number}`, createdAt: new Date().toISOString(), status: 'Bản nháp' }
        setData((current) => ({ ...current, documents: [next, ...current.documents], auditLogs: [audit(`Tạo phiếu ${next.code}`), ...current.auditLogs] }))
        return documentId
      },
      confirmDocument: async (documentId) => {
        if (apiEnabled) {
          await apiRequest(`/documents/${documentId}/confirm`, { method: 'POST' })
          await reloadFromApi()
          return
        }
        const document = data.documents.find((item) => item.id === documentId)
        if (!document || document.status !== 'Bản nháp') throw new Error('Phiếu không tồn tại hoặc đã được xử lý.')
        if (!document.lines.length || document.lines.some((line) => line.quantity <= 0)) throw new Error('Phiếu cần có sản phẩm với số lượng hợp lệ.')
        if (document.type === 'Xuất kho') {
          const required = new Map<string, number>()
          document.lines.forEach((line) => required.set(line.productId, (required.get(line.productId) ?? 0) + line.quantity))
          for (const [productId, quantity] of required) {
            const available = data.inventory.find((item) => item.productId === productId && item.warehouseId === document.warehouseId)?.quantity ?? 0
            if (available < quantity) {
              const productName = data.products.find((item) => item.id === productId)?.name ?? 'Sản phẩm'
              throw new Error(`${productName}: tồn kho không đủ (còn ${available}, cần ${quantity}).`)
            }
          }
        }
        setData((current) => {
        const inventory = [...current.inventory]
        const transactions = [...current.transactions]
        document.lines.forEach((line) => {
          const index = inventory.findIndex((item) => item.productId === line.productId && item.warehouseId === document.warehouseId)
          const delta = document.type === 'Nhập kho' ? line.quantity : -line.quantity
          if (index < 0) inventory.push({ productId: line.productId, warehouseId: document.warehouseId, quantity: Math.max(0, delta), location: 'Khu mới' })
          else inventory[index] = { ...inventory[index], quantity: inventory[index].quantity + delta }
          transactions.unshift({ id: id(), code: document.code, type: document.type, productId: line.productId, warehouseId: document.warehouseId, quantity: line.quantity, actor: 'Lê Hoàng Nam', createdAt: new Date().toISOString(), source: document.partner || document.code })
        })
        return { ...current, inventory, transactions, documents: current.documents.map((item) => item.id === documentId ? { ...item, status: 'Đã xác nhận' } : item), auditLogs: [audit(`Xác nhận phiếu ${document.code}`), ...current.auditLogs] }
        })
      },
      cancelDocument: async (documentId) => {
        if (apiEnabled) {
          await apiRequest(`/documents/${documentId}/cancel`, { method: 'POST' })
          await reloadFromApi()
          return
        }
        const document = data.documents.find((item) => item.id === documentId)
        if (!document || document.status !== 'Bản nháp') throw new Error('Chỉ có thể hủy phiếu nháp.')
        setData((current) => ({ ...current, documents: current.documents.map((item) => item.id === documentId ? { ...item, status: 'Đã hủy' } : item), auditLogs: [audit(`Hủy phiếu ${document.code}`), ...current.auditLogs] }))
      },
      resetData: () => {
        if (apiEnabled) return false
        setData(seedData)
        return true
      },
    }
  }, [data, loadError, loading])

  if (apiEnabled && loading) return <main className="page-content"><div className="empty-state">Đang tải dữ liệu kho từ backend…</div></main>
  if (apiEnabled && loadError) return <main className="page-content"><div className="empty-state"><strong>Không tải được dữ liệu từ backend</strong><span>{loadError}</span><button className="button button-primary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Thử lại</button></div></main>
  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>
}

export function useWarehouse() {
  const context = useContext(WarehouseContext)
  if (!context) throw new Error('useWarehouse cần được dùng bên trong WarehouseProvider.')
  return context
}
