import API from 'src/api'
import type { ZZHttpServer } from 'src/types'

export default function cmcRoutes(app: ZZHttpServer) {

  const defaultChainId = process.env.DEFAULT_CHAIN_ID
      ? Number(process.env.DEFAULT_CHAIN_ID)
      : 1

  app.get('/api/v1/markets', async (req, res) => {
    let market
    if (req.query.market) {
      market = (req.query.market as string)
        .replace('_','-')
        .replace('/','-')
        .toUpperCase()
    } else {
      market = ""
    }

    try {
      const marketSummarys: any =  await app.api.getMarketSummarys(
        defaultChainId,
        market
      )
      if(!marketSummarys) {
        if(market === "") {
          res.send({ op: 'error', message: `Can't find any markets.` })
        } else {
          res.send({ op: 'error', message: `Can't find a summary for ${market}.` })
        }        
        return
      }
      res.json(marketSummarys)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: 'Failed to fetch markets' })
    }
  })

  app.get('/api/v1/ticker', async (req, res) => {
    let market
    if (req.query.market) {
      market = (req.query.market as string)
        .replace('_','-')
        .replace('/','-')
        .toUpperCase()
    } else {
      market = ""
    }

    try {
      const ticker: any = {}
      const lastPrices: any =  await app.api.getLastPrices(defaultChainId)
      if(lastPrices.length === 0) {
        if(market === "") {
          res.send({ op: 'error', message: `Can't find any lastPrices for any markets.` })
        } else {
          res.send({ op: 'error', message: `Can't find a lastPrice for ${market}.` })
        }        
        return
      }
      lastPrices.forEach((price: string[]) => {
        const entry: any = {
          "lastPrice": price[1],
          "priceChange": price[2],
          "baseVolume": price[4],
          "quoteVolume": price[3],
        }
        ticker[price[0]] = entry
      })
      res.json(ticker)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: 'Failed to fetch ticker prices' })
    }
  })

  app.get('/api/v1/orderbook/:market_pair', async (req, res) => {
    const market = (req.params.market_pair)
      .replace('_','-')
      .replace('/','-')
      .toUpperCase()
    let depth: number = (req.query.depth) ? Number(req.query.depth) : 0
    const level: number = (req.query.level) ? Number(req.query.level) : 2
    if(![1,2,3].includes(level)) {
      res.send({ op: 'error', message: `Level: ${level} is not a valid level. Use 1, 2 or 3.` })
      return
    }
      
    try {
      // get data
      const liquidity = await app.api.getLiquidityPerSide(
        defaultChainId,
        market,
        depth,
        level
      )
      res.json(liquidity)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: `Failed to fetch orderbook for ${market}, ${error.message}` })
    }
  })

  app.get('/api/v1/trades/:market_pair', async (req, res) => {
    const market = (req.params.market_pair)
      .replace('_','-')
      .replace('/','-')
      .toUpperCase()
    const type: string = req.query.type as string
    const limit = (req.query.limit) ? Number(req.query.limit) : 0
    const orderId = (req.query.order_id) ? Number(req.query.order_id) : 0
    const startTime = (req.query.start_time) ? Number(req.query.start_time) : 0
    const endTime = (req.query.end_time) ? Number(req.query.end_time) : 0

    if(type && !['s', 'b', 'sell', 'buy'].includes(type)) {
      res.send({ op: 'error', message: `Type: ${type} is not a valid type. Use 's', 'b', 'sell', 'buy'` })
      return
    }

    try {
      const fills = await app.api.getfills(
        defaultChainId,
        market,
        limit,
        orderId,
        type,
        startTime,
        endTime
      )

      if(fills.length === 0) {
        res.send({ op: 'error', message: `Can not find fills for ${market}` })
        return
      }

      const response: any[] = []
      fills.forEach(fill => {
        const date = new Date(fill[12])
        const entry: any = {
          "chainId": fill[0],
          "orderId": fill[1],
          "market": fill[2],
          "price": fill[4],
          "baseVolume": fill[5],
          "quoteVolume": (fill[5] * fill[4]),
          "timestamp": date.getTime(),
          "side": (fill[3] === 's') ? 'sell' : 'buy',
          "txHash": fill[7],
          "feeAmount": fill[10],
          "feeToken": fill[11]
        }
        response.push(entry)
      })

      res.send(response)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: `Failed to fetch trades for ${market}` })
    }
  })
}
