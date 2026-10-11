export type ConnectionStatus =
  | 'not_created'
  | 'creating'
  | 'waiting_for_device'
  | 'connected'
  | 'receiving'
  | 'disconnected'
  | 'expired'
  | 'ended'
  | 'error'
  | 'unverified_demo'

export type ScanFormat = 'EAN_13' | 'EAN_8' | 'UPC_A' | 'UPC_E' | 'CODE_128' | 'CODE_39' | 'QR_CODE' | 'MANUAL'
export type ScannerSessionStatus = 'waiting_for_device' | 'connected' | 'device_disconnected' | 'ended' | 'expired'

export interface ScannerSession {
  sessionId: string
  status: ConnectionStatus
  mode: 'demo' | 'api'
  createdAt: string
  expiresAt: string
  deviceName?: string
  connectedAt?: string
}

export interface ScannerQrTicket {
  nonce: string
  expiresAt: string
  mobileUrl: string
}

export interface ScanEvent {
  eventId: string
  sessionId: string
  barcode: string
  format: ScanFormat
  scannedAt: string
  deviceId?: string
}

export interface ScanResult {
  event: ScanEvent
  status: 'new' | 'duplicate' | 'not_found' | 'invalid' | 'pending' | 'failed'
  productId?: string
  message?: string
}

export interface ScannerError {
  code: string
  message: string
  recoverable: boolean
}

export interface ScannerSessionService {
  createSession(): Promise<ScannerSession>
  refreshQr(sessionId: string, baseUrl: string): Promise<ScannerQrTicket>
  getSession(sessionId: string): Promise<ScannerSession>
  joinSession(sessionId: string, deviceName: string, qrNonce: string): Promise<{ joined: boolean; message: string }>
  closeSession(sessionId: string): Promise<ScannerSession>
  leaveSession(sessionId: string): Promise<ScannerSession>
  connectDevice(sessionId: string, onStatus: (status: ScannerSessionStatus | 'disconnected' | 'retry_exhausted') => void): () => void
}

export interface ScanEventService {
  sendFromMobile(event: ScanEvent): Promise<{ delivered: boolean; message: string }>
  subscribe(
    sessionId: string,
    listener: (event: ScanEvent) => void,
    onError?: (message: string) => void,
    onSessionStatus?: (status: ScannerSessionStatus) => void,
    onTransportState?: (connected: boolean) => void,
  ): () => void
}
