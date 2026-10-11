import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Boxes, ClipboardCheck, Package, Plus, Truck, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader, StatusBadge } from '../components/common'
import { useWarehouse, warehouseApiEnabled } from '../data/WarehouseContext'

const currency = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('vi-VN')

export function DashboardPage() {
  const { data } = useWarehouse()
  const [range, setRange] = useState(7)
  const stockByProduct = useMemo(() => data.products.map((product) => ({ ...product, quantity: data.inventory.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0) })), [data])
  const totalStock = stockByProduct.reduce((sum, product) => sum + product.quantity, 0)
  const stockValue = stockByProduct.reduce((sum, product) => sum + product.quantity * product.cost, 0)
  const lowStock = stockByProduct.filter((product) => product.quantity <= product.minStock)
  const periodStart = Date.now() - range * 86400000
  const inboundCount = data.documents.filter((item) => item.type === 'Nhập kho' && item.status === 'Đã xác nhận' && new Date(item.createdAt).getTime() >= periodStart).length
  const outboundCount = data.documents.filter((item) => item.type === 'Xuất kho' && item.status === 'Đã xác nhận' && new Date(item.createdAt).getTime() >= periodStart).length
  const chartData = Array.from({ length: range === 7 ? 7 : 14 }, (_, index) => {
    const date = new Date(Date.now() - (range === 7 ? 6 - index : 13 - index) * 86400000)
    const key = date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
    const transactions = data.transactions.filter((item) => new Date(item.createdAt).toDateString() === date.toDateString())
    return { date: key, inbound: transactions.filter((item) => item.type === 'Nhập kho').reduce((sum, item) => sum + item.quantity, 0), outbound: transactions.filter((item) => item.type === 'Xuất kho').reduce((sum, item) => sum + item.quantity, 0) }
  })
  const categoryData = data.categories.map((category) => ({ name: category, value: stockByProduct.filter((product) => product.category === category).reduce((sum, product) => sum + product.quantity * product.cost, 0) })).filter((item) => item.value > 0)
  const colors = ['#4f46e5', '#0ea5e9', '#0d9488', '#d97706', '#64748b']
  const recentDocs = [...data.documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)

  const metrics = [
    { label: 'Sản phẩm đang quản lý', value: compact.format(data.products.length), icon: Package, tone: 'blue', note: 'Tổng mã hàng' },
    { label: 'Phiếu nhập', value: compact.format(inboundCount), icon: ArrowDownLeft, tone: 'cyan', note: `Trong ${range} ngày qua` },
    { label: 'Phiếu xuất', value: compact.format(outboundCount), icon: ArrowUpRight, tone: 'rose', note: `Trong ${range} ngày qua` },
  ]

  return <div className="page-content dashboard-page">
    <PageHeader className="dashboard-hero" eyebrow={new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toLocaleUpperCase()} title="Tổng quan kho hàng" description="Theo dõi hoạt động và hiệu suất kho của bạn trong một giao diện." action={<><Link className="button button-secondary" to="/outbound"><ArrowUpRight size={16} />Tạo phiếu xuất</Link><Link className="button button-primary" to="/inbound"><Plus size={17} />Nhập kho mới</Link></>} />
    <section className="dashboard-overview" aria-label="Tổng quan vận hành kho">
      <article className="inventory-overview-card">
        <div className="overview-card-heading"><div><span>QUY MÔ TỒN KHO</span><h2>Tổng lượng hàng</h2></div><div className="overview-icon"><Boxes size={19} /></div></div>
        <div className="overview-stock-value">{compact.format(totalStock)}<span>đơn vị</span></div>
        <div className="overview-stock-caption">Tổng số lượng hiện có trong các kho</div>
        <div className="overview-details"><div><span><Wallet size={15} /> Giá trị theo giá nhập</span><strong>{currency.format(stockValue)}</strong></div><div><span><Package size={15} /> Mã hàng</span><strong>{compact.format(data.products.length)}</strong></div></div>
        <div className="overview-stock-status"><span><i className="stock-status-dot healthy" />{compact.format(data.products.length - lowStock.length)} mã trên ngưỡng tối thiểu</span><span><i className="stock-status-dot low" />{compact.format(lowStock.length)} cần bổ sung</span></div>
      </article>
      <div className="dashboard-supporting-metrics">{metrics.map(({ label, value, icon: Icon, tone, note }) => <article className="metric-card" key={label}><div className="metric-top"><div className={`metric-icon ${tone}`}><Icon size={18} /></div></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></article>)}</div>
    </section>
    <section className="dashboard-charts">
       <article className="panel chart-panel"><div className="panel-heading"><div><h2>Luồng hàng hóa</h2><p>Số lượng nhập và xuất theo ngày</p></div><select className="select-compact" value={range} onChange={(event) => setRange(Number(event.target.value))} aria-label="Khoảng thời gian"><option value={7}>7 ngày qua</option><option value={14}>14 ngày qua</option></select></div><div className="chart-legend"><span><i className="legend-dot inbound-dot" />Nhập kho</span><span><i className="legend-dot outbound-dot" />Xuất kho</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><defs><linearGradient id="inboundFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f46e5" stopOpacity={0.16} /><stop offset="95%" stopColor="#4f46e5" stopOpacity={0} /></linearGradient><linearGradient id="outboundFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity={0.13} /><stop offset="95%" stopColor="#0d9488" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" /><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} dy={10} /><YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }} /><Area type="monotone" dataKey="inbound" name="Nhập kho" stroke="#4f46e5" strokeWidth={2} fill="url(#inboundFill)" /><Area type="monotone" dataKey="outbound" name="Xuất kho" stroke="#0d9488" strokeWidth={2} fill="url(#outboundFill)" /></AreaChart></ResponsiveContainer></div></article>
       <article className="panel category-panel"><div className="panel-heading"><div><h2>Giá trị theo danh mục</h2><p>Cơ cấu giá trị hàng tồn</p></div></div><div className="donut-wrap">{categoryData.length ? <><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius="67%" outerRadius="92%" paddingAngle={3} stroke="none">{categoryData.map((item, index) => <Cell key={item.name} fill={colors[index % colors.length]} />)}</Pie><Tooltip formatter={(value) => currency.format(Number(value))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{currency.format(stockValue)}</strong><span>Tổng giá trị</span></div></> : <div className="empty-state">Chưa có dữ liệu tồn kho</div>}</div><div className="category-legend">{categoryData.slice(0, 4).map((item, index) => <div key={item.name}><span><i style={{ background: colors[index % colors.length] }} />{item.name}</span><strong>{stockValue ? Math.round(item.value / stockValue * 100) : 0}%</strong></div>)}</div></article>
    </section>
    <section className="dashboard-bottom">
      <article className="panel recent-panel"><div className="panel-heading"><div><h2>Hoạt động gần đây</h2><p>Các phiếu kho mới nhất</p></div><Link className="text-link" to="/transactions">Xem tất cả <ArrowRight size={14} /></Link></div><div className="table-scroll"><table className="data-table"><thead><tr><th>MÃ PHIẾU</th><th>LOẠI</th><th>ĐỐI TÁC</th><th>NGÀY TẠO</th><th>TRẠNG THÁI</th></tr></thead><tbody>{recentDocs.map((document) => <tr key={document.id}><td className="table-primary">{document.code}</td><td><span className={`doc-type ${document.type === 'Nhập kho' ? 'type-in' : 'type-out'}`}>{document.type}</span></td><td>{document.partner || '—'}</td><td>{new Date(document.createdAt).toLocaleDateString('vi-VN')}</td><td><StatusBadge tone={document.status === 'Đã xác nhận' ? 'success' : document.status === 'Bản nháp' ? 'warning' : 'neutral'}>{document.status}</StatusBadge></td></tr>)}</tbody></table></div></article>
      <article className="panel low-stock-panel"><div className="panel-heading"><div><h2>Cần bổ sung hàng</h2><p>Sản phẩm ở dưới mức tối thiểu</p></div><span className="alert-count">{lowStock.length}</span></div><div className="low-stock-list">{lowStock.slice(0, 5).map((product) => <div className="low-stock-item" key={product.id}><div className="product-avatar">{product.name.slice(0, 1)}</div><div className="low-stock-name"><strong>{product.name}</strong><small>{product.sku}</small></div><div className="stock-amount"><strong>{product.quantity}</strong><small>/ {product.minStock} {product.unit}</small></div></div>)}{lowStock.length === 0 && <div className="empty-inline"><ClipboardCheck size={19} />Tất cả sản phẩm đều đủ tồn kho</div>}</div><Link className="panel-footer-link" to="/inventory">Mở danh sách tồn kho <ArrowRight size={15} /></Link></article>
    </section>
     <div className="dashboard-footnote"><span>{warehouseApiEnabled ? 'Nguồn dữ liệu: API' : 'Nguồn dữ liệu: demo cục bộ'}</span><span><Truck size={13} /> {data.warehouses.length} kho</span></div>
  </div>
}
