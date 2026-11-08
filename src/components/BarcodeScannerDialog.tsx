import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { AlertTriangle, Camera, CameraOff, Flashlight, Minus, Plus, ScanLine } from 'lucide-react'
import type { ScanFormat } from '../features/scanner/types'
import { Modal } from './common'

const formats = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
]

const formatNames = new Map<number, Exclude<ScanFormat, 'QR_CODE' | 'MANUAL'>>([
  [BarcodeFormat.EAN_13, 'EAN_13'],
  [BarcodeFormat.EAN_8, 'EAN_8'],
  [BarcodeFormat.UPC_A, 'UPC_A'],
  [BarcodeFormat.UPC_E, 'UPC_E'],
  [BarcodeFormat.CODE_128, 'CODE_128'],
  [BarcodeFormat.CODE_39, 'CODE_39'],
])

type CameraStatus = 'stopped' | 'starting' | 'scanning' | 'success' | 'error'
const rearmAfterMissingMs = 350

function cameraMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Bạn chưa cấp quyền camera. Hãy bật quyền Camera trong cài đặt trang/trình duyệt rồi thử lại, hoặc nhập barcode thủ công.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Không tìm thấy camera trên thiết bị này. Bạn có thể nhập barcode thủ công.'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.'
  if (name === 'OverconstrainedError') return 'Camera đã chọn không khả dụng. Hãy chọn camera khác hoặc thử lại.'
  return error instanceof Error ? `${error.message} Bạn vẫn có thể nhập barcode thủ công.` : 'Không thể mở camera. Bạn vẫn có thể nhập barcode thủ công.'
}

