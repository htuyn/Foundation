export type ProductStatus = 'Đang kinh doanh' | 'Ngừng kinh doanh'
export type DocumentStatus = 'Bản nháp' | 'Đã xác nhận' | 'Đã hủy'
export type TransactionType = 'Nhập kho' | 'Xuất kho' | 'Điều chỉnh'

export interface Product {
  id: string
  sku: string
  barcode: string
  name: string
  category: string
  unit: string
  cost: number
  minStock: number
  status: ProductStatus
  createdAt: string
}

export interface Warehouse {
  id: string
  code: string
  name: string
  address: string
  manager: string
  status: 'Đang hoạt động' | 'Tạm ngưng'
}

export interface InventoryItem {
  productId: string
  warehouseId: string
  quantity: number
  location: string
}

export interface DocumentLine {
  productId: string
  quantity: number
  unitCost: number
}

export interface WarehouseDocument {
  id: string
  code: string
  type: 'Nhập kho' | 'Xuất kho'
  warehouseId: string
  supplierId?: string | null
  partner: string
  createdAt: string
  status: DocumentStatus
  note: string
  lines: DocumentLine[]
}

export interface Transaction {
  id: string
  code: string
  type: TransactionType
  productId: string
  warehouseId: string
  quantity: number
  actor: string
  createdAt: string
  source: string
}

export interface Supplier {
  id: string
  code: string
  name: string
  phone: string
  email: string
  address: string
  active: boolean
}

export interface UserRecord {
  id: string
  name: string
  email: string
  role: 'Quản trị viên' | 'Quản lý kho' | 'Nhân viên kho'
  active: boolean
  createdAt: string
}

export interface AuditRecord {
  id: string
  message: string
  createdAt: string
  actor: string
}

export interface WarehouseState {
  products: Product[]
  warehouses: Warehouse[]
  inventory: InventoryItem[]
  documents: WarehouseDocument[]
  transactions: Transaction[]
  suppliers: Supplier[]
  users: UserRecord[]
  categories: string[]
  auditLogs: AuditRecord[]
}
