import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useWarehouse, warehouseApiEnabled } from '../data/WarehouseContext'
import {
  Activity, Bell, Boxes, ChartNoAxesCombined, ChevronDown, ChevronLeft, ChevronRight,
  ClipboardList, FileBarChart, LayoutDashboard, Menu, Moon, Package, ScanLine, Search,
  Settings, ShieldCheck, Sun, Truck, Users, Warehouse, X,
} from 'lucide-react'

const groups = [
  { title: 'TỔNG QUAN', links: [{ label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard }] },
  { title: 'QUẢN LÝ KHO', links: [
    { label: 'Sản phẩm', path: '/products', icon: Package },
    { label: 'Danh mục', path: '/categories', icon: Boxes },
    { label: 'Tồn kho', path: '/inventory', icon: ClipboardList },
    { label: 'Kho hàng', path: '/warehouses', icon: Warehouse },
  ] },
  { title: 'VẬN HÀNH', links: [
    { label: 'Nhập kho', path: '/inbound', icon: Truck },
    { label: 'Xuất kho', path: '/outbound', icon: Package },
    { label: 'Giao dịch', path: '/transactions', icon: Activity },
    { label: 'Quét mã vạch', path: '/barcode', icon: ScanLine },
  ] },
  { title: 'BÁO CÁO & QUẢN TRỊ', links: [
    { label: 'Nhà cung cấp', path: '/suppliers', icon: Users },
    { label: 'Người dùng', path: '/users', icon: ShieldCheck },
    { label: 'Báo cáo', path: '/reports', icon: FileBarChart },
    { label: 'Nhật ký hoạt động', path: '/audit-logs', icon: Activity },
    { label: 'Cài đặt', path: '/settings', icon: Settings },
  ] },
]

const routeNames: Record<string, string> = Object.fromEntries(groups.flatMap((group) => group.links.map((link) => [link.path, link.label])))

export function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('warehouse-theme') === 'dark')
  const [search, setSearch] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { data } = useWarehouse()
  const page = routeNames[location.pathname] ?? 'Dashboard'
  const lowStockCount = data.products.filter((product) => data.inventory.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0) <= product.minStock).length
  const draftCount = data.documents.filter((document) => document.status === 'Bản nháp').length

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('warehouse-theme', dark ? 'dark' : 'light')
  }, [dark])

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    if (search.trim()) navigate(`/products?q=${encodeURIComponent(search.trim())}`)
  }

  return (
    <div className={`app-frame ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {mobileOpen && <button className="mobile-overlay" aria-label="Đóng menu" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Boxes size={21} strokeWidth={2.3} /></div>
          {!collapsed && <div className="brand-name">smart<span>warehouse</span><small>INVENTORY CLOUD</small></div>}
          <button className="icon-button collapse-button" aria-label="Thu gọn thanh bên" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button>
          <button className="icon-button mobile-close" aria-label="Đóng menu" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace-switch"><span className="workspace-avatar">A</span>{!collapsed && <><span className="workspace-text"><strong>An Phát Trading</strong><small>{warehouseApiEnabled ? 'Kết nối API' : 'Không gian demo'}</small></span><ChevronDown size={15} /></>}</div>
        <nav className="sidebar-nav" aria-label="Điều hướng chính">
          {groups.map((group) => <div className="nav-group" key={group.title}>
            {!collapsed && <div className="nav-heading">{group.title}</div>}
            {group.links.map(({ label, path, icon: Icon }) => <NavLink key={path} to={path} title={collapsed ? label : undefined} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{label === 'Tồn kho' && !collapsed && lowStockCount > 0 && <span className="nav-count">{lowStockCount}</span>}
            </NavLink>)}
          </div>)}
        </nav>
        {!collapsed && <div className="sidebar-bottom"><div className="storage-card"><div className="storage-top"><span>Dữ liệu ứng dụng</span><span>{warehouseApiEnabled ? 'PostgreSQL' : 'Demo'}</span></div><small>{warehouseApiEnabled ? 'Đồng bộ qua backend API' : 'Lưu cục bộ trên thiết bị này'}</small></div><div className="sidebar-user"><div className="user-avatar">LN</div><div className="sidebar-user-copy"><strong>Lê Hoàng Nam</strong><small>Quản trị viên · mô phỏng</small></div></div></div>}
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Mở menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="breadcrumbs"><span>Không gian làm việc</span><ChevronRight size={14} /><strong>{page}</strong></div></div>
          <div className="topbar-actions">
            <form className="global-search" onSubmit={submitSearch}><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm sản phẩm, mã SKU..." aria-label="Tìm kiếm toàn cục" /><kbd>⌘ K</kbd></form>
            <button className="icon-button theme-button" aria-label="Chuyển giao diện" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <div className="notification-wrap"><button className="icon-button notification-button" aria-label="Thông báo" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell size={18} />{lowStockCount + draftCount > 0 && <i />}</button>{notificationsOpen && <div className="notification-popover"><strong>Thông báo kho</strong>{lowStockCount > 0 && <Link to="/inventory" onClick={() => setNotificationsOpen(false)}><span className="notification-alert amber-alert" /><span><b>{lowStockCount} sản phẩm</b><small>đang ở dưới mức tồn tối thiểu</small></span></Link>}{draftCount > 0 && <Link to="/inbound" onClick={() => setNotificationsOpen(false)}><span className="notification-alert blue-alert" /><span><b>{draftCount} phiếu nháp</b><small>đang chờ xác nhận</small></span></Link>}{lowStockCount + draftCount === 0 && <p>Không có thông báo mới.</p>}</div>}</div>
            <div className="topbar-divider" /><div className="topbar-profile"><div className="user-avatar small">LN</div></div>
          </div>
        </header>
        <div className="page-scroll"><Outlet /></div>
      </main>
    </div>
  )
}