export function BarcodeScannerDialog({ onClose, onDetected, confirmBeforeApply = false, continuous = false }: {
  onClose: () => void
  onDetected: (barcode: string, format: Exclude<ScanFormat, 'QR_CODE'>) => void
  confirmBeforeApply?: boolean
  continuous?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const mountedRef = useRef(false)
  const scannedRef = useRef(false)
  const activeBarcodeRef = useRef<{ barcode: string; lastSeenAt: number } | null>(null)
  const [status, setStatus] = useState<CameraStatus>('stopped')
  const [error, setError] = useState('')
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState('')
  const [detected, setDetected] = useState<{ barcode: string; format: Exclude<ScanFormat, 'QR_CODE'> } | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; value: number } | null>(null)

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    const video = videoRef.current
    const stream = video?.srcObject as MediaStream | null
    stream?.getTracks().forEach((track) => track.stop())
    if (video) video.srcObject = null
    if (mountedRef.current) {
      setTorchOn(false)
      setZoom(null)
      setStatus('stopped')
    }
  }, [])

  const startCamera = useCallback(async (requestedCameraId = cameraId) => {
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      setError('Camera cần HTTPS hoặc localhost trên chính thiết bị. Hãy mở website qua HTTPS hoặc nhập barcode thủ công.')
      setStatus('error')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Trình duyệt không hỗ trợ truy cập camera. Hãy dùng trình duyệt hiện đại qua HTTPS hoặc nhập barcode thủ công.')
      setStatus('error')
      return
    }

    stopCamera()
    setError('')
    setDetected(null)
    setStatus('starting')
    scannedRef.current = false
    activeBarcodeRef.current = null
    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats)
    hints.set(DecodeHintType.TRY_HARDER, true)
    const reader = new BrowserMultiFormatReader(hints as Map<DecodeHintType, any>, { delayBetweenScanAttempts: 80 })
    try {
      const controls = await reader.decodeFromConstraints({
        audio: false,
        video: requestedCameraId
          ? { deviceId: { exact: requestedCameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      }, videoRef.current ?? undefined, (result) => {
        if (!mountedRef.current || scannedRef.current) return
        const now = Date.now()
        if (!result) {
          if (activeBarcodeRef.current && now - activeBarcodeRef.current.lastSeenAt >= rearmAfterMissingMs) activeBarcodeRef.current = null
          return
        }
        const barcode = result.getText().trim()
        const format = formatNames.get(result.getBarcodeFormat())
        if (!barcode || !format) return
        if (continuous) {
          if (activeBarcodeRef.current?.barcode === barcode) {
            activeBarcodeRef.current.lastSeenAt = now
            return
          }
          activeBarcodeRef.current = { barcode, lastSeenAt: now }
          setDetected({ barcode, format })
          onDetected(barcode, format)
          return
        }
        scannedRef.current = true
        stopCamera()
        setDetected({ barcode, format })
        setStatus('success')
        if (!confirmBeforeApply) onDetected(barcode, format)
      })
      if (!mountedRef.current) {
        controls.stop()
        return
      }
      controlsRef.current = controls
      const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
      if (track && typeof track.getCapabilities === 'function') {
        const capabilities = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min: number; max: number; step: number } }
        const advanced: (MediaTrackConstraintSet & { focusMode?: string; zoom?: number })[] = []
        if (capabilities.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' })
        if (capabilities.zoom) {
          const currentZoom = (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom ?? capabilities.zoom.min
          setZoom({ ...capabilities.zoom, value: currentZoom })
        }
        if (advanced.length) void track.applyConstraints({ advanced: advanced as MediaTrackConstraintSet[] }).catch(() => undefined)
      }
      if (scannedRef.current) {
        controls.stop()
        controlsRef.current = null
        setStatus('success')
      } else {
        setStatus('scanning')
      }
      const available = await navigator.mediaDevices.enumerateDevices()
      if (!mountedRef.current) return
      const videoInputs = available.filter((device) => device.kind === 'videoinput')
      setCameras(videoInputs)
      const preferred = videoInputs.find((device) => /back|rear|environment|tr[aă] sau/i.test(device.label))
      if (!requestedCameraId && preferred) setCameraId(preferred.deviceId)
      else setCameraId(requestedCameraId)
    } catch (cameraError) {
      stopCamera()
      if (!mountedRef.current) return
      setError(cameraMessage(cameraError))
      setStatus('error')
    }
  }, [cameraId, confirmBeforeApply, continuous, onDetected, stopCamera])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopCamera()
    }
  }, [stopCamera])

  const selectCamera = (nextCameraId: string) => {
    setCameraId(nextCameraId)
    if (status === 'scanning') void startCamera(nextCameraId)
  }

  const toggleTorch = async () => {
    const controls = controlsRef.current
    if (!controls?.switchTorch) {
      setError('Thiết bị hoặc trình duyệt này không hỗ trợ đèn flash.')
      return
    }
    try {
      await controls.switchTorch(!torchOn)
      setTorchOn((current) => !current)
      setError('')
    } catch {
      setError('Không thể bật đèn flash trên camera này.')
    }
  }

  const changeZoom = async (direction: -1 | 1) => {
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
    if (!track || !zoom) return
    const nextZoom = Math.min(zoom.max, Math.max(zoom.min, zoom.value + zoom.step * direction))
    try {
      await track.applyConstraints({ advanced: [{ zoom: nextZoom } as MediaTrackConstraintSet] })
      setZoom((current) => current ? { ...current, value: nextZoom } : current)
    } catch {
      setError('Không thể điều chỉnh zoom trên camera này.')
    }
  }

  const applyDetected = () => {
    if (!detected) return
    onDetected(detected.barcode, detected.format)
    onClose()
  }

  const submitManual = () => {
    const barcode = manualCode.trim()
    if (!barcode) {
      setError('Nhập barcode cần dùng hoặc cấp quyền camera để quét.')
      return
    }
    if (barcode.length > 160) {
      setError('Barcode không được vượt quá 160 ký tự.')
      return
    }
    stopCamera()
    setError('')
    if (continuous) {
      onDetected(barcode, 'MANUAL')
      setManualCode('')
      return
    }
    if (confirmBeforeApply) {
      setDetected({ barcode, format: 'MANUAL' })
      return
    }
    onDetected(barcode, 'MANUAL')
    onClose()
  }

  return <Modal title={continuous ? 'Quét hàng nhập bằng camera' : 'Quét mã vạch sản phẩm'} subtitle={continuous ? 'Hướng camera vào barcode; đưa mã ra khỏi khung rồi quét lại để tăng số lượng.' : 'Cho phép camera khi trình duyệt hỏi. Mã quét chỉ được điền vào biểu mẫu, chưa tự lưu sản phẩm.'} onClose={onClose} wide>
    <div className="product-scanner-dialog">
      <div className={`product-scanner-preview ${status === 'scanning' ? 'camera-active' : ''}`}>
        <video ref={videoRef} muted playsInline />
        <div className="product-scanner-frame" aria-hidden="true"><i /></div>
        {status !== 'scanning' && <div className="product-scanner-placeholder"><ScanLine size={26} /><span>{status === 'starting' ? 'Đang mở camera…' : status === 'success' ? 'Đã quét mã thành công' : status === 'error' ? 'Không thể sử dụng camera' : 'Camera đang tắt'}</span></div>}
        {status === 'scanning' && <div className="product-scanner-camera-controls">{zoom && <div className="mobile-zoom-control"><button type="button" disabled={zoom.value <= zoom.min} aria-label="Giảm zoom" onClick={() => void changeZoom(-1)}><Minus size={16} /></button><span>{zoom.value.toFixed(1)}×</span><button type="button" disabled={zoom.value >= zoom.max} aria-label="Tăng zoom" onClick={() => void changeZoom(1)}><Plus size={16} /></button></div>}{controlsRef.current?.switchTorch && <button type="button" className={`product-scanner-flash ${torchOn ? 'active' : ''}`} onClick={() => void toggleTorch()} aria-label={torchOn ? 'Tắt đèn flash' : 'Bật đèn flash'}><Flashlight size={18} /></button>}</div>}
      </div>
      {cameras.length > 1 && <label className="form-field"><span>Chọn camera</span><select value={cameraId} onChange={(event) => selectCamera(event.target.value)}><option value="">Camera sau (tự chọn)</option>{cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>)}</select></label>}
      {error && <div className="product-scanner-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      {detected && <div className="product-scanner-detected" role="status"><strong>{detected.barcode}</strong><span>{continuous ? `Vừa nhận · ${detected.format}` : detected.format}</span>{confirmBeforeApply && <button type="button" className="button button-primary" onClick={applyDetected}>Dùng mã này</button>}</div>}
      <div className="product-scanner-manual"><label className="form-field"><span>Hoặc nhập barcode thủ công</span><input maxLength={160} value={manualCode} onChange={(event) => setManualCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitManual() } }} placeholder="Nhập mã barcode" /></label><button type="button" className="button button-secondary" onClick={submitManual}>Dùng mã nhập</button></div>
      <p className="field-help">Hỗ trợ EAN-13, EAN-8, UPC-A, UPC-E, Code 128 và Code 39. Camera tự lấy nét liên tục/zoom khi thiết bị hỗ trợ. Yêu cầu HTTPS (trừ localhost).</p>
      <div className="product-scanner-actions">
        {status === 'scanning' ? <button type="button" className="button button-secondary" onClick={stopCamera}><CameraOff size={15} />Dừng quét</button> : <button type="button" className="button button-primary" disabled={status === 'starting'} onClick={() => void startCamera()}><Camera size={15} />{status === 'starting' ? 'Đang mở camera…' : status === 'success' ? 'Quét lại' : 'Thử mở camera'}</button>}
        <button type="button" className="button button-secondary" onClick={onClose}>Đóng</button>
      </div>
    </div>
  </Modal>
}
