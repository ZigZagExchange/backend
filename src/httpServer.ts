// SPDX-License-Identifier: BUSL-1.1
import express from 'express'
import { createServer } from 'http'
import type { WebSocket, WebSocketServer } from 'ws'
import type { ZZHttpServer } from 'src/types'

export const createHttpServer = (socketServer: WebSocketServer): ZZHttpServer => {
  const expressApp = express() as ZZHttpServer
  const server = createServer(expressApp)

  const httpMessages = [
    'requestquote',
    'submitorder',
    'submitorder2',
    'orderreceiptreq',
    'dailyvolumereq',
    'refreshliquidity',
    'marketsreq',
  ]

  expressApp.use(express.json())

  expressApp.post('/', async (req, res) => {
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

    const responseMessage = await expressApp.api?.serviceHandler(req.body)

    res.header('Content-Type', 'application/json')
    res.json(responseMessage)
  })

  server.on('upgrade', (request, socket, head) => {
    socketServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      socketServer.emit('connection', ws, request)
    })
  })
  
  return expressApp
}