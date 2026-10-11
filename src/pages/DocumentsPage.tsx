import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowDownLeft, ArrowUpRight, Camera, Check, Eye, Plus, Search, X } from 'lucide-react'
import { FormActions, Modal, PageHeader, Pagination, StatusBadge } from '../components/common'
import { BarcodeScannerDialog } from '../components/BarcodeScannerDialog'
import { useWarehouse } from '../data/WarehouseContext'
import { useScannerBasket } from '../features/scanner/ScannerBasketContext'
import { RemoteScannerButton } from '../features/scanner/RemoteScannerButton'
import { notify } from '../lib/feedback'
import type { ScanEvent, ScanFormat } from '../features/scanner/types'
import type { DocumentLine, Product, WarehouseDocument } from '../types'
import { Link } from 'react-router-dom'

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })

function DocumentForm({ type, onClose, onSave, saving }: { type: 'Nhập kho' | 'Xuất kho'; onClose: () => void; onSave: (doc: Omit<WarehouseDocument, 'id' | 'code' | 'createdAt' | 'status'>) => void; saving: boolean }) {
  const { data, loading, loadError, retryLoad, lookupBarcode, getNextSku, saveProduct } = useWarehouse()
  const { items: scannedItems } = useScannerBasket()
  const [warehouseId, setWarehouseId] = useState(data.warehouses[0]?.id ?? '')
  const [partner, setPartner] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [supplierQuery, setSupplierQuery] = useState('')
  const [supplierListOpen, setSupplierListOpen] = useState(false)
  const [activeSupplierIndex, setActiveSupplierIndex] = useState(0)
  const supplierComboboxRef = useRef<HTMLDivElement>(null)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<DocumentLine[]>(() => scannedItems.flatMap((item) => {
    const product = data.products.find((entry) => entry.id === item.productId)
    return product ? [{ productId: item.productId, quantity: item.quantity, unitCost: product.cost }] : []
  }))
  const linesRef = useRef(lines)
  const scansInFlightRef = useRef(new Set<string>())
  const updateLines = (change: (current: DocumentLine[]) => DocumentLine[]) => {
    const next = change(linesRef.current)
    linesRef.current = next
    setLines(next)
  }
  const [productId, setProductId] = useState(data.products[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [lastScan, setLastScan] = useState<{ barcode: string; status: 'pending' | 'success' | 'error'; message: string; product?: { name: string; sku: string; unit: string }; quantity?: number } | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [quickProduct, setQuickProduct] = useState<{ barcode: string; sku: string; name: string; category: string; unit: string; cost: string; minStock: string } | null>(null)
  const [quickProductError, setQuickProductError] = useState('')
  const [creatingProduct, setCreatingProduct] = useState(false)
  const available = (id: string) => data.inventory.find((item) => item.productId === id && item.warehouseId === warehouseId)?.quantity ?? 0
  const addLine = () => {
    if (!productId || quantity <= 0) return
    const product = data.products.find((item) => item.id === productId)
    if (!product) return
    updateLines((current) => {
      const exists = current.find((item) => item.productId === productId)
      return exists ? current.map((item) => item.productId === productId ? { ...item, quantity: item.quantity + quantity } : item) : [...current, { productId, quantity, unitCost: product.cost }]
    })
    setQuantity(1)
  }
  const addScannedProduct = async (barcode: string, format: ScanFormat, fromCamera = false) => {
    if (format === 'QR_CODE') {
      notify('QR không phải barcode sản phẩm.', 'error')
      return
    }
    if (scansInFlightRef.current.has(barcode)) return
    scansInFlightRef.current.add(barcode)
    setLastScan({ barcode, status: 'pending', message: 'Đang tra cứu sản phẩm trong kho…' })
    try {
      const product = await lookupBarcode(barcode)
      if (!product) {
        const message = `Không tìm thấy sản phẩm có barcode ${barcode}.`
        setLastScan({ barcode, status: 'error', message })
        if (type === 'Nhập kho') {
          if (fromCamera) setCameraOpen(false)
          setQuickProduct({ barcode, sku: '', name: '', category: data.categories[0] ?? '', unit: 'chiếc', cost: '0', minStock: '0' })
          setQuickProductError('')
          void getNextSku().then((sku) => setQuickProduct((current) => current?.barcode === barcode ? { ...current, sku } : current)).catch((error) => setQuickProductError(error instanceof Error ? error.message : 'Không lấy được SKU mới.'))
        }
        if (!fromCamera) notify(message, 'error')
        return
      }
      if (product.status !== 'Đang kinh doanh') {
        setQuickProduct(null)
        const message = `Sản phẩm ${product.name} đang ngừng kinh doanh.`
        setLastScan({ barcode, status: 'error', message, product: { name: product.name, sku: product.sku, unit: product.unit } })
        if (!fromCamera) notify(message, 'error')
        return
      }
      const existing = linesRef.current.find((line) => line.productId === product.id)
      const nextQuantity = (existing?.quantity ?? 0) + 1
      if (type === 'Xuất kho' && nextQuantity > available(product.id)) {
        const message = `Không đủ tồn kho ${product.name}. Có thể xuất tối đa ${available(product.id)} đơn vị tại kho đã chọn.`
        setLastScan({ barcode, status: 'error', message, product: { name: product.name, sku: product.sku, unit: product.unit } })
        if (!fromCamera) notify(message, 'error')
        return
      }
      updateLines((current) => current.some((line) => line.productId === product.id)
        ? current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { productId: product.id, quantity: 1, unitCost: product.cost }])
      const message = `Đã thêm ${product.name} vào phiếu ${type.toLowerCase()} dạng nháp.`
      setQuickProduct(null)
      setLastScan({ barcode, status: 'success', message, product: { name: product.name, sku: product.sku, unit: product.unit }, quantity: nextQuantity })
      if (!fromCamera) notify(message)
    } catch (error) {
      const message = error instanceof Error ? `Không thể tra cứu sản phẩm: ${error.message}` : 'Không thể tra cứu sản phẩm với backend.'
      setLastScan({ barcode, status: 'error', message })
      if (!fromCamera) notify(message, 'error')
    } finally {
      scansInFlightRef.current.delete(barcode)
    }
  }
  const createScannedProduct = async () => {
    if (!quickProduct || type !== 'Nhập kho' || creatingProduct) return
    const name = quickProduct.name.trim()
    const sku = quickProduct.sku.trim()
    const unit = quickProduct.unit.trim()
    const cost = Number(quickProduct.cost)
    const minStock = Number(quickProduct.minStock)
    if (!sku || !name || !quickProduct.category || !unit || !Number.isFinite(cost) || cost < 0 || !Number.isInteger(minStock) || minStock < 0) {
      setQuickProductError('Kiểm tra SKU, tên, danh mục, đơn vị, giá nhập và định mức tồn tối thiểu.')
      return
    }
    setCreatingProduct(true)
    setQuickProductError('')
    try {
      const product: Omit<Product, 'id' | 'createdAt'> = { sku, barcode: quickProduct.barcode, name, category: quickProduct.category, unit, cost, minStock, status: 'Đang kinh doanh' }
      const savedProduct = await saveProduct(product)
      updateLines((current) => current.some((line) => line.productId === savedProduct.id)
        ? current.map((line) => line.productId === savedProduct.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { productId: savedProduct.id, quantity: 1, unitCost: savedProduct.cost }])
      const message = `Đã tạo ${savedProduct.name} và thêm vào phiếu nhập dạng nháp.`
      setLastScan({ barcode: savedProduct.barcode, status: 'success', message, product: { name: savedProduct.name, sku: savedProduct.sku, unit: savedProduct.unit }, quantity: 1 })
      setQuickProduct(null)
      notify(message)
    } catch (error) {
      setQuickProductError(error instanceof Error ? error.message : 'Không thể tạo sản phẩm.')
    } finally {
      setCreatingProduct(false)
    }
  }
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0)
  const availableSuppliers = data.suppliers.filter((supplier) => supplier.active && `${supplier.name} ${supplier.code} ${supplier.phone}`.toLowerCase().includes(supplierQuery.trim().toLowerCase()))
  const selectedSupplier = data.suppliers.find((supplier) => supplier.id === supplierId && supplier.active)
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !supplierComboboxRef.current?.contains(event.target)) setSupplierListOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])
  const selectSupplier = (id: string) => {
    const supplier = data.suppliers.find((item) => item.id === id && item.active)
    if (!supplier) return
    setSupplierId(supplier.id)
    setSupplierQuery(supplier.name)
    setSupplierListOpen(false)
  }
  const handleSupplierKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setSupplierListOpen(false)
      return
    }
    if (event.key === 'ArrowDown' && availableSuppliers.length) {
      event.preventDefault()
      setSupplierListOpen(true)
      setActiveSupplierIndex((index) => (index + 1) % availableSuppliers.length)
    } else if (event.key === 'ArrowUp' && availableSuppliers.length) {
      event.preventDefault()
      setSupplierListOpen(true)
      setActiveSupplierIndex((index) => index < 0 ? availableSuppliers.length - 1 : (index - 1 + availableSuppliers.length) % availableSuppliers.length)
    } else if (event.key === 'Enter' && supplierListOpen && availableSuppliers.length) {
      event.preventDefault()
      selectSupplier(availableSuppliers[activeSupplierIndex]?.id ?? availableSuppliers[0].id)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!lines.length) { notify('Vui lòng thêm ít nhất một sản phẩm vào phiếu.', 'error'); return }
    if (type === 'Nhập kho' && !selectedSupplier) { notify('Vui lòng chọn nhà cung cấp đang hoạt động.', 'error'); return }
    onSave({ type, warehouseId, supplierId: type === 'Nhập kho' ? selectedSupplier?.id : undefined, partner: type === 'Nhập kho' ? selectedSupplier?.name ?? '' : partner.trim(), note: note.trim(), lines })
  }
  return <form onSubmit={submit}><div className="form-grid"><label className="form-field"><span>Kho {type === 'Nhập kho' ? 'nhận' : 'xuất'} <b>*</b></span><select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{data.warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{type === 'Nhập kho' ? <div className="form-field"><span>Nhà cung cấp <b>*</b></span>{loading ? <small className="field-help">Đang tải danh sách nhà cung cấp…</small> : loadError ? <><small className="field-error">{loadError}</small><button type="button" className="button button-secondary supplier-create-link" onClick={retryLoad}>Tải lại dữ liệu</button></> : data.suppliers.some((supplier) => supplier.active) ? <div className="supplier-combobox" ref={supplierComboboxRef}><input role="combobox" aria-autocomplete="list" aria-expanded={supplierListOpen && supplierQuery.trim().length > 0} aria-controls="supplier-suggestions" aria-activedescendant={supplierListOpen && activeSupplierIndex >= 0 && availableSuppliers[activeSupplierIndex] ? `supplier-option-${availableSuppliers[activeSupplierIndex].id}` : undefined} required={!selectedSupplier} value={supplierQuery} onFocus={() => { if (!selectedSupplier && supplierQuery.trim()) setSupplierListOpen(true) }} onChange={(event) => { setSupplierQuery(event.target.value); setSupplierId(''); setActiveSupplierIndex(-1); setSupplierListOpen(Boolean(event.target.value.trim())) }} onKeyDown={handleSupplierKeyDown} placeholder="Nhập tên, mã hoặc điện thoại nhà cung cấp" aria-label="Tìm và chọn nhà cung cấp" />{supplierListOpen && supplierQuery.trim() && <div className="supplier-suggestions" id="supplier-suggestions" role="listbox" aria-label="Nhà cung cấp phù hợp">{availableSuppliers.length ? availableSuppliers.map((supplier, index) => <button type="button" role="option" aria-selected={index === activeSupplierIndex} id={`supplier-option-${supplier.id}`} key={supplier.id} className={`supplier-suggestion${index === activeSupplierIndex ? ' active' : ''}`} onMouseEnter={() => setActiveSupplierIndex(index)} onClick={() => selectSupplier(supplier.id)}><strong>{supplier.name}</strong><span>{supplier.code}{supplier.phone ? ` · ${supplier.phone}` : ''}</span></button>) : <div className="supplier-suggestion-empty">Không tìm thấy nhà cung cấp phù hợp.</div>}</div>}{selectedSupplier && <small className="field-help">Đã chọn {selectedSupplier.code} · mã nhà cung cấp sẽ được liên kết với phiếu.</small>}</div> : <><small className="field-help">Chưa có nhà cung cấp đang hoạt động.</small><Link className="button button-secondary supplier-create-link" to="/suppliers" onClick={onClose}>Thêm nhà cung cấp</Link></>}</div> : <label className="form-field"><span>Người nhận / đơn hàng <b>*</b></span><input required value={partner} onChange={(event) => setPartner(event.target.value)} placeholder="Tên người nhận hoặc mã đơn hàng" /></label>}</div>
    <div className="form-section-title"><div><strong>Sản phẩm trong phiếu</strong><small>{type === 'Nhập kho' ? 'Dùng điện thoại quét QR để kết nối, sau đó quét barcode sản phẩm.' : 'Quét barcode để tra cứu rồi thêm vào bản nháp; quét lại sẽ tăng số lượng.'}</small></div>{type === 'Nhập kho' && <div className="scanner-actions-group"><RemoteScannerButton onScan={(event: ScanEvent) => { void addScannedProduct(event.barcode, event.format) }} disabled={saving} className="button button-primary scanner-context-button" label="Quét bằng điện thoại (QR)" /><button type="button" className="button button-secondary scanner-context-button" onClick={() => setCameraOpen(true)} disabled={saving}><Camera size={16} />Quét trên thiết bị này</button></div>}</div>
    {lastScan && <div className={`scanner-last-result ${lastScan.status}`} role="status"><div><strong>{lastScan.product?.name ?? lastScan.barcode}</strong><small>{lastScan.product ? `SKU ${lastScan.product.sku} · Barcode ${lastScan.barcode} · ${lastScan.product.unit}` : lastScan.barcode}</small></div><span>{lastScan.status === 'success' && lastScan.quantity ? `Số lượng phiếu: ${lastScan.quantity} ${lastScan.product?.unit ?? ''}` : lastScan.message}{lastScan.status === 'error' && !lastScan.product && <Link to={`/products?q=${encodeURIComponent(lastScan.barcode)}`} target="_blank" rel="noreferrer">Mở quản lý sản phẩm</Link>}</span></div>}
    {quickProduct && type === 'Nhập kho' && <section className="scanner-product-create" aria-label="Tạo nhanh sản phẩm từ barcode"><div className="scanner-product-create-heading"><div><strong>Tạo sản phẩm từ mã vừa quét</strong><small>Barcode được giữ nguyên; sản phẩm sẽ vào danh mục chung và dòng phiếu nhập vẫn ở trạng thái nháp.</small></div><button type="button" className="icon-button" aria-label="Hủy tạo sản phẩm" onClick={() => setQuickProduct(null)}><X size={16} /></button></div><div className="form-grid"><label className="form-field"><span>Barcode</span><input value={quickProduct.barcode} readOnly /></label><label className="form-field"><span>Mã SKU <b>*</b></span><input required value={quickProduct.sku} onChange={(event) => setQuickProduct((current) => current ? { ...current, sku: event.target.value.toUpperCase() } : current)} /></label><label className="form-field full"><span>Tên sản phẩm <b>*</b></span><input required autoFocus value={quickProduct.name} onChange={(event) => setQuickProduct((current) => current ? { ...current, name: event.target.value } : current)} /></label><label className="form-field"><span>Danh mục <b>*</b></span><select required value={quickProduct.category} onChange={(event) => setQuickProduct((current) => current ? { ...current, category: event.target.value } : current)}><option value="">Chọn danh mục</option>{data.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label className="form-field"><span>Đơn vị tính <b>*</b></span><input required value={quickProduct.unit} onChange={(event) => setQuickProduct((current) => current ? { ...current, unit: event.target.value } : current)} /></label><label className="form-field"><span>Giá nhập (₫) <b>*</b></span><input type="number" min="0" step="0.01" required value={quickProduct.cost} onChange={(event) => setQuickProduct((current) => current ? { ...current, cost: event.target.value } : current)} /></label><label className="form-field"><span>Ngưỡng tồn tối thiểu</span><input type="number" min="0" step="1" value={quickProduct.minStock} onChange={(event) => setQuickProduct((current) => current ? { ...current, minStock: event.target.value } : current)} /></label></div>{data.categories.length === 0 && <small className="field-error">Cần có danh mục trước khi tạo sản phẩm.</small>}{quickProductError && <small className="field-error" role="alert">{quickProductError}</small>}<div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setQuickProduct(null)} disabled={creatingProduct}>Hủy</button><button type="button" className="button button-primary" onClick={() => void createScannedProduct()} disabled={creatingProduct || !quickProduct.sku || !quickProduct.name.trim() || !quickProduct.category || !quickProduct.unit.trim() || !data.categories.length}>{creatingProduct ? 'Đang lưu sản phẩm…' : 'Lưu sản phẩm & thêm vào phiếu'}</button></div></section>}
    <div className="add-line-row"><select value={productId} onChange={(event) => setProductId(event.target.value)}>{data.products.filter((item) => item.status === 'Đang kinh doanh').map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select><div className="quantity-input-wrap"><input aria-label="Số lượng" type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />{type === 'Xuất kho' && <small>Còn {available(productId)}</small>}</div><button type="button" className="button button-secondary add-line-button" onClick={addLine}><Plus size={15} />Thêm</button></div>
     {lines.length > 0 && <div className="line-items">{lines.map((line) => { const product = data.products.find((item) => item.id === line.productId); return <div className="line-item" key={line.productId}><div className="line-product"><strong>{product?.name}</strong><small>{product?.sku} · {line.quantity} {product?.unit}</small></div>{type === 'Nhập kho' && <label className="line-cost"><span>Đơn giá</span><input type="number" min="0" value={line.unitCost} onChange={(event) => updateLines((current) => current.map((item) => item.productId === line.productId ? { ...item, unitCost: Number(event.target.value) } : item))} /></label>}<strong className="line-total">{money.format(line.quantity * line.unitCost)}</strong><button type="button" className="line-remove" aria-label="Xóa sản phẩm" onClick={() => updateLines((current) => current.filter((item) => item.productId !== line.productId))}><X size={15} /></button></div>})}<div className="line-grand-total"><span>Tổng giá trị phiếu</span><strong>{money.format(total)}</strong></div></div>}
      <label className="form-field form-note"><span>Ghi chú</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Thông tin bổ sung cho phiếu..." /></label><FormActions onCancel={onClose} submit={saving ? 'Đang lưu…' : 'Lưu phiếu nháp'} disabled={saving} />{cameraOpen && type === 'Nhập kho' && <BarcodeScannerDialog continuous onClose={() => setCameraOpen(false)} onDetected={(barcode, format) => { void addScannedProduct(barcode, format, true) }} />}</form>
}

export function DocumentsPage({ type }: { type: 'Nhập kho' | 'Xuất kho' }) {
  const { data, saveDocument, confirmDocument, cancelDocument } = useWarehouse()
  const { clear: clearScannedItems } = useScannerBasket()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('Tất cả trạng thái')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<WarehouseDocument | null>(null)
  const [saving, setSaving] = useState(false)
  const [processing, setProcessing] = useState<string | null>(null)
  const filtered = useMemo(() => data.documents.filter((document) => document.type === type && (status === 'Tất cả trạng thái' || document.status === status) && `${document.code} ${document.partner} ${data.warehouses.find((item) => item.id === document.warehouseId)?.name ?? ''}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [data, query, status, type])
  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const icon = type === 'Nhập kho' ? ArrowDownLeft : ArrowUpRight
  const Icon = icon
  const save = async (document: Omit<WarehouseDocument, 'id' | 'code' | 'createdAt' | 'status'>) => {
    setSaving(true)
    try {
      await saveDocument(document)
      clearScannedItems()
      setCreateOpen(false)
      notify('Đã lưu phiếu nháp. Xác nhận phiếu để cập nhật tồn kho.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Không thể lưu phiếu.', 'error') }
    finally { setSaving(false) }
  }
  const process = async (documentId: string, action: () => Promise<void>, success: string) => {
    setProcessing(documentId)
    try { await action(); notify(success) }
    catch (error) { notify(error instanceof Error ? error.message : 'Không thể xử lý phiếu.', 'error') }
    finally { setProcessing(null) }
  }

  return <div className="page-content"><PageHeader eyebrow="NGHIỆP VỤ KHO" title={type} description={type === 'Nhập kho' ? 'Theo dõi và xử lý các phiếu hàng hóa nhập vào kho.' : 'Tạo phiếu giao hàng và kiểm soát lượng hàng xuất kho.'} action={<button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={17} />Tạo phiếu {type.toLowerCase()}</button>} />
    <div className="document-summary"><div className="summary-icon"><Icon size={19} /></div><div><strong>{filtered.length} phiếu {type.toLowerCase()}</strong><span>Phiếu nháp chỉ cập nhật tồn kho sau khi được xác nhận.</span></div><div className="summary-breakdown"><span><i className="summary-dot amber" />{filtered.filter((item) => item.status === 'Bản nháp').length} bản nháp</span><span><i className="summary-dot green" />{filtered.filter((item) => item.status === 'Đã xác nhận').length} đã xác nhận</span></div></div>
    <div className="panel list-panel"><div className="list-toolbar"><label className="search-control"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Tìm mã phiếu, đối tác, kho..." /></label><div className="toolbar-controls"><select value={status} onChange={(event) => setStatus(event.target.value)}><option>Tất cả trạng thái</option><option>Bản nháp</option><option>Đã xác nhận</option><option>Đã hủy</option></select></div></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>MÃ PHIẾU</th><th>{type === 'Nhập kho' ? 'NHÀ CUNG CẤP' : 'NGƯỜI NHẬN / ĐƠN HÀNG'}</th><th>KHO</th><th>SẢN PHẨM</th><th>TỔNG GIÁ TRỊ</th><th>NGÀY TẠO</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>{filtered.slice((page - 1) * 10, page * 10).map((document) => { const amount = document.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0); const supplierName = data.suppliers.find((supplier) => supplier.id === document.supplierId)?.name; return <tr key={document.id}><td className="table-primary">{document.code}</td><td>{(supplierName ?? document.partner) || '—'}</td><td>{data.warehouses.find((item) => item.id === document.warehouseId)?.code ?? '—'}</td><td>{document.lines.reduce((sum, line) => sum + line.quantity, 0)} sản phẩm</td><td>{money.format(amount)}</td><td>{new Date(document.createdAt).toLocaleDateString('vi-VN')}</td><td><StatusBadge tone={document.status === 'Đã xác nhận' ? 'success' : document.status === 'Bản nháp' ? 'warning' : 'neutral'}>{document.status}</StatusBadge></td><td><div className="table-buttons"><button className="icon-button" title="Xem chi tiết" onClick={() => setDetail(document)}><Eye size={16} /></button>{document.status === 'Bản nháp' && <><button className="icon-button confirm-action" title="Xác nhận phiếu" disabled={processing !== null} onClick={() => void process(document.id, () => confirmDocument(document.id), `Đã xác nhận ${document.code} và cập nhật tồn kho.`)}><Check size={16} /></button><button className="icon-button cancel-action" title="Hủy phiếu" disabled={processing !== null} onClick={() => { if (window.confirm(`Hủy phiếu ${document.code}?`)) void process(document.id, () => cancelDocument(document.id), 'Đã hủy phiếu nháp.') }}><X size={16} /></button></>}</div></td></tr>})}{filtered.length === 0 && <tr><td colSpan={8}><div className="empty-state"><Icon size={25} /><strong>Chưa có phiếu phù hợp</strong><span>Điều chỉnh bộ lọc hoặc tạo phiếu mới.</span></div></td></tr>}</tbody></table></div>
      <Pagination page={page} totalPages={pages} total={filtered.length} onPageChange={setPage} />
    </div>
     {createOpen && <Modal title={`Tạo phiếu ${type.toLowerCase()}`} subtitle="Phiếu được lưu ở trạng thái nháp trước khi xác nhận." onClose={() => { if (!saving) setCreateOpen(false) }} wide><DocumentForm type={type} onClose={() => setCreateOpen(false)} onSave={save} saving={saving} /></Modal>}
      {detail && <Modal title={`Chi tiết ${detail.code}`} subtitle={`${detail.type} · ${new Date(detail.createdAt).toLocaleString('vi-VN')}`} onClose={() => setDetail(null)}><div className="detail-summary"><StatusBadge tone={detail.status === 'Đã xác nhận' ? 'success' : detail.status === 'Bản nháp' ? 'warning' : 'neutral'}>{detail.status}</StatusBadge><span>{data.warehouses.find((item) => item.id === detail.warehouseId)?.name}</span><strong>{data.suppliers.find((supplier) => supplier.id === detail.supplierId)?.name ?? detail.partner}</strong></div><div className="detail-lines">{detail.lines.map((line) => { const product = data.products.find((item) => item.id === line.productId); return <div key={line.productId}><span>{product?.name}<small>{product?.sku} · {line.quantity} {product?.unit}</small></span><strong>{money.format(line.quantity * line.unitCost)}</strong></div>})}</div>{detail.note && <p className="detail-note">Ghi chú: {detail.note}</p>}</Modal>}
  </div>
}
