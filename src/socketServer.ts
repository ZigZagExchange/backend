// SPDX-License-Identifier: BUSL-1.1
import mws from 'ws'
import type { IncomingMessage } from 'http'
import { randomUUID } from 'crypto'
import type { WSocket, WSMessage, ZZSocketServer } from 'src/types'

export const createSocketServer = (): ZZSocketServer => {
  const wss = new mws.Server({ noServer: true }) as ZZSocketServer

  async function onWsConnection(ws: WSocket, req: IncomingMessage) {
    Object.assign(ws, {
      uuid: randomUUID(),
      isAlive: true,
      marketSubscriptions: [],
      chainid: 1,
      userid: null,
      origin: req?.headers?.origin,
    })

    console.log('New connection', req.socket.remoteAddress)

    ws.on('pong', () => {
      ws.isAlive = true
    })

    ws.on('message', (json: string): any => {
      let msg: WSMessage
      try {
        msg = JSON.parse(json) as WSMessage
        if (typeof msg.op === 'string' && Array.isArray(msg.args)) {
          if (
            ![
              'indicateliq2',
              'submitorder2',
              'submitorder3',
              'ping',
              'fillrequest',
            ].includes(msg.op)
          ) {
            console.log(`WS[${ws.origin}]: %s`, json)
          } else if (
            ['submitorder2', 'submitorder3', 'fillrequest'].includes(msg.op)
          ) {
            console.log(
              `WS[${ws.origin}]: {"op":${msg.op},"args":[${msg.args[0]},${msg.args[1]}, "ZZMessage"]}`
            )
          }

          const debugLog = setTimeout(
            () => console.log(`Failed to process ${msg.op}, arg: ${msg.args}`),
            5000
          )
          if (wss.api) {
            const res = wss.api.serviceHandler(msg, ws)
            clearTimeout(debugLog)
            return res
          }
        }
      } catch (err) {
        console.log(err)
      }

      return null
    })

    ws.on('error', console.error)
  }

  wss.on('connection', onWsConnection)
  wss.on('error', console.error)

  return wss
}
