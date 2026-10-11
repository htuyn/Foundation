import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { AlertTriangle, Camera, CameraOff, Check, Flashlight, Pause, Play, RefreshCw, ScanLine, Send, Smartphone, WifiOff } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { scanEventService, scannerSessionService, isValidDemoQrNonce, isValidDemoSessionId, ScannerApiError } from './scannerService'
import type { ConnectionStatus, ScanEvent, ScanFormat, ScanResult, ScannerError } from './types'

const supportedFormats = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE]
const configuredCooldown = Number(import.meta.env.VITE_SCANNER_SCAN_COOLDOWN_MS ?? 1800)
const scanCooldownMs = Number.isFinite(configuredCooldown) ? Math.max(500, Math.min(configuredCooldown, 10000)) : 1800
const formatNames = new Map<number, ScanFormat>([
  [BarcodeFormat.EAN_13, 'EAN_13'],
  [BarcodeFormat.EAN_8, 'EAN_8'],
  [BarcodeFormat.UPC_A, 'UPC_A'],
  [BarcodeFormat.UPC_E, 'UPC_E'],
  [BarcodeFormat.CODE_128, 'CODE_128'],
  [BarcodeFormat.CODE_39, 'CODE_39'],
  [BarcodeFormat.QR_CODE, 'QR_CODE'],
])

function makeEvent(sessionId: string, barcode: string, format: ScanFormat): ScanEvent {
  const eventId = globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16)
  })
  return {
    eventId,
    sessionId,
    barcode,
    format,
    scannedAt: new Date().toISOString(),
  }
}

function cameraError(error: unknown): ScannerError {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return { code: 'CAMERA_PERMISSION_DENIED', message: 'Trình duyệt chưa cấp quyền camera. Hãy cho phép camera trong cài đặt trang rồi bấm “Bật camera”.', recoverable: true }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return { code: 'CAMERA_NOT_FOUND', message: 'Không tìm thấy camera phù hợp trên thiết bị này.', recoverable: false }
  if (name === 'NotReadableError' || name === 'TrackStartError') return { code: 'CAMERA_IN_USE', message: 'Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.', recoverable: true }
  return { code: 'CAMERA_START_FAILED', message: error instanceof Error ? error.message : 'Không thể khởi động camera. Hãy thử lại hoặc nhập mã thủ công.', recoverable: true }
}

