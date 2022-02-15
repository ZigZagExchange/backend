// SPDX-License-Identifier: BUSL-1.1
import { WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'
import { randomUUID } from 'crypto'
import type { WSocket, WSMessage, ZZSocketServer } from 'src/types'

export const createSocketServer = (): WebSocketServer => {
  const wss = new WebSocketServer({ noServer: true }) as ZZSocketServer
  
  async function onWsConnection(ws: WSocket, req: IncomingMessage) {
    Object.assign(ws, {
      uuid: randomUUID(),
      isAlive: true,
      marketSubscriptions: [],
      chainid: 1,
      userid: null,
    })
  
    console.log('New connection: ', req.connection.remoteAddress)
  
    ws.on('pong', () => {
      ws.isAlive = true
    })
  
    ws.on('message', (json: string): any => {
      let msg: WSMessage
      try {
        msg = (JSON.parse(json) as WSMessage)
        if (typeof msg.op === 'string' && Array.isArray(msg.args)) {
          if (msg.op !== 'indicateliq2') console.log('WS: %s', json)
          if (wss.api) return wss.api.serviceHandler(msg, ws)    
        }
      } catch (err) {
        console.log(err)
      }

      return null
    })
  
    ws.on('error', console.error)
  
    const lastprices = await wss.api?.getLastPrices(1)
    ws.send(JSON.stringify({ op: 'lastprice', args: [lastprices] }))
  }
  
  wss.on('connection', onWsConnection)
  wss.on('error', console.error)

  return wss
}