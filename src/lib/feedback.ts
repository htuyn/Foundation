export function notify(message: string, kind: 'success' | 'error' = 'success') {
  window.dispatchEvent(new CustomEvent('warehouse-toast', { detail: { message, kind } }))
}
