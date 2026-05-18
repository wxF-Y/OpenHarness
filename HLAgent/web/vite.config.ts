import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:7779',
      '/ws': { target: 'ws://localhost:7779', ws: true },
      '/health': 'http://localhost:7779',
    },
  },
})
