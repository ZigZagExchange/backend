import express from 'express'
import { createServer } from 'http'

const expressApp = express()
const server = createServer(expressApp)
const port = process.env.PORT || 3004

expressApp.use(express.json())

expressApp.post('/', async (req, res) => {
  const httpMessages = [
    'requestquote',
    'submitorder',
    'submitorder2',
    'orderreceiptreq',
    'dailyvolumereq',
    'refreshliquidity',
    'marketsreq',
  ]

  if (req.headers['content-type'] !== 'application/json') {
    res.json({
      op: 'error',
      args: ['Content-Type header must be set to application/json'],
    })
    return
  }

  console.log('REST: %s', JSON.stringify(req.body))
  
  if (!httpMessages.includes(req.body.op)) {
    res.json({ op: 'error', args: [req.body.op, 'Not supported in HTTP'] })
    return
  }

  const responseMessage = await handleMessage(req.body, null)

  res.header('Content-Type', 'application/json')
  res.json(responseMessage)
})

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, function done(ws) {
    wss.emit('connection', ws, request)
  })
})

server.listen(port)
