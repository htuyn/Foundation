import { useMemo, useState, type FormEvent } from 'react'
import { ClipboardList, Download, SlidersHorizontal, Search } from 'lucide-react'
import { FormActions, Modal, PageHeader, Pagination, StatusBadge } from '../components/common'
import { useWarehouse } from '../data/WarehouseContext'
import { notify } from '../lib/feedback'

function AdjustmentForm({ onClose, onSave, saving }: { onClose: () => void; onSave: (productId: string, warehouseId: string, quantity: number, reason: string) => void; saving: boolean }) {
  const { data } = useWarehouse()
  const [productId, setProductId] = useState(data.products[0]?.id ?? '')
  const [warehouseId, setWarehouseId] = useState(data.warehouses[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(productId, warehouseId, quantity, reason) }
  return <form onSubmit={submit}><div className="form-grid"><label className="form-field full"><span>Sản phẩm <b>*</b></span><select required value={productId} onChange={(event) => setProductId(event.target.value)}>{data.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label><label className="form-field full"><span>Kho <b>*</b></span><select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{data.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><label className="form-field full"><span>Chênh lệch số lượng <b>*</b></span><input required type="number" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /><small className="field-help">Nhập số dương để tăng, số âm để giảm tồn kho.</small></label><label className="form-field full"><span>Lý do điều chỉnh <b>*</b></span><textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: Chênh lệch sau kiểm kê định kỳ" /></label></div><FormActions onCancel={onClose} submit={saving ? 'Đang ghi nhận…' : 'Ghi nhận điều chỉnh'} disabled={saving} /></form>
}

export function InventoryPage() {
  const { data, adjustStock } = useWarehouse()
  const [query, setQuery] = useState('')
  const [warehouse, setWarehouse] = useState('Tất cả kho')
  const [status, setStatus] = useState('Mọi trạng thái')
  const [page, setPage] = useState(1)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const entries = useMemo(() => data.inventory.map((entry) => {
    const product = data.products.find((item) => item.id === entry.productId)
    return { ...entry, product, warehouseInfo: data.warehouses.find((item) => item.id === entry.warehouseId), state: !product || entry.quantity <= product.minStock ? 'Sắp hết' : entry.quantity <= product.minStock * 1.5 ? 'Thấp' : 'Đủ hàng' }
  }).filter((entry) => {
    const term = query.toLowerCase()
    return entry.product && entry.warehouseInfo && (!term || `${entry.product.name} ${entry.product.sku} ${entry.location}`.toLowerCase().includes(term)) && (warehouse === 'Tất cả kho' || entry.warehouseId === warehouse) && (status === 'Mọi trạng thái' || entry.state === status)
  }), [data, query, warehouse, status])
  const pages = Math.max(1, Math.ceil(entries.length / 10))
  const saveAdjustment = async (productId: string, warehouseId: string, quantity: number, reason: string) => {
    setSaving(true)
    try { await adjustStock(productId, warehouseId, quantity, reason); setAdjustOpen(false); notify('Đã ghi nhận điều chỉnh tồn kho và tạo giao dịch.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Không thể điều chỉnh tồn kho.', 'error') }
    finally { setSaving(false) }
  }
  const exportCsv = () => {
    const rows = [['SKU', 'Sản phẩm', 'Kho', 'Vị trí', 'Số lượng', 'Trạng thái'], ...entries.map((entry) => [entry.product?.sku ?? '', entry.product?.name ?? '', entry.warehouseInfo?.name ?? '', entry.location, String(entry.quantity), entry.state])]
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\uFEFF' + rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })); link.download = 'ton-kho.csv'; link.click(); URL.revokeObjectURL(link.href)
  }
  return <div className="page-content"><PageHeader eyebrow="KIỂM SOÁT TỒN KHO" title="Tồn kho" description="Theo dõi số lượng thực tế tại từng kho và ghi nhận điều chỉnh có lịch sử." action={<><button className="button button-secondary" onClick={exportCsv}><Download size={16} />Xuất CSV</button><button className="button button-primary" onClick={() => setAdjustOpen(true)}><SlidersHorizontal size={16} />Điều chỉnh tồn</button></>} />
    <div className="inventory-overview"><div><span>Tổng lượng tồn</span><strong>{data.inventory.reduce((sum, item) => sum + item.quantity, 0).toLocaleString('vi-VN')}</strong><small>đơn vị hàng hóa tại {data.warehouses.length} kho</small></div><div><span>Mặt hàng sắp hết</span><strong className="text-warning">{data.products.filter((product) => data.inventory.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0) <= product.minStock).length}</strong><small>cần lên kế hoạch nhập thêm</small></div><div><span>Vị trí lưu trữ</span><strong>{data.inventory.length.toLocaleString('vi-VN')}</strong><small>vị trí đang được theo dõi</small></div></div>
    <div className="panel list-panel"><div className="list-toolbar"><label className="search-control"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Tìm sản phẩm, SKU, vị trí..." /></label><div className="toolbar-controls"><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)}><option>Tất cả kho</option>{data.warehouses.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option>Mọi trạng thái</option><option>Đủ hàng</option><option>Thấp</option><option>Sắp hết</option></select></div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>SẢN PHẨM</th><th>SKU</th><th>KHO</th><th>VỊ TRÍ</th><th>TỒN THỰC TẾ</th><th>ĐỊNH MỨC TỐI THIỂU</th><th>TRẠNG THÁI</th></tr></thead><tbody>{entries.slice((page - 1) * 10, page * 10).map((entry) => <tr key={`${entry.productId}-${entry.warehouseId}`}><td className="table-primary">{entry.product?.name}</td><td>{entry.product?.sku}</td><td>{entry.warehouseInfo?.code}</td><td><span className="location-pill">{entry.location}</span></td><td className={entry.state === 'Sắp hết' ? 'text-danger table-primary' : 'table-primary'}>{entry.quantity} {entry.product?.unit}</td><td>{entry.product?.minStock} {entry.product?.unit}</td><td><StatusBadge tone={entry.state === 'Sắp hết' ? 'danger' : entry.state === 'Thấp' ? 'warning' : 'success'}>{entry.state}</StatusBadge></td></tr>)}{entries.length === 0 && <tr><td colSpan={7}><div className="empty-state"><ClipboardList size={25} /><strong>Không có dữ liệu tồn kho</strong><span>Thử điều chỉnh bộ lọc.</span></div></td></tr>}</tbody></table></div><Pagination page={page} totalPages={pages} total={entries.length} onPageChange={setPage} />
     </div>{adjustOpen && <Modal title="Điều chỉnh tồn kho" subtitle="Mọi điều chỉnh sẽ tạo giao dịch và nhật ký kiểm toán." onClose={() => { if (!saving) setAdjustOpen(false) }}><AdjustmentForm onClose={() => setAdjustOpen(false)} onSave={saveAdjustment} saving={saving} /></Modal>}</div>
}
