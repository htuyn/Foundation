import type { WarehouseState } from '../types'

const day = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString()

const products = [
  ['SKU-1001', '8938501001001', 'Cà phê rang xay Arabica', 'Đồ uống', 'gói', 125000, 30],
  ['SKU-1002', '8938501001002', 'Trà xanh Thái Nguyên', 'Đồ uống', 'hộp', 84000, 24],
  ['SKU-1003', '8938501001003', 'Nước khoáng thiên nhiên 500ml', 'Đồ uống', 'thùng', 72000, 18],
  ['SKU-1004', '8938501001004', 'Bình giữ nhiệt Inox 500ml', 'Gia dụng', 'chiếc', 189000, 12],
  ['SKU-1005', '8938501001005', 'Ly sứ men trắng', 'Gia dụng', 'chiếc', 65000, 20],
  ['SKU-1006', '8938501001006', 'Hộp đựng thực phẩm 1.2L', 'Gia dụng', 'bộ', 97000, 15],
  ['SKU-1007', '8938501001007', 'Sổ tay bìa da A5', 'Văn phòng phẩm', 'quyển', 58000, 20],
  ['SKU-1008', '8938501001008', 'Bút gel mực xanh 0.5mm', 'Văn phòng phẩm', 'hộp', 42000, 25],
  ['SKU-1009', '8938501001009', 'Giấy in A4 80gsm', 'Văn phòng phẩm', 'ram', 89000, 30],
  ['SKU-1010', '8938501001010', 'Tai nghe Bluetooth AirBeat', 'Điện tử', 'chiếc', 395000, 10],
  ['SKU-1011', '8938501001011', 'Chuột không dây Ergo', 'Điện tử', 'chiếc', 245000, 12],
  ['SKU-1012', '8938501001012', 'Bàn phím cơ K87', 'Điện tử', 'chiếc', 790000, 8],
  ['SKU-1013', '8938501001013', 'Cáp sạc USB-C 1m', 'Điện tử', 'sợi', 69000, 20],
  ['SKU-1014', '8938501001014', 'Đèn bàn LED cảm ứng', 'Gia dụng', 'chiếc', 320000, 10],
  ['SKU-1015', '8938501001015', 'Balo laptop Urban 15.6', 'Phụ kiện', 'chiếc', 485000, 8],
  ['SKU-1016', '8938501001016', 'Túi canvas Daily', 'Phụ kiện', 'chiếc', 115000, 16],
  ['SKU-1017', '8938501001017', 'Ô gấp chống tia UV', 'Phụ kiện', 'chiếc', 155000, 12],
  ['SKU-1018', '8938501001018', 'Nến thơm tinh dầu gỗ', 'Gia dụng', 'lọ', 175000, 10],
  ['SKU-1019', '8938501001019', 'Bình nước thể thao 750ml', 'Gia dụng', 'chiếc', 128000, 16],
  ['SKU-1020', '8938501001020', 'Khăn cotton đa năng', 'Phụ kiện', 'chiếc', 49000, 24],
  ['SKU-1021', '8938501001021', 'Kẹp giấy màu 28mm', 'Văn phòng phẩm', 'hộp', 26000, 18],
  ['SKU-1022', '8938501001022', 'Loa Bluetooth Mini', 'Điện tử', 'chiếc', 550000, 8],
  ['SKU-1023', '8938501001023', 'Cốc thủy tinh chịu nhiệt', 'Gia dụng', 'chiếc', 78000, 15],
  ['SKU-1024', '8938501001024', 'Trà hoa cúc túi lọc', 'Đồ uống', 'hộp', 72000, 18],
].map(([sku, barcode, name, category, unit, cost, minStock], index) => ({
  id: `prd-${index + 1}`,
  sku: String(sku),
  barcode: String(barcode),
  name: String(name),
  category: String(category),
  unit: String(unit),
  cost: Number(cost),
  minStock: Number(minStock),
  status: 'Đang kinh doanh' as const,
  createdAt: day(60 - index),
}))

const warehouses = [
  { id: 'wh-hcm', code: 'WH-HCM', name: 'Kho Trung tâm TP. Hồ Chí Minh', address: '12 Đường số 8, TP. Thủ Đức, TP. Hồ Chí Minh', manager: 'Nguyễn Minh Tuấn', status: 'Đang hoạt động' as const },
  { id: 'wh-hn', code: 'WH-HN', name: 'Kho phân phối Hà Nội', address: '28 Nguyễn Văn Cừ, Long Biên, Hà Nội', manager: 'Trần Thu Hà', status: 'Đang hoạt động' as const },
]

