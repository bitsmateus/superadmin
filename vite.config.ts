import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const PROXY_SERVERS = [
  { id: 'chat', target: 'https://chatapi.nxsystems.com.br' },
  { id: 'app', target: 'https://appapi.nxsystems.com.br' },
  { id: 'web', target: 'https://webapi.nxsystems.com.br' },
  { id: 'asaas', target: 'https://api.asaas.com' },
  { id: 'asaas-sandbox', target: 'https://sandbox.asaas.com/api' },
]

export default defineConfig(() => {
  const proxy: Record<
    string,
    {
      target: string
      changeOrigin: boolean
      secure: boolean
      rewrite: (p: string) => string
    }
  > = Object.fromEntries(
    PROXY_SERVERS.map((s) => [
      `/_proxy/${s.id}`,
      {
        target: s.target,
        changeOrigin: true,
        secure: true,
        rewrite: (p: string) => p.replace(`/_proxy/${s.id}`, ''),
      },
    ]),
  )

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      host: true,
      proxy,
    },
  }
})
