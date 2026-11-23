import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle, Camera, RefreshCw, Send, ScanLine,
  Download, Archive, Info, WifiOff,
} from 'lucide-react'
import { BarcodeScannerDialog } from '../../components/BarcodeScannerDialog'
import { Modal } from '../../components/common'
import { useWarehouse, warehouseApiEnabled } from '../../data/WarehouseContext'
import { useAuth } from '../auth/AuthContext'
import { RemoteScannerButton } from './RemoteScannerButton'
import type { ScanEvent, ScanFormat } from './types'
import {
  createGateTransaction,
  getGateQueueStorageStatus,
  listGateTransactions,
  persistGateTransaction,
  retryGateTransaction,
  startGateTransactionSync,
  subscribeGateTransactions,
  syncGateTransactions,
  type GateTransaction,
  type ScanPoint,
} from './gateTransactions'
import { isManualDoubleClick, persistBeforeSync } from './gateTransactionCore'
import {
  computeCapacityTable,
  downloadQueueBackup,
  loadDeadLetterItems,
  CAPACITY_WARNING_RATIO,
  type CapacityTable,
  type EdgeScanPacket,
} from './offlineQueueLocalStorage'

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

function formatTimestamp(iso: string | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('vi-VN', { hour12: false })
  } catch {
    return iso
  }
}