export function ScannerMobilePage() {
  const [searchParams] = useSearchParams()
  const fragmentParams = useMemo(() => new URLSearchParams(window.location.hash.slice(1)), [])
  const sessionId = searchParams.get('sessionId') ?? ''
  const mode = searchParams.get('mode')
  const expiresAt = Number(searchParams.get('expiresAt') ?? 0)
  const qrNonce = fragmentParams.get('qrNonce') ?? ''
  const qrExpiresAt = Number(fragmentParams.get('qrExpiresAt') ?? 0)
  const validSessionUrl = (mode === 'demo' && isValidDemoSessionId(sessionId) || mode === 'api' && /^[0-9a-f-]{36}$/i.test(sessionId)) && Number.isFinite(expiresAt) && expiresAt > 0 && isValidDemoQrNonce(qrNonce) && Number.isFinite(qrExpiresAt) && qrExpiresAt > 0
  const [qrWasCurrentAtOpen] = useState(() => validSessionUrl && Date.now() < qrExpiresAt)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(validSessionUrl && qrWasCurrentAtOpen ? mode === 'api' ? 'waiting_for_device' : 'unverified_demo' : 'error')
  const [scanStatus, setScanStatus] = useState<'stopped' | 'starting' | 'scanning' | 'paused'>('stopped')
  const [error, setError] = useState<ScannerError | null>(() => !validSessionUrl
    ? { code: 'INVALID_SESSION', message: 'Liên kết phiên không hợp lệ. Hãy quét lại QR từ màn hình quản lý kho.', recoverable: false }
    : !qrWasCurrentAtOpen
      ? { code: 'QR_EXPIRED', message: 'QR đã hết hạn trước khi mở. Hãy quét mã QR mới nhất trên máy tính.', recoverable: false }
      : null)
  const [manualCode, setManualCode] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [joinAttempt, setJoinAttempt] = useState(0)
  const [joinFailed, setJoinFailed] = useState(false)
  const [history, setHistory] = useState<ScanResult[]>([])
  const [notice, setNotice] = useState('')
  const [joinMessage, setJoinMessage] = useState(mode === 'api'
    ? validSessionUrl && qrWasCurrentAtOpen ? 'Đang xác thực phiên với backend.' : 'Liên kết không hợp lệ hoặc QR đã hết hạn.'
    : 'Đang kiểm tra liên kết demo; backend chưa xác thực phiên.')
  const [torchOn, setTorchOn] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const mountedRef = useRef(false)
  const cameraStartingRef = useRef(false)
  const cameraAttemptRef = useRef(0)
  const autoCameraAttemptedRef = useRef(false)
  const pausedRef = useRef(false)
  const lastScanRef = useRef<{ barcode: string; at: number } | null>(null)
  const joinStartedRef = useRef(false)
  const mobileConnectionCleanupRef = useRef<(() => void) | null>(null)
  const inFlightIdsRef = useRef(new Set<string>())
  const sessionExpired = useMemo(() => validSessionUrl && expiresAt > 0 && clock >= expiresAt, [clock, expiresAt, validSessionUrl])
  const canScan = validSessionUrl && qrWasCurrentAtOpen && !sessionExpired && (mode === 'demo' || connectionStatus === 'connected')

  const stopCamera = useCallback(() => {
    cameraAttemptRef.current += 1
    controlsRef.current?.stop()
    controlsRef.current = null
    const video = videoRef.current
    const stream = video?.srcObject as MediaStream | null
    stream?.getTracks().forEach((track) => track.stop())
    if (video) video.srcObject = null
    if (mountedRef.current) {
      setTorchOn(false)
      setScanStatus('stopped')
    }
  }, [])

  const deliver = useCallback(async (event: ScanEvent) => {
    if (inFlightIdsRef.current.has(event.eventId)) return
    inFlightIdsRef.current.add(event.eventId)
    setHistory((current) => [{ event, status: 'pending', message: 'Đang gửi về máy tính…' }, ...current.filter((item) => item.event.eventId !== event.eventId)])
    try {
      const result = await scanEventService.sendFromMobile(event)
      if (mountedRef.current) setHistory((current) => current.map((item) => item.event.eventId === event.eventId ? { ...item, status: result.delivered ? 'new' : 'failed', message: result.message } : item))
    } catch (sendError) {
      if (mountedRef.current) {
        setHistory((current) => current.map((item) => item.event.eventId === event.eventId ? { ...item, status: 'failed', message: sendError instanceof Error ? sendError.message : 'Gửi mã thất bại; hãy thử gửi lại.' } : item))
        if (sendError instanceof ScannerApiError && [403, 410].includes(sendError.status)) {
          setConnectionStatus(sendError.status === 410 ? 'expired' : 'error')
          setJoinMessage(`${sendError.message} Hãy quay lại máy tính để tạo phiên/QR mới.`)
          setError({ code: sendError.code ?? 'SCANNER_SESSION_CLOSED', message: sendError.message, recoverable: false })
          stopCamera()
        }
      }
    } finally {
      inFlightIdsRef.current.delete(event.eventId)
    }
  }, [stopCamera])

  const receiveCode = useCallback((rawCode: string, format: ScanFormat) => {
    const barcode = rawCode.trim()
    if (!barcode) return
    if (format === 'QR_CODE' && (/\/scanner\/mobile/i.test(barcode) || /[?&](sessionId|mode)=/i.test(barcode))) {
      setNotice('Đây là QR kết nối phiên, không phải mã hàng hóa. Hãy quét barcode sản phẩm.')
      return
    }
    setNotice(`Đã nhận diện ${barcode}. ${mode === 'api' ? 'Đang gửi mã về máy tính.' : 'Bản DEMO chưa gửi mã về máy tính.'}`)
    if ('vibrate' in navigator) navigator.vibrate?.(70)
    try {
      const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioContextConstructor) {
        const audio = new AudioContextConstructor()
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        oscillator.connect(gain)
        gain.connect(audio.destination)
        oscillator.frequency.value = 880
        gain.gain.value = 0.08
        oscillator.start()
        oscillator.onended = () => { void audio.close() }
        oscillator.stop(audio.currentTime + 0.08)
      }
    } catch { /* Audio feedback is optional and browser-dependent. */ }
    void deliver(makeEvent(sessionId, barcode, format))
  }, [deliver, mode, sessionId])

  const startCamera = useCallback(async (requestedDeviceId = deviceId) => {
    if (!canScan) return
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      setError({ code: 'INSECURE_CONTEXT', message: 'Camera cần HTTPS. Hãy mở website qua HTTPS hoặc dùng localhost trên chính thiết bị.', recoverable: false })
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError({ code: 'CAMERA_UNSUPPORTED', message: 'Trình duyệt này không hỗ trợ truy cập camera. Bạn vẫn có thể nhập mã thủ công.', recoverable: false })
      return
    }
    if (cameraStartingRef.current) return
    if (controlsRef.current) stopCamera()
    const cameraAttempt = ++cameraAttemptRef.current
    cameraStartingRef.current = true
    pausedRef.current = false
    setError(null)
    setScanStatus('starting')
    try {
      const hints = new Map<DecodeHintType, unknown>()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, supportedFormats)
      const reader = new BrowserMultiFormatReader(hints as Map<DecodeHintType, any>, { delayBetweenScanAttempts: 120 })
      const controls = await reader.decodeFromConstraints({
        audio: false,
        video: requestedDeviceId ? { deviceId: { exact: requestedDeviceId } } : { facingMode: { ideal: 'environment' } },
      }, videoRef.current ?? undefined, (result) => {
        if (!result || !mountedRef.current || cameraAttemptRef.current !== cameraAttempt || pausedRef.current) return
        const code = result.getText()
        const format = formatNames.get(result.getBarcodeFormat())
        if (format) {
          const now = Date.now()
          if (lastScanRef.current?.barcode === code && now - lastScanRef.current.at < scanCooldownMs) return
          lastScanRef.current = { barcode: code, at: now }
          receiveCode(code, format)
        }
      })
      if (!mountedRef.current || cameraAttemptRef.current !== cameraAttempt) {
        controls.stop()
        return
      }
      controlsRef.current = controls
      setScanStatus('scanning')
      try {
        const availableDevices = await BrowserMultiFormatReader.listVideoInputDevices()
        if (!mountedRef.current || cameraAttemptRef.current !== cameraAttempt) {
          controls.stop()
          return
        }
        setDevices(availableDevices)
        if (!requestedDeviceId) {
          const preferred = availableDevices.find((device) => /back|rear|environment|tr[aă] sau/i.test(device.label))
          if (preferred) setDeviceId(preferred.deviceId)
        }
      } catch {
        setDevices([])
      }
    } catch (cameraFailure) {
      if (cameraAttemptRef.current === cameraAttempt && mountedRef.current) {
        stopCamera()
        setError(cameraError(cameraFailure))
      }
    } finally {
      cameraStartingRef.current = false
    }
  }, [canScan, deviceId, receiveCode, stopCamera])

  const togglePause = () => {
    pausedRef.current = !pausedRef.current
    setScanStatus(pausedRef.current ? 'paused' : 'scanning')
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopCamera()
    }
  }, [stopCamera])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const handleDeviceStatus = useCallback((nextStatus: ConnectionStatus | 'device_disconnected' | 'retry_exhausted') => {
    if (!mountedRef.current) return
    if (nextStatus === 'retry_exhausted') {
      autoCameraAttemptedRef.current = false
      setConnectionStatus('disconnected')
      setJoinMessage('Đã dừng thử kết nối sau 8 lần. Hãy thử kết nối lại hoặc quét QR mới.')
      stopCamera()
      return
    }
    if (nextStatus === 'device_disconnected' || nextStatus === 'disconnected') {
      autoCameraAttemptedRef.current = false
      setConnectionStatus('disconnected')
      setJoinMessage('Mất kết nối với backend; camera đã dừng và hệ thống đang thử kết nối lại.')
      stopCamera()
      return
    }
    setConnectionStatus(nextStatus)
    if (nextStatus === 'connected') setJoinMessage('Điện thoại đã ghép nối và kết nối tới backend.')
    if (nextStatus === 'ended' || nextStatus === 'expired') {
      setJoinMessage(nextStatus === 'expired' ? 'Phiên scanner đã hết hạn.' : 'Máy tính đã ngắt phiên scanner.')
      setError({ code: nextStatus === 'expired' ? 'SESSION_EXPIRED' : 'SESSION_ENDED', message: nextStatus === 'expired' ? 'Phiên scanner đã hết hạn.' : 'Máy tính đã ngắt phiên scanner.', recoverable: false })
      stopCamera()
    }
  }, [stopCamera])

  const startDeviceConnection = useCallback(() => {
    mobileConnectionCleanupRef.current?.()
    mobileConnectionCleanupRef.current = scannerSessionService.connectDevice(sessionId, handleDeviceStatus)
  }, [handleDeviceStatus, sessionId])

  useEffect(() => {
    if (!validSessionUrl || !qrWasCurrentAtOpen || joinStartedRef.current) return
    joinStartedRef.current = true
    let cancelled = false
    void scannerSessionService.joinSession(sessionId, 'Điện thoại', qrNonce).then((result) => {
      if (cancelled || !mountedRef.current) return
      setJoinMessage(result.message)
      if (result.joined) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      if (result.joined) {
        setJoinFailed(false)
        startDeviceConnection()
      } else setConnectionStatus(mode === 'api' ? 'error' : 'unverified_demo')
    }).catch((joinError) => {
      if (cancelled || !mountedRef.current) return
      const requiresNewQr = joinError instanceof ScannerApiError && [403, 404, 409, 410].includes(joinError.status)
      setJoinFailed(!requiresNewQr)
      setConnectionStatus('error')
      setJoinMessage(`${joinError instanceof Error ? joinError.message : 'Không thể tham gia phiên scanner.'} Nếu QR đã hết hạn hoặc đã được dùng, hãy tạo phiên/QR mới trên máy tính.`)
    })
    return () => {
      cancelled = true
      mobileConnectionCleanupRef.current?.()
      mobileConnectionCleanupRef.current = null
      if (!mobileConnectionCleanupRef.current) joinStartedRef.current = false
    }
  }, [joinAttempt, mode, qrNonce, qrWasCurrentAtOpen, sessionId, startDeviceConnection, validSessionUrl])

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      autoCameraAttemptedRef.current = false
      if (scanStatus !== 'stopped') stopCamera()
      return
    }
    if (mode !== 'api' || !canScan || autoCameraAttemptedRef.current) return
    autoCameraAttemptedRef.current = true
    void startCamera()
  }, [canScan, connectionStatus, mode, scanStatus, startCamera, stopCamera])

  useEffect(() => {
    if (sessionExpired) {
      setConnectionStatus('expired')
       setJoinMessage('Phiên scanner đã hết hạn. Hãy quay lại máy tính và tạo phiên mới.')
       setError({ code: 'SESSION_EXPIRED', message: 'Phiên scanner đã hết hạn. Hãy quay lại máy tính và tạo phiên mới.', recoverable: false })
      stopCamera()
    }
  }, [sessionExpired, stopCamera])

  const submitManual = (event: FormEvent) => {
    event.preventDefault()
    const code = manualCode.trim()
    if (!code || !canScan) return
    receiveCode(code, 'MANUAL')
    setManualCode('')
  }

  const retry = (item: ScanResult) => {
    setHistory((current) => current.map((entry) => entry.event.eventId === item.event.eventId ? { ...entry, status: 'pending', message: 'Đang thử gửi lại cùng eventId...' } : entry))
    void deliver(item.event)
  }

  const retryConnection = () => {
    setError(null)
    if (connectionStatus === 'disconnected') {
      autoCameraAttemptedRef.current = false
      setJoinMessage('Đang kết nối lại WebSocket tới backend…')
      setConnectionStatus('waiting_for_device')
      startDeviceConnection()
      return
    }
    joinStartedRef.current = false
    setJoinFailed(false)
    setJoinMessage('Đang xác thực lại nonce với backend…')
    setConnectionStatus('waiting_for_device')
    setJoinAttempt((attempt) => attempt + 1)
  }

  const toggleTorch = async () => {
    const controls = controlsRef.current
    if (!controls?.switchTorch) {
      setError({ code: 'TORCH_UNSUPPORTED', message: 'Thiết bị hoặc trình duyệt không hỗ trợ bật đèn flash.', recoverable: true })
      return
    }
    try {
      await controls.switchTorch(!torchOn)
      setTorchOn(!torchOn)
    } catch {
      setError({ code: 'TORCH_FAILED', message: 'Không thể bật đèn flash trên camera này.', recoverable: true })
    }
  }

  return <main className="mobile-scanner-page">
    <header className="mobile-scanner-header"><div className="mobile-scanner-brand"><span><ScanLine size={18} /></span><div><strong>Smart Warehouse</strong><small>TRÌNH QUÉT DI ĐỘNG</small></div></div><span className="demo-pill">{mode === 'api' ? 'API' : 'DEMO'}</span></header>
    <section className="mobile-session-card"><div className="mobile-session-top"><div className="mobile-session-icon"><Smartphone size={17} /></div><div><strong>{connectionStatus === 'expired' ? 'Phiên đã hết hạn' : !qrWasCurrentAtOpen ? 'QR đã hết hạn' : validSessionUrl ? mode === 'api' ? 'Phiên đã xác minh' : 'Phiên demo chưa xác minh' : 'Phiên không hợp lệ'}</strong><small>{validSessionUrl ? `Mã phiên ${sessionId.slice(0, 17)}…` : 'Không thể xác minh QR này.'}</small></div></div><div className="mobile-demo-warning" role={joinFailed || connectionStatus === 'disconnected' || connectionStatus === 'error' || connectionStatus === 'expired' ? 'alert' : undefined}><WifiOff size={15} /><span>{joinMessage} {mode === 'api' ? 'Mã quét được gửi tới backend.' : <>Mã quét chỉ lưu tạm trên điện thoại, <strong>không gửi về máy tính</strong>.</>}</span></div>{mode === 'api' && validSessionUrl && !sessionExpired && (joinFailed || connectionStatus === 'disconnected') && <button type="button" className="mobile-button mobile-button-secondary mobile-connect-retry" onClick={retryConnection}>{connectionStatus === 'disconnected' ? 'Thử kết nối lại' : 'Thử xác thực lại'}</button>}</section>
    <section className="mobile-camera-card">
      <div className="mobile-section-heading"><div><h1>Quét mã sản phẩm</h1><p>{scanStatus === 'starting' ? 'Đang yêu cầu quyền truy cập camera…' : scanStatus === 'scanning' ? 'Hướng camera vào barcode trên sản phẩm' : scanStatus === 'paused' ? 'Camera đang tạm dừng' : 'Camera sẽ tự bật sau khi phiên được xác thực'}</p></div>{scanStatus === 'scanning' && <span className="camera-live"><i />Đang quét</span>}</div>
      <div className={`camera-viewport ${scanStatus === 'scanning' || scanStatus === 'paused' ? 'camera-active' : ''}`}>
        <video ref={videoRef} muted playsInline className={scanStatus === 'scanning' || scanStatus === 'paused' ? 'camera-video visible' : 'camera-video'} />
        {scanStatus !== 'scanning' && scanStatus !== 'paused' && <div className="camera-placeholder"><Camera size={27} /><strong>{scanStatus === 'starting' ? 'Đang xin quyền camera…' : error?.code === 'CAMERA_PERMISSION_DENIED' ? 'Camera chưa được cấp quyền' : error?.code === 'CAMERA_NOT_FOUND' ? 'Không tìm thấy camera' : 'Camera đang tắt'}</strong><span>{error?.code === 'CAMERA_PERMISSION_DENIED' ? 'Cho phép camera trong cài đặt trình duyệt hoặc biểu tượng ổ khóa, sau đó thử lại.' : 'Sau khi cho phép, camera sau sẽ mở tự động khi phiên API kết nối thành công.'}</span></div>}
        {scanStatus === 'scanning' && <div className="camera-guide" aria-hidden="true"><i /></div>}
        {(scanStatus === 'scanning' || scanStatus === 'paused') && <div className="camera-overlay-bottom"><span>{scanStatus === 'paused' ? 'Đã tạm dừng nhận diện' : 'Đưa barcode vào khung; quét liên tục'}</span>{controlsRef.current?.switchTorch && <button type="button" aria-label={torchOn ? 'Tắt đèn flash' : 'Bật đèn flash'} onClick={toggleTorch} className={torchOn ? 'flash-active' : ''}><Flashlight size={17} /></button>}</div>}
      </div>
      {devices.length > 1 && <label className="mobile-camera-select"><span>Camera</span><select value={deviceId} onChange={(event) => { setDeviceId(event.target.value); if (scanStatus === 'scanning') void startCamera(event.target.value) }}><option value="">Camera sau (tự chọn)</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>}
      {error && <div className={`mobile-camera-error ${error.code === 'TORCH_UNSUPPORTED' || error.code === 'TORCH_FAILED' ? 'minor' : ''}`} role="alert"><AlertTriangle size={15} /><span>{error.message}</span></div>}
      <div className="mobile-camera-actions">{scanStatus === 'starting' ? <button type="button" className="mobile-button mobile-button-secondary" onClick={stopCamera}><CameraOff size={18} />Hủy yêu cầu camera</button> : scanStatus === 'scanning' || scanStatus === 'paused' ? <><button type="button" className="mobile-button mobile-button-secondary" onClick={togglePause}>{scanStatus === 'paused' ? <Play size={18} /> : <Pause size={18} />}{scanStatus === 'paused' ? 'Tiếp tục quét' : 'Tạm dừng'}</button><button type="button" className="mobile-button mobile-button-secondary" onClick={stopCamera}><CameraOff size={18} />Tắt camera</button></> : <button type="button" className="mobile-button mobile-button-primary" disabled={!canScan} onClick={() => void startCamera()}><Camera size={18} />{error?.code === 'CAMERA_PERMISSION_DENIED' ? 'Cho phép camera / Bật camera' : 'Bật camera'}</button>}</div>
      {notice && <div className="mobile-scan-notice"><Check size={15} />{notice}</div>}
    </section>
     <section className="mobile-manual-card"><h2>Nhập barcode thủ công</h2><form onSubmit={submitManual}><input value={manualCode} onChange={(event) => setManualCode(event.target.value)} disabled={!canScan} placeholder="Barcode sản phẩm" aria-label="Nhập barcode sản phẩm" /><button type="submit" disabled={!manualCode.trim() || !canScan} aria-label="Gửi barcode"><Send size={17} /></button></form></section>
     <section className="mobile-history-card"><div className="mobile-history-heading"><div><h2>Lịch sử quét</h2><p>{history.length} mã trên thiết bị này · {mode === 'api' ? 'trạng thái gửi được cập nhật' : 'chưa đồng bộ'}</p></div><span>{history.length}</span></div>{history.length ? <div className="mobile-history-list">{history.map((item) => <article className="mobile-history-item" key={item.event.eventId}><div className="mobile-history-icon"><ScanLine size={16} /></div><div className="mobile-history-copy"><strong>{item.event.barcode}</strong><small>{item.event.format} · {new Date(item.event.scannedAt).toLocaleTimeString('vi-VN')}</small><span className="mobile-history-error">{item.message}</span></div>{item.status === 'failed' && <button type="button" className="mobile-retry-button" onClick={() => retry(item)}><RefreshCw size={14} />Gửi lại</button>}</article>)}</div> : <div className="mobile-history-empty">Mã đã quét sẽ xuất hiện tại đây.</div>}</section>
      {mode === 'api' && connectionStatus !== 'ended' && connectionStatus !== 'expired' && <button type="button" className="mobile-button mobile-button-secondary" onClick={() => { stopCamera(); void scannerSessionService.leaveSession(sessionId).then(() => { mobileConnectionCleanupRef.current?.(); mobileConnectionCleanupRef.current = null; setConnectionStatus('ended'); setJoinMessage('Đã đóng phiên scanner trên điện thoại.') }).catch((leaveError) => setError({ code: 'SCANNER_LEAVE_FAILED', message: leaveError instanceof Error ? leaveError.message : 'Không thể đóng phiên scanner.', recoverable: true })) }}><CameraOff size={17} />Ngắt kết nối</button>}
     <footer className="mobile-scanner-footer">Chỉ sử dụng HTTPS trên điện thoại. {mode === 'api' ? 'Mã quét được chuyển về máy tính; không tự thay đổi tồn kho.' : 'Đây là chế độ demo, không phải kết nối kho thật.'}</footer>
  </main>
}
