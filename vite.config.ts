import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', '')
  const certificate = env.DEV_HTTPS_CERT_FILE
  const privateKey = env.DEV_HTTPS_KEY_FILE
  const apiTarget = env.VITE_DEV_API_TARGET

  if (Boolean(certificate) !== Boolean(privateKey)) {
    throw new Error('DEV_HTTPS_CERT_FILE và DEV_HTTPS_KEY_FILE phải được cấu hình cùng nhau.')
  }
  if (!apiTarget && command === 'serve') {
    throw new Error('Cấu hình VITE_DEV_API_TARGET để Vite proxy API/WebSocket tới backend có thể truy cập.')
  }

  // Nếu có cert thủ công (mkcert/LAN) thì dùng cert đó.
  // Nếu không, basicSsl() plugin tự bật HTTPS với self-signed cert —
  // người dùng chỉ cần chấp nhận cảnh báo trình duyệt 1 lần là QR hoạt động.
  const hasManualCert = Boolean(certificate && privateKey)

  return {
    plugins: [
      react(),
      // basicSsl chỉ kích hoạt khi không có cert thủ công
      ...(!hasManualCert ? [basicSsl()] : []),
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: ['.trycloudflare.com'],
      // Với cert thủ công: truyền thẳng vào https
      // Với basicSsl: plugin tự inject https, không cần khai báo ở đây
      ...(hasManualCert ? { https: { cert: readFileSync(certificate!), key: readFileSync(privateKey!) } } : {}),
      proxy: {
        '/api/v1': {
          target: apiTarget || 'http://backend:8000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
