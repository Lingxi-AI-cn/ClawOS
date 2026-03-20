import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'

function systemApiPlugin(): Plugin {
  return {
    name: 'clawos-system-api',
    configureServer(server) {
      server.middlewares.use('/api/system-info', (_req, res) => {
        try {
          const cpus = os.cpus()
          const totalMem = os.totalmem()
          const freeMem = os.freemem()
          const loadavg = os.loadavg()
          const cpuUsage = Math.min(100, (loadavg[0] / cpus.length) * 100)

          let kernel = os.release()
          try { kernel = execSync('uname -r', { encoding: 'utf-8' }).trim() } catch {}

          let platform = os.type()
          try {
            const pretty = execSync('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME', { encoding: 'utf-8' })
            const match = pretty.match(/PRETTY_NAME="?([^"\n]+)"?/)
            if (match) platform = match[1]
          } catch {}

          let ip = '127.0.0.1'
          const interfaces = os.networkInterfaces()
          for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
              if (iface.family === 'IPv4' && !iface.internal) {
                ip = iface.address
                break
              }
            }
            if (ip !== '127.0.0.1') break
          }

          // Read network bytes from /proc/net/dev
          let netRxBytes = 0
          let netTxBytes = 0
          try {
            const procNet = fs.readFileSync('/proc/net/dev', 'utf-8')
            for (const line of procNet.split('\n')) {
              const trimmed = line.trim()
              // Skip loopback and header lines
              if (trimmed.startsWith('lo:') || !trimmed.includes(':')) continue
              const parts = trimmed.split(/\s+/)
              if (parts.length >= 10) {
                netRxBytes += parseInt(parts[1], 10) || 0
                netTxBytes += parseInt(parts[9], 10) || 0
              }
            }
          } catch { /* /proc/net/dev not available (non-Linux) */ }

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            hostname: os.hostname(),
            platform,
            kernel,
            arch: os.arch(),
            cpuUsage: Math.round(cpuUsage * 10) / 10,
            cpuModel: cpus[0]?.model || 'Unknown',
            cpuCores: cpus.length,
            memTotal: totalMem,
            memUsed: totalMem - freeMem,
            uptime: os.uptime(),
            ip,
            netRxBytes,
            netTxBytes,
          }))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      server.middlewares.use('/api/files', (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const dirPath = url.searchParams.get('path') || os.homedir()
          const resolved = path.resolve(dirPath)

          // Security: only allow paths under home directory
          const home = os.homedir()
          if (!resolved.startsWith(home) && !resolved.startsWith('/tmp')) {
            res.statusCode = 403
            res.end(JSON.stringify({ error: 'Access denied' }))
            return
          }

          const names = fs.readdirSync(resolved)
          const entries: Array<{
            name: string
            type: string
            size: number
            mtime: number
            permissions: string
          }> = []

          for (const name of names) {
            if (name.startsWith('.')) continue
            try {
              const fullPath = path.join(resolved, name)
              const stat = fs.lstatSync(fullPath)
              let type = 'other'
              if (stat.isDirectory()) type = 'directory'
              else if (stat.isFile()) type = 'file'
              else if (stat.isSymbolicLink()) type = 'symlink'

              const mode = stat.mode
              const perms =
                ((mode & 0o400) ? 'r' : '-') + ((mode & 0o200) ? 'w' : '-') +
                ((mode & 0o100) ? 'x' : '-') + ((mode & 0o040) ? 'r' : '-') +
                ((mode & 0o020) ? 'w' : '-') + ((mode & 0o010) ? 'x' : '-') +
                ((mode & 0o004) ? 'r' : '-') + ((mode & 0o002) ? 'w' : '-') +
                ((mode & 0o001) ? 'x' : '-')

              entries.push({ name, type, size: stat.size, mtime: stat.mtimeMs, permissions: perms })
            } catch { /* skip */ }
          }

          entries.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1
            if (a.type !== 'directory' && b.type === 'directory') return 1
            return a.name.localeCompare(b.name)
          })

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ path: resolved, entries }))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), systemApiPlugin()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/gateway-ws': {
        target: 'ws://127.0.0.1:18789',
        ws: true,
        rewriteWsOrigin: true,
        rewrite: () => '/',
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  assetsInclude: ['**/*.glsl', '**/*.vert', '**/*.frag'],
})
