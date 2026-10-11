import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Camera, Check, Clock3, Download, FileBarChart, Minus, Plus, RotateCcw, ScanLine, Search, Settings, ShieldCheck, Trash2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { PageHeader, StatusBadge } from '../components/common'
import { BarcodeScannerDialog } from '../components/BarcodeScannerDialog'
import { useWarehouse, warehouseApiEnabled } from '../data/WarehouseContext'
import { useScannerBasket } from '../features/scanner/ScannerBasketContext'
import { RemoteScannerButton } from '../features/scanner/RemoteScannerButton'
import { scannerMode } from '../features/scanner/scannerService'
import type { ScanEvent, ScanResult } from '../features/scanner/types'
import { notify } from '../lib/feedback'
import type { Product } from '../types'

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })

export function ReportsPage() {
  const { data } = useWarehouse()
  const [period, setPeriod] = useState(30)
  const start = Date.now() - period * 86400000
  const transactions = data.transactions.filter((item) => new Date(item.createdAt).getTime() >= start)
  const stockValue = data.inventory.reduce((sum, item) => sum + item.quantity * (data.products.find((product) => product.id === item.productId)?.cost ?? 0), 0)
  const chartData = data.products.map((product) => ({ name: product.name.length > 17 ? `${product.name.slice(0, 17)}…` : product.name, quantity: transactions.filter((item) => item.productId === product.id && item.type === 'Xuất kho').reduce((sum, item) => sum + item.quantity, 0) })).filter((item) => item.quantity > 0).sort((a, b) => b.quantity - a.quantity).slice(0, 6)
  const summary = [{ label: 'Giá trị tồn kho', value: money.format(stockValue) }, { label: 'Lượt nhập hàng', value: transactions.filter((item) => item.type === 'Nhập kho').length.toLocaleString('vi-VN') }, { label: 'Lượt xuất hàng', value: transactions.filter((item) => item.type === 'Xuất kho').length.toLocaleString('vi-VN') }, { label: 'Giao dịch điều chỉnh', value: transactions.filter((item) => item.type === 'Điều chỉnh').length.toLocaleString('vi-VN') }]
  const exportCsv = () => { const rows = [['Sản phẩm', 'SKU', 'Số lượng xuất', 'Giá trị tồn'], ...data.products.map((product) => [product.name, product.sku, String(transactions.filter((item) => item.productId === product.id && item.type === 'Xuất kho').reduce((sum, item) => sum + item.quantity, 0)), String(data.inventory.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0) * product.cost)])]; const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'bao-cao-kho.csv'; link.click(); URL.revokeObjectURL(url) }
  return <div className="page-content"><PageHeader eyebrow="PHÂN TÍCH HIỆU SUẤT" title="Báo cáo & phân tích" description="Tổng hợp hoạt động kho dựa trên dữ liệu giao dịch thực tế của ứng dụng." action={<button className="button button-secondary" onClick={exportCsv}><Download size={16} />Xuất báo cáo CSV</button>} /><div className="list-toolbar report-toolbar"><span className="results-count">Khoảng thời gian báo cáo</span><select value={period} onChange={(event) => setPeriod(Number(event.target.value))}><option value={7}>7 ngày gần đây</option><option value={30}>30 ngày gần đây</option><option value={90}>90 ngày gần đây</option></select></div><div className="report-summary">{summary.map((item) => <div className="panel report-kpi" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div><div className="panel report-chart-panel"><div className="panel-heading"><div><h2>Sản phẩm xuất kho nhiều nhất</h2><p>Số lượng xuất trong {period} ngày gần đây</p></div></div>{chartData.length ? <div className="report-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 22, top: 8, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--chart-grid)" /><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><YAxis dataKey="name" type="category" width={160} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }} /><Bar dataKey="quantity" name="Số lượng xuất" fill="#4779e6" radius={[0, 5, 5, 0]} barSize={22} /></BarChart></ResponsiveContainer></div> : <div className="empty-state">Chưa có giao dịch xuất trong khoảng thời gian này.</div>}</div><div className="panel list-panel"><div className="panel-heading padded"><div><h2>Cảnh báo hàng tồn thấp</h2><p>Các sản phẩm cần bổ sung theo định mức</p></div><Link to="/inventory" className="text-link">Xem tồn kho <ArrowRight size={14} /></Link></div><div className="table-scroll"><table className="data-table"><thead><tr><th>SẢN PHẨM</th><th>SKU</th><th>SỐ LƯỢNG TỒN</th><th>ĐỊNH MỨC</th><th>GIÁ TRỊ TỒN</th><th>TRẠNG THÁI</th></tr></thead><tbody>{data.products.map((product) => ({ product, quantity: data.inventory.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0) })).filter(({ product, quantity }) => quantity <= product.minStock).map(({ product, quantity }) => <tr key={product.id}><td className="table-primary">{product.name}</td><td>{product.sku}</td><td>{quantity} {product.unit}</td><td>{product.minStock}</td><td>{money.format(quantity * product.cost)}</td><td><StatusBadge tone="danger">Sắp hết</StatusBadge></td></tr>)}</tbody></table></div></div></div>
}

