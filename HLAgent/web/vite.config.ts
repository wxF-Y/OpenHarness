import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const rawPort = env.VITE_GATEWAY_PORT
  const gatewayPort = rawPort && /^\d+$/.test(rawPort) ? rawPort : '7779'
  const gatewayBase = `http://localhost:${gatewayPort}`
  const gatewayWs = `ws://localhost:${gatewayPort}`

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': gatewayBase,
        '/ws': { target: gatewayWs, ws: true },
        '/health': gatewayBase,
      },
    },
  }
})
