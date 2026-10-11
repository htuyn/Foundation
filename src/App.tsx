import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ToastHost } from './components/common'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const ProductsPage = lazy(() => import('./pages/ProductsPage').then((module) => ({ default: module.ProductsPage })))
const DocumentsPage = lazy(() => import('./pages/DocumentsPage').then((module) => ({ default: module.DocumentsPage })))
const InventoryPage = lazy(() => import('./pages/InventoryPage').then((module) => ({ default: module.InventoryPage })))
const TransactionsPage = lazy(() => import('./pages/TransactionsPage').then((module) => ({ default: module.TransactionsPage })))
const CategoriesPage = lazy(() => import('./pages/ManagementPages').then((module) => ({ default: module.CategoriesPage })))
const WarehousesPage = lazy(() => import('./pages/ManagementPages').then((module) => ({ default: module.WarehousesPage })))
const SuppliersPage = lazy(() => import('./pages/ManagementPages').then((module) => ({ default: module.SuppliersPage })))
const UsersPage = lazy(() => import('./pages/ManagementPages').then((module) => ({ default: module.UsersPage })))
const ReportsPage = lazy(() => import('./pages/UtilityPages').then((module) => ({ default: module.ReportsPage })))
const BarcodePage = lazy(() => import('./pages/UtilityPages').then((module) => ({ default: module.BarcodePage })))
const SettingsPage = lazy(() => import('./pages/UtilityPages').then((module) => ({ default: module.SettingsPage })))
const AuditLogsPage = lazy(() => import('./pages/UtilityPages').then((module) => ({ default: module.AuditLogsPage })))
const ScannerMobilePage = lazy(() => import('./features/scanner/ScannerMobilePage').then((module) => ({ default: module.ScannerMobilePage })))

function NotFound() {
  return <div className="not-found"><div>404</div><h1>Không tìm thấy trang</h1><p>Đường dẫn này không tồn tại trong hệ thống.</p><a href="/dashboard" className="button button-primary">Về tổng quan</a></div>
}

export function App() {
  return <><Suspense fallback={<div className="route-loading"><span />Đang tải trang...</div>}><Routes><Route path="/scanner/mobile" element={<ScannerMobilePage />} /><Route element={<Layout />}><Route index element={<Navigate to="/dashboard" replace />} /><Route path="dashboard" element={<DashboardPage />} /><Route path="products" element={<ProductsPage />} /><Route path="categories" element={<CategoriesPage />} /><Route path="warehouses" element={<WarehousesPage />} /><Route path="inbound" element={<DocumentsPage type="Nhập kho" />} /><Route path="outbound" element={<DocumentsPage type="Xuất kho" />} /><Route path="inventory" element={<InventoryPage />} /><Route path="suppliers" element={<SuppliersPage />} /><Route path="transactions" element={<TransactionsPage />} /><Route path="users" element={<UsersPage />} /><Route path="reports" element={<ReportsPage />} /><Route path="barcode" element={<BarcodePage />} /><Route path="settings" element={<SettingsPage />} /><Route path="audit-logs" element={<AuditLogsPage />} /><Route path="*" element={<NotFound />} /></Route></Routes></Suspense><ToastHost /></>
}