export function GateScannerDialog({ type, onClose }: { type: 'Nhập kho' | 'Xuất kho'; onClose: () => void }) {
  const { user } = useAuth()
  const { data } = useWarehouse()
  const scanPoint: ScanPoint = type === 'Nhập kho' ? 'GATE_A' : 'GATE_B'
  const [warehouseId, setWarehouseId] = useState(data.warehouses[0]?.id ?? '')
  const [supplierId, setSupplierId] = useState(data.suppliers.find((s) => s.active)?.id ?? '')
  const [partner, setPartner] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [manualCode, setManualCode] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [error, setError] = useState('')
  const [lastScan, setLastScan] = useState('')
  const [transactions, setTransactions] = useState<GateTransaction[]>([])
  const [enqueueBusy, setEnqueueBusy] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const manualGuardRef = useRef(0)
  const inFlightEventsRef = useRef(new Set<string>())

  // ── Dung lượng và Dead-Letter ──────────────────────────────────────────────
  const [storageStatus, setStorageStatus] = useState<{ usage: number; quota: number } | null>(null)
  const [localCapacity, setLocalCapacity] = useState<CapacityTable | null>(null)
  const [deadLetterItems, setDeadLetterItems] = useState<EdgeScanPacket[]>([])
  const [showCapacityPanel, setShowCapacityPanel] = useState(false)
  const [showDeadLetter, setShowDeadLetter] = useState(false)

  const isInbound = type === 'Nhập kho'
  const activeSuppliers = useMemo(() => data.suppliers.filter((s) => s.active), [data.suppliers])

  // ── Cập nhật trạng thái online/offline ────────────────────────────────────
  useEffect(() => {
    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // ── Cập nhật dead-letter từ LocalStorage ──────────────────────────────────
  const refreshLocalCapacity = useCallback(() => {
    if (!user) return
    try {
      const capacity = computeCapacityTable(user.id)
      setLocalCapacity(capacity)
      const dead = loadDeadLetterItems(user.id)
      setDeadLetterItems(dead)
    } catch {
      // LocalStorage không khả dụng (private mode, etc.)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    let active = true
    const refresh = () => {
      void listGateTransactions(user.id).then((items) => { if (active) setTransactions(items) }).catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Không đọc được hàng đợi scanner.')
      })
      void getGateQueueStorageStatus().then((status) => { if (active) setStorageStatus(status) })
      if (active) refreshLocalCapacity()
    }
    refresh()
    const unsubscribe = subscribeGateTransactions(user.id, refresh)
    const stopSync    = startGateTransactionSync(user.id)
    return () => { active = false; unsubscribe(); stopSync() }
  }, [user, refreshLocalCapacity])

  // ── Xử lý quét ─────────────────────────────────────────────────────────────
  const handleScan = useCallback(async (
    barcodeValue: string,
    format: ScanFormat,
    scanEventId: string = newEventId(),
    scannedAt = new Date().toISOString(),
  ) => {
    if (!warehouseApiEnabled) {
      setError('Scanner giao dịch yêu cầu API mode và tài khoản đã xác thực; dữ liệu demo không được gửi.')
      return
    }
    if (inFlightEventsRef.current.has(scanEventId)) return
    inFlightEventsRef.current.add(scanEventId)
    if (!user) { setError('Không tìm thấy người dùng đã xác thực.'); inFlightEventsRef.current.delete(scanEventId); return }
    const barcode = barcodeValue.trim()
    if (!barcode) { setError('Barcode không được để trống.'); inFlightEventsRef.current.delete(scanEventId); return }
    if (format === 'EAN_13' && !validEan13(barcode)) { setError('EAN-13 không hợp lệ hoặc sai check digit.'); inFlightEventsRef.current.delete(scanEventId); return }
    if (!warehouseId) { setError('Hãy chọn kho trước khi quét.'); inFlightEventsRef.current.delete(scanEventId); return }
    if (isInbound && !activeSuppliers.some((s) => s.id === supplierId)) { setError('Hãy chọn nhà cung cấp đang hoạt động.'); inFlightEventsRef.current.delete(scanEventId); return }
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
        clientTimestamp: scannedAt,  // ← client_timestamp: giờ quét tại kho
        warehouseId,
        ...(isInbound ? { supplierId } : {}),
        partner: isInbound ? activeSuppliers.find((s) => s.id === supplierId)?.name ?? '' : partner.trim(),
        userId: user.id,
      })
      setError('')
      const persisted = await persistBeforeSync(
        transaction,
        (record) => persistGateTransaction(record),
        async () => {
          void syncGateTransactions(user.id).catch((syncError) =>
            setError(syncError instanceof Error ? syncError.message : 'Đã lưu cục bộ; chưa thể đồng bộ.'),
          )
        },
      )
      if (!persisted.inserted) {
        setLastScan(`Sự kiện ${barcode} đã được nhận trước đó; không tạo transaction thứ hai.`)
        setError('')
        return
      }
      setLastScan(`${product.name} · ${barcode} · ${quantity} ${product.unit}`)
      refreshLocalCapacity()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không thể lưu giao dịch scanner.')
    } finally {
      inFlightEventsRef.current.delete(scanEventId)
      setEnqueueBusy(false)
    }
  }, [activeSuppliers, data.products, isInbound, partner, quantity, refreshLocalCapacity, scanPoint, supplierId, type, user, warehouseId])

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

  const queueForGate = transactions.filter((item) => item.scanPoint === scanPoint)
  const pendingCount = queueForGate.filter((t) => t.status === 'PENDING' || t.status === 'RETRY_WAIT').length
  const deadCount    = queueForGate.filter((t) => t.status === 'DEAD_LETTER').length

  // ── Cảnh báo dung lượng 80% ───────────────────────────────────────────────
  const storageWarning = storageStatus?.quota
    ? storageStatus.usage / storageStatus.quota >= CAPACITY_WARNING_RATIO
    : false
  const localWarning = localCapacity?.warningActive ?? false

  return (
    <Modal
      title={`Scanner ${scanPoint} · ${isInbound ? 'Nhập kho' : 'Xuất kho'}`}
      subtitle="Mỗi lần quét tạo một phiếu nháp riêng; tồn chỉ đổi sau khi xác nhận phiếu."
      onClose={onClose}
      wide
    >
      <div className="gate-scanner-dialog">
        {/* ── Trạng thái mạng ── */}
        {!isOnline && (
          <div className="product-scanner-error" role="status">
            <WifiOff size={15} />
            <strong>Mất kết nối mạng</strong> – Các lượt quét đang được lưu cục bộ và sẽ tự đồng bộ khi có mạng.
          </div>
        )}

        {/* ── Cảnh báo dung lượng 80% ── */}
        {(storageWarning || localWarning) && (
          <div className="product-scanner-error" role="alert">
            <AlertTriangle size={15} />
            <span>
              <strong>Cảnh báo dung lượng!</strong>{' '}
              {storageStatus?.quota
                ? `Trình duyệt đã dùng ${Math.round(storageStatus.usage / storageStatus.quota * 100)}% quota.`
                : ''}{' '}
              Hãy đồng bộ giao dịch trước khi quét thêm.
            </span>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => { if (user) downloadQueueBackup(user.id, 'json') }}
            >
              <Download size={14} /> Xuất khẩn cấp (.json)
            </button>
          </div>
        )}

        {/* ── Form cấu hình gate ── */}
        <div className="form-grid">
          <label className="form-field">
            <span>Điểm quét</span>
            <input readOnly value={`${scanPoint} · ${isInbound ? 'IN' : 'OUT'}`} />
          </label>
          <label className="form-field">
            <span>Kho <b>*</b></span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Chọn kho</option>
              {data.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </label>
          {isInbound
            ? (
              <label className="form-field">
                <span>Nhà cung cấp <b>*</b></span>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Chọn nhà cung cấp</option>
                  {activeSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )
            : (
              <label className="form-field">
                <span>Người nhận / mã đơn <b>*</b></span>
                <input value={partner} onChange={(e) => setPartner(e.target.value)} maxLength={300} />
              </label>
            )}
          <label className="form-field">
            <span>Số lượng mỗi lần quét</span>
            <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </label>
        </div>

        {/* ── Hành động quét ── */}
        <div className="scanner-actions-group">
          <button type="button" className="button button-primary" disabled={!warehouseApiEnabled} onClick={() => setCameraOpen(true)}>
            <Camera size={16} />Mở camera (KT1)
          </button>
          <RemoteScannerButton
            className="button button-secondary"
            disabled={!warehouseApiEnabled}
            label="Kết nối điện thoại (QR)"
            onScan={(event: ScanEvent) => handleScan(event.barcode, event.format, event.eventId, event.scannedAt)}
          />
        </div>

        {/* ── Nhập thủ công ── */}
        <form className="product-scanner-manual" onSubmit={submitManual}>
          <label className="form-field">
            <span>Nhập EAN-13 thủ công</span>
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              maxLength={13}
              pattern="[\\d]{13}"
              placeholder="0000000000000"
              disabled={!warehouseApiEnabled}
            />
          </label>
          <button
            type="submit"
            className="button button-secondary"
            disabled={!warehouseApiEnabled || enqueueBusy || !manualCode.trim()}
          >
            <Send size={15} />Tạo giao dịch
          </button>
        </form>

        {/* ── Thông báo ── */}
        {!warehouseApiEnabled && (
          <div className="product-scanner-error" role="alert">
            Giao dịch scanner yêu cầu API mode và đăng nhập thật; chế độ demo không tạo giao dịch kho.
          </div>
        )}
        {error && <div className="product-scanner-error" role="alert"><AlertTriangle size={15} />{error}</div>}
        {lastScan && (
          <div className="scanner-last-result success" role="status">
            <ScanLine size={16} />
            <span>
              <strong>{isOnline ? 'Đã xếp hàng + gửi' : 'Đã lưu offline'}</strong> · {lastScan}
              <span style={{ fontSize: '0.78em', opacity: 0.7, display: 'block' }}>
                {/* serverTimestamp (response SV3) là giá trị của server_timestamp – chuẩn pháp lý */}
                client_timestamp: {formatTimestamp(new Date().toISOString())} (giờ kho)
                {' · '}server_timestamp ghi sau khi SV3 nhận (xem tab Giao dịch)
              </span>
            </span>
          </div>
        )}

        {/* ── Hàng đợi giao dịch ── */}
        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>
              Giao dịch scanner · {scanPoint}
              {pendingCount > 0 && <span style={{ color: '#f59e0b', marginLeft: 6 }}>· {pendingCount} chờ gửi</span>}
              {deadCount > 0 && <span style={{ color: '#ef4444', marginLeft: 6 }}>· {deadCount} lỗi</span>}
            </h3>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setShowCapacityPanel((v) => !v)}
                title="Bảng dung lượng LocalStorage"
              >
                <Info size={14} /> Dung lượng
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setShowDeadLetter((v) => !v)}
                title="Nhật ký lỗi Dead-Letter"
              >
                <Archive size={14} /> Dead-Letter {deadLetterItems.length > 0 && `(${deadLetterItems.length})`}
              </button>
              {user && (
                <>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => downloadQueueBackup(user.id, 'json')}
                    title="Xuất hàng đợi ra file JSON"
                  >
                    <Download size={14} /> .json
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => downloadQueueBackup(user.id, 'csv')}
                    title="Xuất hàng đợi ra file CSV"
                  >
                    <Download size={14} /> .csv
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── Bảng dung lượng ── */}
          {showCapacityPanel && localCapacity && (
            <div className="scanner-session-metrics" style={{ background: '#f8fafc', borderRadius: 8, padding: 12, margin: '8px 0', fontSize: '0.85em' }}>
              <strong>Bảng dung lượng LocalStorage (CV02)</strong>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                <tbody>
                  <tr><td>Quota ước tính</td><td>{(localCapacity.quotaBytes / 1024 / 1024).toFixed(1)} MB (~5 MB/origin, UTF-16)</td></tr>
                  <tr><td>Bytes/bản ghi (thực đo)</td><td>{localCapacity.bytesPerRecord} bytes UTF-16</td></tr>
                  <tr><td>Lượt quét tối đa offline</td><td><strong>{localCapacity.maxRecordsEstimate.toLocaleString('vi-VN')}</strong> lượt</td></tr>
                  <tr><td>Ngưỡng cảnh báo 80%</td><td>{localCapacity.warningThreshold.toLocaleString('vi-VN')} lượt</td></tr>
                  <tr><td>Hiện tại trong hàng đợi</td><td>{localCapacity.currentCount} bản ghi</td></tr>
                  <tr><td>Đã dùng</td><td>{(localCapacity.usedBytes / 1024).toFixed(1)} KB ({(localCapacity.fillRatio * 100).toFixed(1)}%)</td></tr>
                  <tr><td>Còn lại</td><td>{localCapacity.remainingSlots.toLocaleString('vi-VN')} lượt</td></tr>
                </tbody>
              </table>
              <p style={{ marginTop: 8, color: '#64748b', fontSize: '0.9em' }}>
                * Thực tế có thể ít hơn 50% do UTF-16 (mỗi ký tự = 2 bytes) và overhead key localStorage.
                IndexedDB là hướng nâng cấp cho hàng đợi lớn hơn (xem P04/P05).
              </p>
            </div>
          )}

          {/* ── Dead-Letter panel ── */}
          {showDeadLetter && (
            <div style={{ margin: '8px 0' }}>
              <h4 style={{ color: '#ef4444', margin: '0 0 6px' }}>
                ⚠ Nhật ký lỗi (Dead-Letter) – Cần kiểm tra thủ công
              </h4>
              {deadLetterItems.length === 0
                ? <p style={{ color: '#64748b', fontSize: '0.85em' }}>Không có giao dịch lỗi terminal.</p>
                : deadLetterItems.slice().reverse().map((item) => (
                  <div key={item.idempotency_key} className="scanner-session-metrics" style={{ borderLeft: '3px solid #ef4444', paddingLeft: 8 }}>
                    <span>
                      <strong>{item.barcode}</strong> · {item.quantity} · {item.type}<br />
                      <small>Key: {item.idempotency_key.slice(0, 8)}…</small>
                    </span>
                    <span>
                      <strong style={{ color: '#ef4444' }}>Lỗi: {item.last_error}</strong><br />
                      <small>client_timestamp: {formatTimestamp(item.client_timestamp)}</small><br />
                      <small>Enqueue: {item.queued_at ? formatTimestamp(new Date(item.queued_at).toISOString()) : '—'}</small>
                    </span>
                  </div>
                ))}
            </div>
          )}

          {/* ── Danh sách giao dịch ── */}
          {queueForGate.slice().reverse().map((item) => (
            <div className="scanner-session-metrics" key={item.idempotencyKey}>
              <span>
                {item.barcode} · {item.quantity} · {item.idempotencyKey.slice(0, 8)}
                <br />
                <small>
                  client: {formatTimestamp(item.clientTimestamp)}
                  {item.serverTimestamp && <> · server: {formatTimestamp(item.serverTimestamp)}</>}
                </small>
              </span>
              <strong>
                {statusLabel[item.status]}
                {item.error ? ` · ${item.error}` : ''}
              </strong>
              {(item.status === 'RETRY_WAIT' || item.status === 'DEAD_LETTER') && (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => { if (user) void retryGateTransaction(user.id, item.idempotencyKey) }}
                >
                  <RefreshCw size={14} />Thử gửi lại
                </button>
              )}
            </div>
          ))}
        </section>

        {cameraOpen && (
          <BarcodeScannerDialog
            continuous
            onClose={() => setCameraOpen(false)}
            onDetected={(barcode, format) => { void handleScan(barcode, format) }}
          />
        )}
      </div>
    </Modal>
  )
}