const inventory = products.flatMap((product, index) => [
  { productId: product.id, warehouseId: warehouses[0].id, quantity: [128, 42, 17, 56, 8, 34, 73, 120, 25, 19, 61, 12][index % 12], location: `A-${String((index % 6) + 1).padStart(2, '0')}-${String((index % 4) + 1).padStart(2, '0')}` },
  { productId: product.id, warehouseId: warehouses[1].id, quantity: [54, 26, 11, 24, 18, 21, 31, 45, 18, 9, 28, 6][index % 12], location: `B-${String((index % 5) + 1).padStart(2, '0')}-${String((index % 3) + 1).padStart(2, '0')}` },
])

const documents = [
  { id: 'doc-in-001', code: 'PN-2025-0048', type: 'Nhập kho' as const, warehouseId: 'wh-hcm', partner: 'Công ty TNHH Nông sản Việt', createdAt: day(0), status: 'Đã xác nhận' as const, note: 'Nhập hàng định kỳ tháng 10', lines: [{ productId: 'prd-1', quantity: 30, unitCost: 125000 }, { productId: 'prd-2', quantity: 20, unitCost: 84000 }] },
  { id: 'doc-out-001', code: 'PX-2025-0031', type: 'Xuất kho' as const, warehouseId: 'wh-hcm', partner: 'Đơn hàng SO-4821', createdAt: day(1), status: 'Đã xác nhận' as const, note: 'Giao khách hàng', lines: [{ productId: 'prd-4', quantity: 4, unitCost: 189000 }, { productId: 'prd-10', quantity: 2, unitCost: 395000 }] },
  { id: 'doc-in-002', code: 'PN-2025-0049', type: 'Nhập kho' as const, warehouseId: 'wh-hn', partner: 'Nhà cung cấp Minh Long', createdAt: day(0), status: 'Bản nháp' as const, note: '', lines: [{ productId: 'prd-11', quantity: 12, unitCost: 245000 }] },
  { id: 'doc-out-002', code: 'PX-2025-0032', type: 'Xuất kho' as const, warehouseId: 'wh-hn', partner: 'Đơn hàng SO-4839', createdAt: day(2), status: 'Bản nháp' as const, note: '', lines: [{ productId: 'prd-7', quantity: 3, unitCost: 58000 }] },
  { id: 'doc-in-003', code: 'PN-2025-0047', type: 'Nhập kho' as const, warehouseId: 'wh-hcm', partner: 'Công ty TNHH Nông sản Việt', createdAt: day(5), status: 'Đã xác nhận' as const, note: '', lines: [{ productId: 'prd-3', quantity: 24, unitCost: 72000 }] },
  { id: 'doc-out-003', code: 'PX-2025-0030', type: 'Xuất kho' as const, warehouseId: 'wh-hn', partner: 'Đơn hàng SO-4798', createdAt: day(7), status: 'Đã xác nhận' as const, note: '', lines: [{ productId: 'prd-8', quantity: 6, unitCost: 42000 }] },
]

const transactions = documents.filter((document) => document.status === 'Đã xác nhận').flatMap((document) => document.lines.map((line, index) => ({
  id: `${document.id}-${index}`,
  code: document.code,
  type: document.type,
  productId: line.productId,
  warehouseId: document.warehouseId,
  quantity: line.quantity,
  actor: 'Lê Hoàng Nam',
  createdAt: document.createdAt,
  source: document.partner,
})))

export const seedData: WarehouseState = {
  products,
  warehouses,
  inventory,
  documents,
  transactions,
  categories: ['Đồ uống', 'Gia dụng', 'Văn phòng phẩm', 'Điện tử', 'Phụ kiện'],
  suppliers: [
    { id: 'sup-1', code: 'NCC-001', name: 'Công ty TNHH Nông sản Việt', phone: '0901 234 567', email: 'lienhe@nongsanviet.vn', address: 'Bình Thạnh, TP. Hồ Chí Minh', active: true },
    { id: 'sup-2', code: 'NCC-002', name: 'Nhà cung cấp Minh Long', phone: '0912 456 789', email: 'sales@minhlong.vn', address: 'Long Biên, Hà Nội', active: true },
    { id: 'sup-3', code: 'NCC-003', name: 'Thiết bị số Sao Việt', phone: '0988 321 654', email: 'kinhdoanh@saoviet.vn', address: 'Cầu Giấy, Hà Nội', active: true },
  ],
  users: [
    { id: 'user-1', name: 'Lê Hoàng Nam', email: 'nam.le@smartwarehouse.vn', role: 'Quản trị viên', active: true, createdAt: day(240) },
    { id: 'user-2', name: 'Nguyễn Minh Tuấn', email: 'tuan.nguyen@smartwarehouse.vn', role: 'Quản lý kho', active: true, createdAt: day(180) },
    { id: 'user-3', name: 'Trần Thu Hà', email: 'ha.tran@smartwarehouse.vn', role: 'Nhân viên kho', active: true, createdAt: day(90) },
  ],
  auditLogs: [{ id: 'audit-1', message: 'Khởi tạo dữ liệu kho demo', createdAt: day(0), actor: 'Hệ thống' }],
}
