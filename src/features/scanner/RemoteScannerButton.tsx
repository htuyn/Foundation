import { useState } from 'react'
import { Smartphone } from 'lucide-react'
import { ScannerConnectionDialog } from './ScannerConnectionDialog'
import type { ScanEvent } from './types'

export function RemoteScannerButton({ onScan, className = 'button button-secondary', disabled = false, label = 'Kết nối điện thoại làm scanner' }: {
  onScan: (event: ScanEvent) => void
  className?: string
  disabled?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)} disabled={disabled}><Smartphone size={15} />{label}</button>
    {open && <ScannerConnectionDialog onClose={() => setOpen(false)} onScan={onScan} />}
  </>
}
