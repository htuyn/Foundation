import { useState, type FormEvent } from 'react'
import { Boxes, Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { authApiEnabled, useAuth } from './AuthContext'

export function LoginPage() {
  const { login } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email, password)
      const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard'
      navigate(destination, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><span><Boxes size={25} /></span><div><strong>FOUNDATION</strong><small>INVENTORY CLOUD</small></div></div><div className="auth-heading"><div className="auth-icon"><LockKeyhole size={21} /></div><p>CHÀO MỪNG TRỞ LẠI</p><h1>Đăng nhập hệ thống</h1><span>Sử dụng tài khoản được quản trị viên cấp để tiếp tục.</span></div><form className="auth-form" onSubmit={submit}><label>Email công việc<input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></label><label>Mật khẩu<div className="auth-password"><input autoComplete="current-password" type={visible ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button button-primary auth-submit" type="submit" disabled={submitting}>{submitting ? 'Đang xác thực…' : 'Đăng nhập'}</button></form><div className="auth-security"><LockKeyhole size={14} />{authApiEnabled ? 'Phiên đăng nhập được mã hóa và bảo vệ theo vai trò.' : 'Chế độ demo local: chưa có xác thực tài khoản.'}</div></section></main>
}
