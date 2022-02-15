import WebSocket, { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'

const wss = new WebSocketServer({ noServer: true })

async function onWsConnection(wss: WebSocket, req: IncomingRequest) {
  wss.uuid = randomUUID()
  console.log('New connection: ', req.connection.remoteAddress)
  wss.isAlive = true
  wss.marketSubscriptions = []
  wss.chainid = 1 // subscribe to zksync mainnet by default
  wss.userid = null

  wss.on('pong', () => {
    wss.isAlive = true
  })
  wss.on('message', (json: string) => {
    const msg = JSON.parse(json)
    
    if (msg.op !== 'indicateliq2') {
      console.log('WS: %s', json)
    }
    handleMessage(msg, ws)
  })
  wss.on('error', console.error)
  const lastprices = await getLastPrices(1)
  wss.send(JSON.stringify({ op: 'lastprice', args: [lastprices] }))
}

wss.on('connection', () => {})
wss.on('error', console.error)