export function BarcodePage() {
  const { data, lookupProduct } = useWarehouse()
  const { items: basket, addProduct, updateQuantity, removeProduct, clear } = useScannerBasket()
  const [value, setValue] = useState('')
  const [term, setTerm] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [scanResults, setScanResults] = useState<ScanResult[]>([])
  const processedEventsRef = useRef(new Set<string>())
  const lookupRequestRef = useRef(0)
  const [resolvedLookup, setResolvedLookup] = useState<{ code: string; product: Product | null } | null>(null)
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'not_found' | 'error'>('idle')
  const [lookupMessage, setLookupMessage] = useState('')
  const localProduct = useMemo(() => term ? data.products.find((item) => item.barcode.toLowerCase() === term.toLowerCase() || item.sku.toLowerCase() === term.toLowerCase()) : undefined, [data.products, term])
  const product = resolvedLookup?.code === term ? resolvedLookup.product ?? undefined : localProduct
  const stock = product ? data.inventory.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0) : 0
  const resolveCode = useCallback(async (code: string) => {
    const normalized = code.trim()
    if (!normalized) return null
    const requestId = ++lookupRequestRef.current
    setValue(normalized)
    setTerm(normalized)
    setResolvedLookup({ code: normalized, product: null })
    setLookupMessage('Đang tra cứu sản phẩm trong kho…')
    setLookupState('loading')
    try {
      const found = await lookupProduct(normalized)
      if (requestId === lookupRequestRef.current) {
        setResolvedLookup({ code: normalized, product: found })
        setLookupState(found ? 'idle' : 'not_found')
        setLookupMessage(found ? '' : 'Mã không tồn tại trong danh mục sản phẩm. Không có sản phẩm mới nào được tạo.')
      }
      return { product: found, failed: false }
    } catch (error) {
      if (requestId === lookupRequestRef.current) {
        setResolvedLookup({ code: normalized, product: null })
        setLookupState('error')
        setLookupMessage(error instanceof Error ? `Không thể tra cứu với backend: ${error.message}` : 'Không thể tra cứu với backend.')
      }
      return { product: null, failed: true }
    }
  }, [lookupProduct])
  const handleScan = useCallback(async (event: ScanEvent) => {
    if (processedEventsRef.current.has(event.eventId)) return
    processedEventsRef.current.add(event.eventId)
    if (processedEventsRef.current.size > 500) processedEventsRef.current.delete(processedEventsRef.current.values().next().value as string)
    if (event.format === 'QR_CODE' && (/\/scanner\/mobile/i.test(event.barcode) || /[?&](sessionId|mode)=/i.test(event.barcode))) {
      const result: ScanResult = { event, status: 'invalid', message: 'Đây là QR kết nối phiên, không phải barcode sản phẩm.' }
      setScanResults((current) => [result, ...current].slice(0, 8))
      return
    }
    const lookup = await resolveCode(event.barcode)
    const matched = lookup?.product ?? null
    if (!matched) {
      const result: ScanResult = { event, status: lookup?.failed ? 'failed' : 'not_found', message: lookup?.failed ? 'Không thể tra cứu sản phẩm với backend.' : 'Không tìm thấy sản phẩm; mã được giữ lại để tra cứu.' }
      setScanResults((current) => [result, ...current].slice(0, 8))
      return
    }
    const result = addProduct(matched.id, event.barcode, event.scannedAt)
    const entry: ScanResult = { event, status: result === 'added' ? 'new' : 'duplicate', productId: matched.id, message: result === 'added' ? 'Đã thêm vào danh sách thao tác.' : 'Đã cộng thêm 1 vào dòng sản phẩm hiện có.' }
    setScanResults((current) => [entry, ...current].slice(0, 8))
  }, [addProduct, resolveCode])
  const lookupManually = (event: FormEvent) => {
    event.preventDefault()
    void resolveCode(value)
  }
  const scanWithCamera = (barcode: string, format: Exclude<ScanEvent['format'], 'QR_CODE'>) => {
    setCameraOpen(false)
    void handleScan({ eventId: globalThis.crypto?.randomUUID?.() ?? `camera-${Date.now()}`, sessionId: 'direct-camera-lookup', barcode, format, scannedAt: new Date().toISOString() })
  }
  const addLookupProduct = () => {
    if (!product) return
    const result = addProduct(product.id, term)
    const entry: ScanResult = { event: { eventId: `manual-${Date.now()}`, sessionId: 'desktop-manual', barcode: term, format: 'MANUAL' as const, scannedAt: new Date().toISOString() }, status: result === 'added' ? 'new' : 'duplicate', productId: product.id, message: result === 'added' ? 'Đã thêm vào danh sách thao tác.' : 'Đã cộng thêm 1 vào dòng sản phẩm hiện có.' }
    setScanResults((current) => [entry, ...current].slice(0, 8))
  }
  const totalQuantity = basket.reduce((sum, item) => sum + item.quantity, 0)
  return <div className="page-content">
    <PageHeader eyebrow="TRA CỨU HÀNG HÓA" title="Quét mã vạch" description="Quét bằng camera trên thiết bị này để tra cứu sản phẩm; hoặc ghép nối scanner điện thoại từ xa với máy tính." />
    <div className="barcode-layout">
      <div className="panel barcode-search-panel">
        <div className="barcode-scanner-icon"><ScanLine size={28} /></div>
        <h2>Tra cứu sản phẩm</h2>
        <p>Quét hoặc nhập mã barcode / SKU bên dưới</p>
        <form className="barcode-form" onSubmit={lookupManually}>
          <label className="sr-only" htmlFor="barcode-input">Mã barcode hoặc SKU</label>
          <input id="barcode-input" autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="Ví dụ: 8938501001001" />
          <button className="button button-primary" type="submit" disabled={!value.trim() || lookupState === 'loading'}><Search size={16} />{lookupState === 'loading' ? 'Đang tra cứu…' : 'Tra cứu'}</button>
        </form>
        <div className="barcode-hint">Máy quét USB/Bluetooth hoạt động như bàn phím. Barcode chỉ tra cứu sản phẩm đã có; không tự tạo sản phẩm.</div>
        <div className="barcode-scan-actions">
          <button type="button" className="button button-secondary" onClick={() => setCameraOpen(true)}><Camera size={16} />Quét bằng camera</button>
          {scannerMode === 'api' ? <RemoteScannerButton onScan={(event) => { void handleScan(event) }} className="button button-secondary scanner-context-button" /> : <span className="field-help">Ghép nối điện thoại cần backend API; quét trực tiếp bằng camera không cần kết nối.</span>}
        </div>
      </div>
      {term && (product ? <div className="panel barcode-result">
        <div className="result-heading"><StatusBadge tone="success">Đã tìm thấy</StatusBadge><span>{product.barcode}</span></div>
        <div className="barcode-product"><div className="product-avatar avatar-0">{product.name.charAt(0)}</div><div><h2>{product.name}</h2><span>{product.sku} · {product.category}</span></div></div>
        <div className="barcode-stats"><div><span>Tồn kho tổng</span><strong>{stock} {product.unit}</strong></div><div><span>Định mức tối thiểu</span><strong>{product.minStock} {product.unit}</strong></div><div><span>Giá nhập</span><strong>{money.format(product.cost)}</strong></div></div>
        <div className="barcode-warehouse-list">{data.warehouses.map((warehouse) => <div key={warehouse.id}><span>{warehouse.name}</span><strong>{data.inventory.find((item) => item.productId === product.id && item.warehouseId === warehouse.id)?.quantity ?? 0} {product.unit}</strong></div>)}</div>
        <button className="button button-primary" onClick={addLookupProduct}><Plus size={15} />Thêm vào danh sách thao tác</button>
      </div> : <div className="panel barcode-result barcode-not-found">
        <div className="result-heading"><StatusBadge tone={lookupState === 'error' ? 'danger' : lookupState === 'loading' ? 'neutral' : 'warning'}>{lookupState === 'error' ? 'Lỗi tra cứu' : lookupState === 'loading' ? 'Đang tra cứu' : 'Không tìm thấy'}</StatusBadge><span>{term}</span></div>
        <p>{lookupMessage || 'Không tìm thấy sản phẩm theo barcode hoặc SKU. Hãy kiểm tra mã; hệ thống không tự tạo sản phẩm.'}</p>
        {lookupState !== 'loading' && <Link className="button button-secondary" to={`/products?q=${encodeURIComponent(term)}`}>Mở danh mục sản phẩm<ArrowRight size={15} /></Link>}
      </div>)}
    </div>
    <div className="scanner-workspace-grid">
      <section className="panel scanner-basket-panel">
        <div className="scanner-workspace-heading"><div><h2>Danh sách đang thao tác</h2><p>{basket.length} sản phẩm · tổng {totalQuantity} đơn vị · chưa cập nhật tồn kho</p></div>{basket.length > 0 && <button className="scanner-clear-button" onClick={() => { if (window.confirm('Xóa toàn bộ danh sách đang thao tác?')) clear() }}>Xóa danh sách</button>}</div>
        {basket.length ? <><div className="scanner-basket-list">{basket.map((item) => { const productInfo = data.products.find((entry) => entry.id === item.productId); return <div className="scanner-basket-row" key={item.productId}><div className="product-avatar avatar-0">{productInfo?.name.charAt(0)}</div><div className="scanner-basket-name"><strong>{productInfo?.name ?? 'Sản phẩm không còn tồn tại'}</strong><small>{productInfo?.sku} · mã gần nhất {item.barcode}</small></div><div className="scanner-quantity-control"><button aria-label="Giảm số lượng" onClick={() => updateQuantity(item.productId, item.quantity - 1)}><Minus size={13} /></button><input type="number" min="1" value={item.quantity} aria-label={`Số lượng ${productInfo?.name}`} onChange={(event) => updateQuantity(item.productId, Number(event.target.value))} /><button aria-label="Tăng số lượng" onClick={() => updateQuantity(item.productId, item.quantity + 1)}><Plus size={13} /></button></div><button className="icon-button danger-icon" aria-label={`Xóa ${productInfo?.name}`} onClick={() => removeProduct(item.productId)}><Trash2 size={15} /></button></div>})}</div><div className="scanner-basket-footer"><span>Quét trùng sản phẩm sẽ cộng dồn số lượng vào cùng một dòng.</span><div><Link className="button button-secondary" to="/inbound"><ArrowDownLeft size={15} />Tạo phiếu nhập</Link><Link className="button button-primary" to="/outbound"><ArrowUpRight size={15} />Tạo phiếu xuất</Link></div></div></> : <div className="scanner-basket-empty"><ScanLine size={22} /><span>Tra cứu hoặc quét mã sản phẩm đã có để thêm vào danh sách thao tác.</span></div>}
      </section>
      <section className="panel scanner-events-panel"><div className="scanner-workspace-heading"><div><h2>Mã vừa nhận</h2><p>Sự kiện gần nhất trên trang này</p></div><Clock3 size={16} /></div>{scanResults.length ? <div className="scanner-event-list">{scanResults.map((result) => <article className="scanner-event-row" key={result.event.eventId}><span className={`scanner-event-mark ${result.status}`} /><div><strong>{result.event.barcode}</strong><small>{new Date(result.event.scannedAt).toLocaleTimeString('vi-VN')} · {result.event.format}</small><span>{result.message}</span></div><StatusBadge tone={result.status === 'new' ? 'success' : result.status === 'duplicate' ? 'warning' : 'danger'}>{result.status === 'new' ? 'Mới' : result.status === 'duplicate' ? 'Cộng dồn' : result.status === 'failed' ? 'Lỗi backend' : result.status === 'invalid' ? 'Mã không hợp lệ' : 'Không tìm thấy'}</StatusBadge></article>)}</div> : <div className="scanner-basket-empty"><Clock3 size={20} /><span>Chưa nhận mã nào. Dùng camera trực tiếp hoặc scanner từ xa qua QR.</span></div>}</section>
    </div>
    {cameraOpen && <BarcodeScannerDialog onClose={() => setCameraOpen(false)} onDetected={scanWithCamera} />}
  </div>
}
export function SettingsPage() {
  const { data, resetData } = useWarehouse()
  const [threshold, setThreshold] = useState(() => localStorage.getItem('warehouse-alert-threshold') ?? '1')
  const [saved, setSaved] = useState(false)
  return <div className="page-content"><PageHeader eyebrow="TÙY CHỈNH KHÔNG GIAN LÀM VIỆC" title="Cài đặt" description="Thiết lập tùy chọn giao diện và dữ liệu cho phiên làm việc hiện tại." /><div className="settings-grid"><section className="panel settings-panel"><div className="settings-section-heading"><div className="settings-icon"><Settings size={18} /></div><div><h2>Tùy chọn kho</h2><p>Các thiết lập được lưu cục bộ trong trình duyệt.</p></div></div><label className="settings-field"><span><strong>Hệ số cảnh báo tồn kho</strong><small>Ngưỡng cảnh báo theo bội số mức tồn tối thiểu.</small></span><select value={threshold} onChange={(event) => { setThreshold(event.target.value); setSaved(false) }}><option value="1">Bằng định mức tối thiểu</option><option value="1.5">1,5 lần định mức</option><option value="2">Gấp đôi định mức</option></select></label><button className="button button-primary" onClick={() => { localStorage.setItem('warehouse-alert-threshold', threshold); setSaved(true); notify('Đã lưu tùy chọn trong trình duyệt.') }}>{saved ? 'Đã lưu thiết lập' : 'Lưu thiết lập'}</button></section><section className="panel settings-panel"><div className="settings-section-heading"><div className="settings-icon amber"><RotateCcw size={18} /></div><div><h2>{warehouseApiEnabled ? 'Dữ liệu kho' : 'Dữ liệu demo'}</h2><p>{warehouseApiEnabled ? 'Dữ liệu nghiệp vụ được lưu trong PostgreSQL qua API.' : 'Khôi phục bộ dữ liệu mẫu ban đầu trên thiết bị này.'}</p></div></div><div className="settings-data-stat"><span>Sản phẩm</span><strong>{data.products.length}</strong></div><div className="settings-data-stat"><span>Giao dịch</span><strong>{data.transactions.length}</strong></div><div className="settings-data-stat"><span>Lưu trữ</span><strong>{warehouseApiEnabled ? 'PostgreSQL qua API' : 'Trình duyệt hiện tại'}</strong></div><button className="button button-secondary" disabled={warehouseApiEnabled} onClick={() => { if (window.confirm('Khôi phục dữ liệu demo? Các thay đổi hiện tại trên trình duyệt sẽ bị thay thế.')) { if (resetData()) notify('Đã khôi phục dữ liệu demo.'); else notify('Không thể khôi phục dữ liệu demo khi đang kết nối backend.', 'error') } }}><RotateCcw size={16} />{warehouseApiEnabled ? 'Ỉ dùng trong chế độ demo' : 'Khôi phục demo'}</button></section></div><div className="settings-disclaimer"><ShieldCheck size={17} /><span>Dữ liệu được lưu bằng localStorage của trình duyệt. Đây là bản frontend demo, chưa kết nối PostgreSQL, API hay xác thực bảo mật.</span></div></div>
}

export function AuditLogsPage() {
  const { data } = useWarehouse()
  const logs = [...data.auditLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return <div className="page-content"><PageHeader eyebrow="THEO DÕI THAY ĐỔI" title="Nhật ký hoạt động" description={`Lịch sử thao tác được ghi nhận ${warehouseApiEnabled ? 'trong cơ sở dữ liệu qua API' : 'trong dữ liệu cục bộ'}.`} /><div className="panel list-panel"><div className="panel-heading padded"><div><h2>{logs.length} hoạt động</h2><p>Nhật ký chỉ đọc trên giao diện.</p></div></div><div className="audit-list">{logs.map((item) => <div className="audit-row" key={item.id}><div className="audit-marker" /><div className="audit-message"><strong>{item.message}</strong><span>{item.actor}</span></div><time>{new Date(item.createdAt).toLocaleString('vi-VN')}</time></div>)}{logs.length === 0 && <div className="empty-state">Chưa ghi nhận hoạt động.</div>}</div></div></div>
}
