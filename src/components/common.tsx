import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, X } from 'lucide-react'

export function PageHeader({ eyebrow, title, description, action, className = '' }: { eyebrow?: string; title: string; description: string; action?: ReactNode; className?: string }) {
  return <div className={`page-heading ${className}`.trim()}><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{action && <div className="page-heading-action">{action}</div>}</div>
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'blue' }) {
  return <span className={`status-badge ${tone}`}><i />{children}</span>
}

export function Modal({ title, subtitle, onClose, children, wide = false, closeOnEscape = true }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; closeOnEscape?: boolean }) {
  useEffect(() => {
    if (!closeOnEscape) return
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [closeOnEscape, onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-button" aria-label="Đóng" onClick={onClose}><X size={18} /></button></div>{children}</section></div>
}

export function Pagination({ page, totalPages, onPageChange, total }: { page: number; totalPages: number; onPageChange: (page: number) => void; total: number }) {
  return <div className="pagination"><span>Hiển thị {total ? (page - 1) * 10 + 1 : 0}–{Math.min(page * 10, total)} trong {total} kết quả</span><div><button className="pagination-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Trang trước"><ChevronLeft size={16} /></button><span className="pagination-current">{page} / {Math.max(1, totalPages)}</span><button className="pagination-button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Trang sau"><ChevronRight size={16} /></button></div></div>
}

export function ToastHost() {
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null)
  useEffect(() => {
    let timer: number
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; kind: 'success' | 'error' }>).detail
      setToast(detail)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setToast(null), 3400)
    }
    window.addEventListener('warehouse-toast', handle)
    return () => { window.removeEventListener('warehouse-toast', handle); window.clearTimeout(timer) }
  }, [])
  if (!toast) return null
  return <div className={`toast ${toast.kind}`} role="status"><span className="toast-symbol">{toast.kind === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}</span><span className="toast-message">{toast.message}</span><button className="toast-close" aria-label="Đóng thông báo" onClick={() => setToast(null)}><X size={16} /></button></div>
}

export function FormActions({ onCancel, submit = 'Lưu thông tin', disabled = false }: { onCancel: () => void; submit?: string; disabled?: boolean }) {
  return <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel} disabled={disabled}>Hủy</button><button type="submit" className="button button-primary" disabled={disabled}>{submit}</button></div>
}

export function SearchField({ value, onChange, placeholder = 'Tìm kiếm...' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="table-search"><span className="sr-only">Tìm kiếm</span><input value={value} onChange={(event: FormEvent<HTMLInputElement>) => onChange(event.currentTarget.value)} placeholder={placeholder} /><span>⌕</span></label>
}
