import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Camera, RefreshCw, Send, ScanLine } from 'lucide-react'
import { BarcodeScannerDialog } from '../../components/BarcodeScannerDialog'
import { Modal } from '../../components/common'
import { useWarehouse, warehouseApiEnabled } from '../../data/WarehouseContext'
import { useAuth } from '../auth/AuthContext'
import { RemoteScannerButton } from './RemoteScannerButton'
import type { ScanEvent, ScanFormat } from './types'
import { createGateTransaction, getGateQueueStorageStatus, listGateTransactions, persistGateTransaction, retryGateTransaction, startGateTransactionSync, subscribeGateTransactions, syncGateTransactions, type GateTransaction, type ScanPoint } from './gateTransactions'
import { isManualDoubleClick, persistBeforeSync } from './gateTransactionCore'

function validEan13(value: string) {
  if (!/^\d{13}$/.test(value)) return false
  const sum = value.slice(0, 12).split('').reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0)
  return (10 - sum % 10) % 10 === Number(value[12])
}

function newEventId() {
  const eventId = globalThis.crypto?.randomUUID?.()
  if (!eventId) throw new Error('Thiết bị không hỗ trợ UUID v4; chưa tạo giao dịch.')
  return eventId
}

export function GateScannerDialog({ type, onClose }: { type: 'Nhập kho' | 'Xuất kho'; onClose: () => void }) {
  const { user } = useAuth()
  const { data } = useWarehouse()
  const scanPoint: ScanPoint = type === 'Nhập kho' ? 'GATE_A' : 'GATE_B'
  const [warehouseId, setWarehouseId] = useState(data.warehouses[0]?.id ?? '')
  const [supplierId, setSupplierId] = useState(data.suppliers.find((supplier) => supplier.active)?.id ?? '')
  const [partner, setPartner] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [manualCode, setManualCode] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [error, setError] = useState('')
  const [lastScan, setLastScan] = useState('')
  const [transactions, setTransactions] = useState<GateTransaction[]>([])
  const [enqueueBusy, setEnqueueBusy] = useState(false)
  const manualGuardRef = useRef(0)
  const inFlightEventsRef = useRef(new Set<string>())
  const [storageStatus, setStorageStatus] = useState<{ usage: number; quota: number } | null>(null)
  const isInbound = type === 'Nhập kho'
  const activeSuppliers = useMemo(() => data.suppliers.filter((supplier) => supplier.active), [data.suppliers])

  useEffect(() => {
    if (!user) return
    let active = true
    const refresh = () => {
      void listGateTransactions(user.id).then((items) => { if (active) setTransactions(items) }).catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Không đọc được hàng đợi scanner.')
      })
      void getGateQueueStorageStatus().then((status) => { if (active) setStorageStatus(status) })
    }
    refresh()
    const unsubscribe = subscribeGateTransactions(user.id, refresh)
    const stopSync = startGateTransactionSync(user.id)
    return () => { active = false; unsubscribe(); stopSync() }
  }, [user])

  const handleScan = useCallback(async (barcodeValue: string, format: ScanFormat, scanEventId: string = newEventId(), scannedAt = new Date().toISOString()) => {
    if (!warehouseApiEnabled) { setError('Scanner giao dịch yêu cầu API mode và tài khoản đã xác thực; dữ liệu demo không được gửi.'); return }
    if (inFlightEventsRef.current.has(scanEventId)) return
    inFlightEventsRef.current.add(scanEventId)
    if (!user) { setError('Không tìm thấy người dùng đã xác thực.'); inFlightEventsRef.current.delete(scanEventId); return }
    const barcode = barcodeValue.trim()
    if (!barcode) { setError('Barcode không được để trống.'); inFlightEventsRef.current.delete(scanEventId); return }
    if (format === 'EAN_13' && !validEan13(barcode)) { setError('EAN-13 không hợp lệ hoặc sai check digit.'); inFlightEventsRef.current.delete(scanEventId); return }
    if (!warehouseId) { setError('Hãy chọn kho trước khi quét.'); inFlightEventsRef.current.delete(scanEventId); return }
    if (isInbound && !activeSuppliers.some((supplier) => supplier.id === supplierId)) { setError('Hãy chọn nhà cung cấp đang hoạt động.'); inFlightEventsRef.current.delete(scanEventId); return }
    if (!isInbound && !partner.trim()) { setError('Hãy nhập người nhận hoặc mã đơn hàng.'); inFlightEventsRef.current.delete(scanEventId); return }
    if (!Number.isInteger(quantity) || quantity < 1) { setError('Số lượng phải là số nguyên lớn hơn 0.'); inFlightEventsRef.current.delete(scanEventId); return }
    const product = data.products.find((item) => item.barcode.trim() === barcode)
    if (!product) { setLastScan(`Không tìm thấy sản phẩm có barcode ${barcode}.`); setError('Không tìm thấy sản phẩm; giao dịch chưa được tạo.'); inFlightEventsRef.current.delete(scanEventId); return }
    if (product.status !== 'Đang kinh doanh') { setError(`Sản phẩm ${product.name} đang ngừng kinh doanh.`); inFlightEventsRef.current.delete(scanEventId); return }
    setEnqueueBusy(true)
    try {
      const transaction = createGateTransaction({
        scanEventId,
        barcode,
        quantity,
        type,
        scanPoint,
        clientTimestamp: scannedAt,
        warehouseId,
        ...(isInbound ? { supplierId } : {}),
        partner: isInbound ? activeSuppliers.find((supplier) => supplier.id === supplierId)?.name ?? '' : partner.trim(),
        userId: user.id,
      })
      setError('')
      let persisted = { inserted: false }
      await persistBeforeSync(
        transaction,
        async (record) => { persisted = await persistGateTransaction(record) },
        async () => {
          void syncGateTransactions(user.id).catch((syncError) => setError(syncError instanceof Error ? syncError.message : 'Đã lưu cục bộ; chưa thể đồng bộ.'))
        },
      )
      if (!persisted.inserted) {
        setLastScan(`Sự kiện ${barcode} đã được nhận trước đó; không tạo transaction thứ hai.`)
        setError('')
        return
      }
      setLastScan(`${product.name} · ${barcode} · ${quantity} ${product.unit}`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không thể lưu giao dịch scanner.')
    } finally {
      inFlightEventsRef.current.delete(scanEventId)
      setEnqueueBusy(false)
    }
  }, [activeSuppliers, data.products, isInbound, partner, quantity, scanPoint, supplierId, type, user, warehouseId])

  const submitManual = (event: FormEvent) => {
    event.preventDefault()
    if (enqueueBusy || isManualDoubleClick(manualGuardRef.current, Date.now())) return
    manualGuardRef.current = Date.now()
    void handleScan(manualCode, 'MANUAL')
    setManualCode('')
  }

  const statusLabel: Record<GateTransaction['status'], string> = {
    PENDING: 'Chờ gửi', SYNCING: 'Đang gửi', RETRY_WAIT: 'Chờ thử lại', SYNCED: 'Đã tạo phiếu nháp',
    PAUSED_AUTH: 'Cần đăng nhập lại', AUTH_REQUIRED: 'Cần đăng nhập lại', DEAD_LETTER: 'Không thể gửi',
  }

  return <Modal title={`Scanner ${scanPoint} · ${isInbound ? 'Nhập kho' : 'Xuất kho'}`} subtitle="Mỗi lần quét tạo một phiếu nháp riêng; tồn chỉ đổi sau khi xác nhận phiếu." onClose={onClose} wide>
    <div className="gate-scanner-dialog">
      <div className="form-grid">
        <label className="form-field"><span>Điểm quét</span><input readOnly value={`${scanPoint} · ${isInbound ? 'IN' : 'OUT'}`} /></label>
        <label className="form-field"><span>Kho <b>*</b></span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Chọn kho</option>{data.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
        {isInbound
          ? <label className="form-field"><span>Nhà cung cấp <b>*</b></span><select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Chọn nhà cung cấp</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          : <label className="form-field"><span>Người nhận / mã đơn <b>*</b></span><input value={partner} onChange={(event) => setPartner(event.target.value)} maxLength={300} /></label>}
        <label className="form-field"><span>Số lượng mỗi lần quét</span><input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
      </div>
      <div className="scanner-actions-group">
        <button type="button" className="button button-primary" disabled={!warehouseApiEnabled} onClick={() => setCameraOpen(true)}><Camera size={16} />Mở camera</button>
        <RemoteScannerButton className="button button-secondary" disabled={!warehouseApiEnabled} label="Kết nối điện thoại (QR)" onScan={(event: ScanEvent) => handleScan(event.barcode, event.format, event.eventId, event.scannedAt)} />
      </div>
      <form className="product-scanner-manual" onSubmit={submitManual}><label className="form-field"><span>Nhập barcode thủ công</span><input value={manualCode} onChange={(event) => setManualCode(event.target.value)} maxLength={300} disabled={!warehouseApiEnabled} /></label><button type="submit" className="button button-secondary" disabled={!warehouseApiEnabled || enqueueBusy || !manualCode.trim()}><Send size={15} />Tạo giao dịch</button></form>
      {!warehouseApiEnabled && <div className="product-scanner-error" role="alert">Giao dịch scanner yêu cầu API mode và đăng nhập thật; chế độ demo không tạo giao dịch kho.</div>}
      {storageStatus?.quota && storageStatus.usage / storageStatus.quota >= 0.8 && <div className="product-scanner-error" role="status">Dung lượng trình duyệt gần đầy ({Math.round(storageStatus.usage / storageStatus.quota * 100)}%); hãy đồng bộ giao dịch trước khi quét tiếp.</div>}
      {error && <div className="product-scanner-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      {lastScan && <div className="scanner-last-result success" role="status"><ScanLine size={16} /><span>{lastScan}</span></div>}
      <section className="panel"><h3>Giao dịch scanner ({transactions.length})</h3>{transactions.filter((item) => item.scanPoint === scanPoint).slice().reverse().map((item) => <div className="scanner-session-metrics" key={item.idempotencyKey}><span>{item.barcode} · {item.quantity} · {item.idempotencyKey.slice(0, 8)}</span><strong>{statusLabel[item.status]}{item.error ? ` · ${item.error}` : ''}</strong>{(item.status === 'RETRY_WAIT' || item.status === 'DEAD_LETTER') && <button className="button button-secondary" type="button" onClick={() => { if (user) void retryGateTransaction(user.id, item.idempotencyKey) }}><RefreshCw size={14} />Thử gửi lại</button>}</div>)}</section>
      {cameraOpen && <BarcodeScannerDialog continuous onClose={() => setCameraOpen(false)} onDetected={(barcode, format) => { void handleScan(barcode, format) }} />}
    </div>
  </Modal>
}
