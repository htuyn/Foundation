/**
 * dev-mobile.mjs
 *
 * Chạy Cloudflare Quick Tunnel → ghi URL vào .env.local → khởi động Vite.
 * Vite đọc .env.local SAU .env nên override được VITE_SCANNER_MOBILE_BASE_URL=rỗng.
 * .env.local bị xóa khi thoát (không commit vào git).
 *
 * Sử dụng: npm run dev:mobile
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VITE_PORT = 5173
const ENV_LOCAL = resolve(ROOT, '.env.local')

// --- Helpers ---

function readEnvVar(name) {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return undefined
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const eqIdx = trimmed.indexOf('=')
    if (trimmed.slice(0, eqIdx).trim() === name) return trimmed.slice(eqIdx + 1).trim()
  }
  return undefined
}

function findCloudflared() {
  const fromEnv = readEnvVar('CLOUDFLARED_BIN')
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const defaults = [
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
  ]
  for (const p of defaults) if (existsSync(p)) return p
  return 'cloudflared'
}

function log(msg) {
  const time = new Date().toLocaleTimeString('vi-VN')
  console.log(`[${time}] [dev:mobile] ${msg}`)
}

function cleanupEnvLocal() {
  try { if (existsSync(ENV_LOCAL)) unlinkSync(ENV_LOCAL) } catch {}
}

// --- Tunnel ---

function startTunnel(bin) {
  return new Promise((ok, fail) => {
    const proc = spawn(bin, ['tunnel', '--url', `http://localhost:${VITE_PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let resolved = false

    function tryExtract(text) {
      if (resolved) return
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/)
      if (match) { resolved = true; ok(match[0]) }
    }

    proc.stdout.on('data', (c) => { const t = c.toString(); process.stdout.write(`[cloudflared] ${t}`); tryExtract(t) })
    proc.stderr.on('data', (c) => {
      const t = c.toString()
      tryExtract(t)
      if (t.includes('trycloudflare.com') || t.includes('ERR') || t.includes('failed'))
        process.stderr.write(`[cloudflared] ${t}`)
    })
    proc.on('close', (code) => { if (!resolved) fail(new Error(`cloudflared thoát code ${code}`)) })
    proc.on('error', (err) => { if (!resolved) fail(new Error(`Không thể khởi động cloudflared: ${err.message}\nCài tại: https://developers.cloudflare.com/cloudflared/`)) })

    process.on('exit', () => { try { proc.kill() } catch {} })

    setTimeout(() => { if (!resolved) fail(new Error('Timeout 30s: cloudflared chưa trả tunnel URL')) }, 30_000)
  })
}

// --- Vite ---

function startVite() {
  const vite = spawn('node', ['node_modules/vite/bin/vite.js'], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  })

  vite.on('close', (code) => {
    cleanupEnvLocal()
    log(`Vite đã dừng (code ${code})`)
    process.exit(code ?? 0)
  })

  vite.on('error', (err) => {
    cleanupEnvLocal()
    console.error(`[dev:mobile] Không thể khởi động Vite: ${err.message}`)
    process.exit(1)
  })

  process.on('SIGINT', () => { cleanupEnvLocal(); try { vite.kill() } catch {} process.exit(0) })
  process.on('SIGTERM', () => { cleanupEnvLocal(); try { vite.kill() } catch {} process.exit(0) })
}

// --- Main ---

async function main() {
  // Trong Docker: RUNNING_IN_DOCKER=true → chạy Vite thuần, không cần tunnel
  if (process.env.RUNNING_IN_DOCKER === 'true') {
    log('Đang chạy trong Docker — bỏ qua tunnel, khởi động Vite...')
    startVite()
    return
  }

  const bin = findCloudflared()
  log(`cloudflared: ${bin}`)
  log('Đang tạo Cloudflare tunnel... (mất ~5 giây)')

  const tunnelUrl = await startTunnel(bin)
  log(`Tunnel URL: ${tunnelUrl}`)

  // Ghi vào .env.local — Vite đọc file này SAU .env, nên override VITE_SCANNER_MOBILE_BASE_URL=rỗng
  writeFileSync(ENV_LOCAL, `VITE_SCANNER_MOBILE_BASE_URL=${tunnelUrl}\n`, 'utf8')
  log(`.env.local đã ghi: VITE_SCANNER_MOBILE_BASE_URL=${tunnelUrl}`)
  log('Khởi động Vite...')
  log('─────────────────────────────────────────')
  log(`Mở trình duyệt: http://localhost:${VITE_PORT}`)
  log(`Điện thoại kết nối qua: ${tunnelUrl}`)
  log('─────────────────────────────────────────')

  startVite()
}

main().catch((err) => {
  console.error(`[dev:mobile] Lỗi: ${err.message}`)
  cleanupEnvLocal()
  process.exit(1)
})
