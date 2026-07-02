import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'save-coordinates-plugin',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.method === 'POST' && req.url === '/api/save-coordinates') {
            let body = ''
            req.on('data', chunk => {
              body += chunk
            })
            req.on('end', () => {
              try {
                const { areaId, points } = JSON.parse(body)
                if (!areaId || !points) {
                  res.writeHead(400, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: false, error: 'Missing areaId or points' }))
                  return
                }

                const filePath = path.resolve(__dirname, 'src/components/cemetery_points.json')
                let allData = {}
                if (fs.existsSync(filePath)) {
                  allData = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
                }

                allData[areaId] = points

                fs.writeFileSync(filePath, JSON.stringify(allData, null, 2), 'utf-8')
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true }))
              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: err.message }))
              }
            })
          } else {
            next()
          }
        })
      }
    }
  ],
  server: {
    port: 5174,
    host: true,
    allowedHosts: [
      'ethernet-cohen-wav-process.trycloudflare.com',
      'deals-buying-republicans-infections.trycloudflare.com',
    ],
    watch: {
      ignored: ['**/cemetery_points.json']
    }
  },
})