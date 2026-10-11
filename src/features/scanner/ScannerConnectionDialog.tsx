import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Link2, QrCode, RefreshCw, Smartphone, Unplug, Wifi, WifiOff } from 'lucide-react'
import { Modal, StatusBadge } from '../../components/common'
import { notify } from '../../lib/feedback'
import { scanEventService, scannerMode, scannerSessionService } from './scannerService'
import type { ConnectionStatus, ScanEvent, ScannerSession, ScannerQrTicket, ScannerSessionStatus } from './types'

const statusLabels: Record<ConnectionStatus, string> = {
  not_created: 'Chưa tạo phiên',
  creating: 'Đang tạo phiên',
  waiting_for_device: 'Đang chờ điện thoại',
  connected: 'Điện thoại đã kết nối',
  receiving: 'Đang nhận mã',
  disconnected: 'Mất kết nối',
  expired: 'Phiên đã hết hạn',
  ended: 'Đã kết thúc phiên',
  error: 'Có lỗi',
  unverified_demo: 'Chưa xác minh · DEMO',
}

export function ScannerConnectionDialog({ onClose, onScan }: { onClose: () => void; onScan: (event: ScanEvent) => void }) {
  const [status, setStatus] = useState<ConnectionStatus>('not_created')
  const [session, setSession] = useState<ScannerSession | null>(null)
  const [qrImage, setQrImage] = useState('')
  const [qrTicket, setQrTicket] = useState<ScannerQrTicket | null>(null)
  const [qrRefreshKey, setQrRefreshKey] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const [baseUrl] = useState(() => import.meta.env.VITE_SCANNER_MOBILE_BASE_URL?.trim() || window.location.origin)
  const [copied, setCopied] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const receiveTimer = useRef<number | undefined>(undefined)
  const onScanRef = useRef(onScan)
  const transportConnectedRef = useRef(false)
  const automaticSessionStartedRef = useRef(false)
  onScanRef.current = onScan
  let baseUrlError = ''
  try {
    const parsedBaseUrl = new URL(baseUrl)
    if (parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash || parsedBaseUrl.pathname !== '/') baseUrlError = 'Địa chỉ frontend cấu hình phải là origin thuần, không kèm thông tin đăng nhập, path, query hoặc fragment.'
    else if (parsedBaseUrl.protocol !== 'https:') baseUrlError = 'Điện thoại cần mở ứng dụng qua HTTPS để camera hoạt động.'
    else if (['localhost', '127.0.0.1'].includes(parsedBaseUrl.hostname)) baseUrlError = 'Máy tính đang mở ứng dụng bằng localhost; điện thoại không thể truy cập địa chỉ này. Hãy mở frontend bằng hostname/IP LAN có HTTPS hợp lệ rồi tạo lại QR.'
  } catch {
    baseUrlError = 'Không xác định được origin frontend hợp lệ để tạo QR.'
  }
  const qrSecondsLeft = qrTicket ? Math.max(0, Math.ceil((new Date(qrTicket.expiresAt).getTime() - clock) / 1000)) : 0

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!session) return
    const unsubscribe = scanEventService.subscribe(session.sessionId, (event) => {
      setStatus('receiving')
      onScanRef.current(event)
      window.clearTimeout(receiveTimer.current)
      receiveTimer.current = window.setTimeout(() => setStatus(transportConnectedRef.current ? 'connected' : 'disconnected'), 1400)
    }, (message) => setConnectionError(message), (nextStatus: ScannerSessionStatus) => {
      if (nextStatus === 'device_disconnected') {
        setStatus('disconnected')
        setConnectionError('Điện thoại mất kết nối WebSocket; đang chờ thiết bị kết nối lại.')
        return
      }
      setSession((current) => current ? { ...current, status: nextStatus } : current)
      setStatus(nextStatus)
      if (nextStatus === 'ended' || nextStatus === 'expired') {
        setQrTicket(null)
        setQrImage('')
      }
    }, (connected) => {
      transportConnectedRef.current = connected
      setConnectionError(connected ? '' : 'Mất kết nối WebSocket; hệ thống đang tự kết nối lại.')
      if (!connected) setStatus((current) => current === 'ended' || current === 'expired' ? current : 'disconnected')
    })
    return () => {
      unsubscribe()
      window.clearTimeout(receiveTimer.current)
    }
  }, [session?.sessionId])

  useEffect(() => {
    if (!session) return
    const sessionId = session.sessionId
    return () => { void scannerSessionService.closeSession(sessionId).catch(() => undefined) }
  }, [session?.sessionId])

  const createSession = useCallback(async () => {
    if (scannerMode !== 'api') {
      setStatus('error')
      setConnectionError('Scanner từ xa cần VITE_API_BASE_URL và backend API có thể truy cập từ cả hai thiết bị.')
      return
    }
    setStatus('creating')
    setQrTicket(null)
    setQrImage('')
    try {
      if (session && session.status !== 'ended' && session.status !== 'expired') await scannerSessionService.closeSession(session.sessionId)
      const next = await scannerSessionService.createSession()
      setSession(next)
      setStatus(next.status)
      setConnectionError('')
    } catch (error) {
      setStatus('error')
      setConnectionError(error instanceof Error ? error.message : 'Không thể tạo phiên scanner.')
      automaticSessionStartedRef.current = false
    }
  }, [session])

  useEffect(() => {
    if (scannerMode === 'api' && !session && !automaticSessionStartedRef.current) {
      automaticSessionStartedRef.current = true
      void createSession()
    }
  }, [createSession, session])

  useEffect(() => {
    if (session?.status === 'waiting_for_device') {
      setQrTicket(null)
      setQrImage('')
    }
    const active = session?.status === 'waiting_for_device' && !baseUrlError
    if (!active) return
    let disposed = false
    let refreshTimer: number | undefined
    const rotateQr = async () => {
      try {
        const ticket = await scannerSessionService.refreshQr(session.sessionId, baseUrl.trim())
        const image = await QRCode.toDataURL(ticket.mobileUrl, { width: 220, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1c2a40', light: '#ffffff' } })
        if (!disposed) {
          setQrTicket(ticket)
          setQrImage(image)
          refreshTimer = window.setTimeout(() => void rotateQr(), Math.max(1000, new Date(ticket.expiresAt).getTime() - Date.now() - 10000))
        }
      } catch (error) {
        if (!disposed) {
          setStatus('error')
          setConnectionError(error instanceof Error ? error.message : 'Không thể làm mới QR phiên.')
        }
      }
    }
    void rotateQr()
    return () => {
      disposed = true
      window.clearTimeout(refreshTimer)
    }
  }, [session?.sessionId, session?.status, baseUrl, baseUrlError, qrRefreshKey])

  const closeSession = async () => {
    if (!session) return
    try {
      const ended = await scannerSessionService.closeSession(session.sessionId)
      setSession(ended)
      setStatus('ended')
    } catch (error) {
      setStatus('error')
      notify(error instanceof Error ? error.message : 'Không thể kết thúc phiên.', 'error')
    }
  }

  const dismiss = () => {
    if (session && session.status !== 'ended' && session.status !== 'expired') {
      void scannerSessionService.closeSession(session.sessionId).catch(() => undefined)
    }
    onClose()
  }

  const copyLink = async () => {
    if (!qrTicket || qrSecondsLeft === 0) return
    try {
      await navigator.clipboard.writeText(qrTicket.mobileUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1700)
    } catch {
      notify('Không thể sao chép liên kết trong trình duyệt này.', 'error')
    }
  }

  const tone = status === 'waiting_for_device' || status === 'receiving' ? 'warning' : status === 'connected' ? 'success' : status === 'error' || status === 'expired' || status === 'disconnected' ? 'danger' : 'neutral'
  return <Modal title="Kết nối điện thoại làm scanner" subtitle="Quét QR bằng điện thoại; barcode sẽ được chuyển an toàn về màn hình đang thao tác trên máy tính." onClose={dismiss} wide>
    <div className="scanner-demo-banner"><span>{scannerMode === 'api' ? 'API' : 'CHƯA CẤU HÌNH'}</span><p>{scannerMode === 'api' ? 'Backend xác thực QR dùng một lần và phiên thiết bị; mã quét được chuyển về máy tính, không tự thay đổi tồn kho.' : 'Scanner từ xa yêu cầu cấu hình backend API. Để quét trên thiết bị hiện tại, dùng nút camera trực tiếp ở trang Quét mã vạch.'}</p></div>
    <div className="scanner-session-status"><div className="scanner-session-status-icon">{status === 'connected' ? <Wifi size={18} /> : status === 'disconnected' ? <WifiOff size={18} /> : <Link2 size={18} />}</div><div><strong>{statusLabels[status]}</strong><small>{session ? `Phiên tạo lúc ${new Date(session.createdAt).toLocaleTimeString('vi-VN')} · hết hạn ${new Date(session.expiresAt).toLocaleTimeString('vi-VN')}` : 'Chưa có phiên quét nào được tạo.'}</small></div><StatusBadge tone={tone}>{session?.mode === 'demo' ? 'DEMO' : statusLabels[status]}</StatusBadge></div>
      {connectionError && <div className="product-scanner-error" role="alert">{connectionError}</div>}
      {session?.status === 'waiting_for_device' && <div className="scanner-url-field"><span>Địa chỉ kết nối điện thoại</span><small role={baseUrlError ? 'alert' : undefined}>{baseUrlError || `QR sử dụng origin hiện tại: ${baseUrl}. Điện thoại cần cùng mạng LAN và tin cậy chứng chỉ HTTPS.`}</small></div>}
      {session && qrImage && qrTicket && <div className="scanner-connect-content"><div className={`scanner-qr-card ${qrSecondsLeft === 0 ? 'qr-expired' : ''}`}><img src={qrImage} alt="QR ghép nối điện thoại, nonce dùng một lần và tự đổi trước khi hết hạn" /></div><div className="scanner-connect-instructions"><h3><Smartphone size={17} />Điện thoại làm máy quét</h3><ol><li>Quét QR đang hiển thị bằng camera điện thoại.</li><li>Nonce chỉ dùng một lần; TTL mặc định 60 giây và tự được thay mới trước khi hết hạn.</li><li>Trang scanner xác thực phiên rồi mới xin quyền camera.</li><li>Mã quét chuyển về form/phiếu hiện tại; không tự lưu hoặc xác nhận nghiệp vụ.</li></ol><div className="scanner-url-actions"><button type="button" className="button button-secondary" onClick={copyLink} disabled={qrSecondsLeft === 0}><Copy size={14} />{copied ? 'Đã sao chép' : 'Sao chép liên kết QR'}</button><button type="button" className="button button-secondary" onClick={() => setQrRefreshKey((current) => current + 1)}><RefreshCw size={14} />Làm mới QR</button><button type="button" className="button button-secondary" onClick={createSession} disabled={status === 'creating'}><RefreshCw size={14} />Tạo phiên mới</button></div></div></div>}
    {session && <div className="scanner-device-state"><div className="scanner-device-dot" /><div><strong>{session.deviceName ? `Điện thoại: ${session.deviceName}` : 'Điện thoại: chưa xác minh'}</strong><small>{session.connectedAt ? `Đã xác thực lúc ${new Date(session.connectedAt).toLocaleTimeString('vi-VN')}` : 'Thiết bị chưa tham gia phiên.'}</small></div><StatusBadge tone={session.connectedAt ? 'success' : 'neutral'}>{session.connectedAt ? 'Đã kết nối' : 'Chưa kết nối'}</StatusBadge></div>}
        {!session && <div className="scanner-session-empty"><QrCode size={27} /><strong>{scannerMode === 'api' ? status === 'creating' ? 'Đang tạo phiên scanner…' : 'Chưa tạo phiên scanner' : 'Scanner điện thoại chưa khả dụng'}</strong><span>{scannerMode === 'api' ? 'Backend tạo phiên riêng, nonce ghép nối một lần và tự hết hạn.' : 'Cấu hình API backend để sử dụng scanner từ xa.'}</span>{scannerMode === 'api' && <><div className="scanner-url-field"><span>Địa chỉ kết nối</span><small>{baseUrlError || `Được lấy tự động từ origin hiện tại: ${baseUrl}`}</small></div><button type="button" className="button button-primary" onClick={createSession} disabled={status === 'creating' || Boolean(baseUrlError)}><QrCode size={16} />Tạo QR kết nối</button></>}</div>}
      {session && <div className="scanner-dialog-footer"><span>Phiên tự hết hạn lúc {new Date(session.expiresAt).toLocaleTimeString('vi-VN')}</span><div>{status !== 'ended' && status !== 'expired' && <button type="button" className="button button-secondary scanner-end-button" onClick={closeSession}><Unplug size={15} />Ngắt kết nối</button>}<button type="button" className="button button-secondary" onClick={dismiss}>Đóng</button></div></div>}
      {!session && <div className="scanner-dialog-footer"><span>Token phiên giới hạn quyền scanner; không phải đăng nhập hệ thống.</span><button type="button" className="button button-secondary" onClick={dismiss}>Đóng</button></div>}
  </Modal>
}
