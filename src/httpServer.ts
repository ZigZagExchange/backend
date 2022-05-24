// SPDX-License-Identifier: BUSL-1.1
import express from 'express'
import { createServer } from 'http'
import type { WebSocket, WebSocketServer } from 'ws'
import type { ZZHttpServer } from 'src/types'
import cmcRoutes from 'src/routes/cmc'
import cgRoutes from 'src/routes/cg'
import zzRoutes from 'src/routes/zz'

export const createHttpServer = (
  socketServer: WebSocketServer
): ZZHttpServer => {
  const expressApp = express() as any as ZZHttpServer
  const server = createServer(expressApp)

  const httpMessages = [
    'requestquote',
    'submitorder',
    'submitorder2',
    'submitorder3',
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

    const outputString = JSON.stringify(req.body)
    if (!outputString.includes("/api/v1/marketinfos")) {
      console.log(`REST: ${outputString}`)
    }
    

    if (!httpMessages.includes(req.body.op)) {
      res.json({ op: 'error', args: [req.body.op, 'Not supported in HTTP'] })
      return
    }

    const timeOutLog = setTimeout(() => {
      console.log(`10 sec Timeout processing: ${req.body.toString()}`)
    }, 10000)
    let responseMessage
    try {
      responseMessage = await expressApp.api.serviceHandler(req.body)
    } catch (e: any) {
      console.error(`Unexpected error while processing HTTP request: ${e.message}`)
      res.status(400).json(`Unexpected error while processing your request: ${e.message}`)
    }
    clearTimeout(timeOutLog)
    

    res.header('Content-Type', 'application/json')
    res.status(200).json(responseMessage)
  })

  server.on('upgrade', (request, socket, head) => {
    socketServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      socketServer.emit('connection', ws, request)
    })
  })

  cmcRoutes(expressApp)
  cgRoutes(expressApp)
  zzRoutes(expressApp)

  expressApp.listen = (...args: any) => server.listen(...args)

  return expressApp
}
