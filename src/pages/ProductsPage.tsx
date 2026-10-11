import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Download, Eye, MoreHorizontal, PackagePlus, Pencil, Plus, ScanLine, Search, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { FormActions, Modal, PageHeader, Pagination, StatusBadge } from '../components/common'
import { BarcodeScannerDialog } from '../components/BarcodeScannerDialog'
import { useWarehouse, WarehouseApiError } from '../data/WarehouseContext'
import { notify } from '../lib/feedback'
import type { Product } from '../types'

const blankProduct = { sku: '', barcode: '', name: '', category: '', unit: 'chiếc', cost: 0, minStock: 1, status: 'Đang kinh doanh' as const }
const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
const apiEnabled = Boolean(import.meta.env.VITE_API_BASE_URL?.trim())

function ProductForm({ product, categories, onSave, onClose, saving, getNextSku, lookupProduct, scannerOpen, onScannerOpenChange }: { product: Product | null; categories: string[]; onSave: (value: Omit<Product, 'id' | 'createdAt'>) => Promise<void>; onClose: () => void; saving: boolean; getNextSku: () => Promise<string>; lookupProduct: (code: string) => Promise<Product | null>; scannerOpen: boolean; onScannerOpenChange: (open: boolean) => void }) {
  const [form, setForm] = useState<Omit<Product, 'id' | 'createdAt'>>(product ? { sku: product.sku, barcode: product.barcode, name: product.name, category: product.category, unit: product.unit, cost: product.cost, minStock: product.minStock, status: product.status } : { ...blankProduct, category: categories[0] ?? '' })
  const [skuLoading, setSkuLoading] = useState(!product)
  const [checkingBarcode, setCheckingBarcode] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{ sku?: string; barcode?: string }>({})
  useEffect(() => {
    if (product) return
    let active = true
    setSkuLoading(true)
    getNextSku().then((sku) => {
      if (active) setForm((current) => current.sku ? current : { ...current, sku })
    }).catch((error: unknown) => {
      if (active) notify(error instanceof Error ? error.message : 'Không thể đề xuất SKU. Bạn có thể nhập thủ công.', 'error')
    }).finally(() => {
      if (active) setSkuLoading(false)
    })
    return () => { active = false }
  }, [product?.id])
  const update = (key: keyof typeof form, value: string | number) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (key === 'sku' || key === 'barcode') setFieldErrors((current) => ({ ...current, [key]: undefined }))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || checkingBarcode) return
    setFieldErrors({})
    const payload = { ...form, sku: form.sku.trim(), barcode: form.barcode.trim() }
    const barcode = payload.barcode
    if (barcode.length > 160) {
      setFieldErrors({ barcode: 'Barcode không được vượt quá 160 ký tự.' })
      return
    }
    if (barcode) {
      setCheckingBarcode(true)
      try {
        const existing = await lookupProduct(barcode)
        if (existing && existing.id !== product?.id && existing.barcode.trim().toLowerCase() === barcode.toLowerCase()) {
          setFieldErrors({ barcode: 'Barcode này đã được sử dụng cho sản phẩm khác.' })
          return
        }
      } catch (error) {
        setFieldErrors({ barcode: error instanceof Error ? `Không thể kiểm tra barcode với backend: ${error.message}` : 'Không thể kiểm tra barcode với backend.' })
        return
      } finally {
        setCheckingBarcode(false)
      }
    }
    try {
      await onSave(payload)
    } catch (error) {
      const code = error instanceof WarehouseApiError ? error.code : undefined
      const message = error instanceof Error ? error.message : 'Không thể lưu sản phẩm.'
      if (code === 'DUPLICATE_SKU' || /sku/i.test(message)) setFieldErrors((current) => ({ ...current, sku: message }))
      else if (code === 'DUPLICATE_BARCODE' || /barcode/i.test(message)) setFieldErrors((current) => ({ ...current, barcode: message }))
    }
  }
  return <form onSubmit={submit}><div className="form-grid">
    <label className="form-field"><span>Mã SKU <b>*</b></span><input required value={form.sku} onChange={(event) => update('sku', event.target.value.toUpperCase())} placeholder={skuLoading ? 'Đang đề xuất SKU…' : 'VD: SP-000001'} aria-invalid={Boolean(fieldErrors.sku)} />{fieldErrors.sku && <small className="field-error">{fieldErrors.sku}</small>}</label>
    <div className="form-field"><label><span>Mã vạch</span><div className="barcode-input-row"><input maxLength={160} value={form.barcode} onChange={(event) => update('barcode', event.target.value)} placeholder="Nhập hoặc quét mã" aria-label="Mã vạch" aria-invalid={Boolean(fieldErrors.barcode)} /><button type="button" className="button button-secondary" onClick={() => onScannerOpenChange(true)} disabled={saving}><ScanLine size={14} />Quét trực tiếp</button></div></label><small className="field-help">Nhập tay, dùng camera trên thiết bị này hoặc máy quét USB/Bluetooth.</small>{fieldErrors.barcode && <small className="field-error">{fieldErrors.barcode}</small>}</div>
    <label className="form-field full"><span>Tên sản phẩm <b>*</b></span><input required value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Tên sản phẩm" /></label>
    <label className="form-field"><span>Danh mục <b>*</b></span><select required value={form.category} onChange={(event) => update('category', event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="form-field"><span>Đơn vị tính</span><input value={form.unit} onChange={(event) => update('unit', event.target.value)} placeholder="chiếc" /></label>
    <label className="form-field"><span>Giá nhập (₫) <b>*</b></span><input type="number" min="0" required value={form.cost} onChange={(event) => update('cost', Number(event.target.value))} /></label>
    <label className="form-field"><span>Ngưỡng tồn tối thiểu</span><input type="number" min="0" value={form.minStock} onChange={(event) => update('minStock', Number(event.target.value))} /></label>
    <label className="form-field full"><span>Trạng thái</span><select value={form.status} onChange={(event) => update('status', event.target.value)}><option>Đang kinh doanh</option><option>Ngừng kinh doanh</option></select></label>
  </div><FormActions onCancel={onClose} submit={checkingBarcode ? 'Đang kiểm tra barcode…' : saving ? 'Đang lưu…' : product ? 'Lưu thay đổi' : 'Tạo sản phẩm'} disabled={saving || checkingBarcode} />{scannerOpen && <BarcodeScannerDialog confirmBeforeApply={Boolean(product?.barcode)} onClose={() => onScannerOpenChange(false)} onDetected={(barcode) => { update('barcode', barcode); notify('Đã điền mã vạch. Hãy kiểm tra trước khi lưu.') }} />}</form>
}

export function ProductsPage() {
  const { data, saveProduct, deleteProduct, getNextSku, lookupProduct } = useWarehouse()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [category, setCategory] = useState('Tất cả danh mục')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Product | null | undefined>(undefined)
  const [viewing, setViewing] = useState<Product | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  useEffect(() => { setQuery(params.get('q') ?? '') }, [params])
  const filtered = useMemo(() => data.products.filter((product) => {
    const term = query.toLowerCase()
    return (!term || [product.name, product.sku, product.barcode].some((value) => value.toLowerCase().includes(term))) && (category === 'Tất cả danh mục' || product.category === category)
  }).sort((a, b) => sort === 'stock' ? quantity(b.id) - quantity(a.id) : sort === 'cost' ? b.cost - a.cost : a.name.localeCompare(b.name, 'vi')), [data, query, category, sort])
  function quantity(productId: string) { return data.inventory.filter((item) => item.productId === productId).reduce((sum, item) => sum + item.quantity, 0) }
  const totalPages = Math.max(1, Math.ceil(filtered.length / 10))
  const visible = filtered.slice((page - 1) * 10, page * 10)
  const handleQuery = (value: string) => { setQuery(value); setPage(1); if (params.has('q')) setParams(value ? { q: value } : {}) }
  const remove = async (productId: string) => { try { await deleteProduct(productId); notify('Đã xóa sản phẩm.') } catch (error) { notify(error instanceof Error ? error.message : 'Không thể xóa sản phẩm.', 'error') } }
  const handleSave = async (value: Omit<Product, 'id' | 'createdAt'>) => {
    setSaving(true)
    try { await saveProduct(value, editing?.id); notify(editing ? 'Đã cập nhật sản phẩm.' : 'Đã tạo sản phẩm mới.'); setEditing(undefined) }
    catch (error) { notify(error instanceof Error ? error.message : 'Không thể lưu sản phẩm.', 'error'); throw error }
    finally { setSaving(false) }
  }
  const exportCsv = () => {
    const rows = [['SKU', 'Barcode', 'Tên sản phẩm', 'Danh mục', 'Đơn vị', 'Giá nhập', 'Tồn kho', 'Trạng thái'], ...filtered.map((item) => [item.sku, item.barcode, item.name, item.category, item.unit, String(item.cost), String(quantity(item.id)), item.status])]
    const content = '\uFEFF' + rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'danh-sach-san-pham.csv'; link.click(); URL.revokeObjectURL(url)
  }

  return <div className="page-content"><PageHeader eyebrow="DANH MỤC HÀNG HÓA" title="Sản phẩm" description="Quản lý thông tin sản phẩm, mã SKU và định mức tồn kho." action={<><button className="button button-secondary" onClick={exportCsv}><Download size={16} />Xuất CSV</button><button className="button button-primary" onClick={() => setEditing(null)}><Plus size={17} />Thêm sản phẩm</button></>} />
    <div className="panel list-panel"><div className="list-toolbar"><label className="search-control"><Search size={17} /><input placeholder="Tìm tên, SKU hoặc barcode..." value={query} onChange={(event) => handleQuery(event.target.value)} /></label><div className="toolbar-controls"><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}><option>Tất cả danh mục</option>{data.categories.map((item) => <option key={item}>{item}</option>)}</select><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Sắp xếp: Tên A–Z</option><option value="stock">Tồn kho cao nhất</option><option value="cost">Giá nhập cao nhất</option></select></div></div>
      <div className="table-scroll"><table className="data-table product-table"><thead><tr><th>SẢN PHẨM</th><th>MÃ SKU / BARCODE</th><th>DANH MỤC</th><th>GIÁ NHẬP</th><th>TỒN KHO</th><th>TRẠNG THÁI</th><th /></tr></thead><tbody>{visible.map((product, index) => { const stock = quantity(product.id); const danger = stock <= product.minStock; return <tr key={product.id}><td><div className="product-cell"><div className={`product-avatar avatar-${index % 5}`}>{product.name.charAt(0)}</div><div><strong>{product.name}</strong><small>{product.unit}</small></div></div></td><td><div className="code-cell"><strong>{product.sku}</strong><small>{product.barcode || '—'}</small></div></td><td>{product.category}</td><td className="table-primary">{money.format(product.cost)}</td><td><div className="stock-cell"><strong className={danger ? 'text-danger' : ''}>{stock}</strong><small>{product.unit}{danger ? ' · Sắp hết' : ''}</small></div></td><td><StatusBadge tone={product.status === 'Đang kinh doanh' ? 'success' : 'neutral'}>{product.status}</StatusBadge></td><td className="table-action"><div className="row-menu-wrap"><button className="icon-button row-menu" aria-label={`Tùy chọn ${product.name}`} onClick={() => setMenuId(menuId === product.id ? null : product.id)}><MoreHorizontal size={18} /></button>{menuId === product.id && <div className="row-menu-pop"><button onClick={() => { setViewing(product); setMenuId(null) }}><Eye size={14} />Xem chi tiết</button><button onClick={() => { setEditing(product); setMenuId(null) }}><Pencil size={14} />Chỉnh sửa</button><button className="danger-menu" onClick={() => { if (window.confirm(`Bạn có chắc muốn xóa ${product.name}?`)) { void remove(product.id) } setMenuId(null) }}><Trash2 size={14} />Xóa sản phẩm</button></div>}</div></td></tr>})}{visible.length === 0 && <tr><td colSpan={7}><div className="empty-state"><PackagePlus size={25} /><strong>Không tìm thấy sản phẩm</strong><span>Thử thay đổi từ khóa hoặc bộ lọc.</span></div></td></tr>}</tbody></table></div>
      <Pagination page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
    </div>
    {editing !== undefined && <Modal title={editing ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm mới'} subtitle={apiEnabled ? 'Thông tin sẽ được lưu qua API vào cơ sở dữ liệu kho.' : 'Thông tin sẽ được lưu trong dữ liệu kho trên thiết bị này.'} onClose={() => { if (!saving) setEditing(undefined) }} closeOnEscape={!scannerOpen}><ProductForm product={editing} categories={data.categories} onSave={handleSave} onClose={() => setEditing(undefined)} saving={saving} getNextSku={getNextSku} lookupProduct={lookupProduct} scannerOpen={scannerOpen} onScannerOpenChange={setScannerOpen} /></Modal>}
    {viewing && <Modal title="Thông tin sản phẩm" subtitle={`${viewing.sku} · ${viewing.barcode || 'Chưa có barcode'}`} onClose={() => setViewing(null)}><div className="product-detail-card"><div className="product-detail-title"><div className="product-avatar avatar-0">{viewing.name.charAt(0)}</div><div><strong>{viewing.name}</strong><span>{viewing.category} · {viewing.unit}</span></div></div><div className="detail-lines"><div><span>Giá nhập</span><strong>{money.format(viewing.cost)}</strong></div><div><span>Định mức tồn tối thiểu</span><strong>{viewing.minStock} {viewing.unit}</strong></div>{data.warehouses.map((warehouse) => <div key={warehouse.id}><span>{warehouse.name}<small>{data.inventory.find((item) => item.productId === viewing.id && item.warehouseId === warehouse.id)?.location ?? 'Chưa xếp vị trí'}</small></span><strong>{data.inventory.find((item) => item.productId === viewing.id && item.warehouseId === warehouse.id)?.quantity ?? 0} {viewing.unit}</strong></div>)}</div><div className="product-detail-footer"><StatusBadge tone={viewing.status === 'Đang kinh doanh' ? 'success' : 'neutral'}>{viewing.status}</StatusBadge><span>Tạo ngày {new Date(viewing.createdAt).toLocaleDateString('vi-VN')}</span></div></div></Modal>}
  </div>
}
