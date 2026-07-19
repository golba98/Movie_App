import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const topHtml = readFileSync(new URL('./top.html', import.meta.url))
const playerHtml = readFileSync(new URL('./player.html', import.meta.url))
const mediaPath = fileURLToPath(new URL('../../../public/test-media/capture-test.mp4', import.meta.url))

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(html)
}

function sendMedia(request, response) {
  const size = statSync(mediaPath).size
  const range = request.headers.range
  if (!range) {
    response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes' })
    createReadStream(mediaPath).pipe(response)
    return
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range)
  if (!match) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` })
    response.end()
    return
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  response.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
  })
  createReadStream(mediaPath, { start, end }).pipe(response)
}

const topServer = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1:4300').pathname
  if (path === '/test-media/capture-test.mp4') return sendMedia(request, response)
  sendHtml(response, topHtml)
})

const playerServer = createServer((_request, response) => sendHtml(response, playerHtml))

topServer.listen(4300, '127.0.0.1', () => console.log('Watch Sync top fixture: http://127.0.0.1:4300'))
playerServer.listen(4301, '127.0.0.1', () => console.log('Watch Sync player fixture: http://127.0.0.1:4301'))

const close = () => {
  topServer.close()
  playerServer.close()
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
