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

  // Nếu không có cert thủ công, dùng basic-ssl để tự tạo HTTPS (self-signed)
  // → người dùng mở https://IP-LAN:5173, chấp nhận cảnh báo cert 1 lần,
  //   sau đó QR điện thoại hoạt động ngay mà không cần cấu hình thêm.
  const httpsConfig = certificate && privateKey
    ? { cert: readFileSync(certificate), key: readFileSync(privateKey) }
    : true  // basic-ssl tự quản lý

  return {
    plugins: [
      react(),
      basicSsl(),
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      https: httpsConfig,
      allowedHosts: ['.trycloudflare.com'],
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
