import API from 'src/api'
import type { ZZHttpServer } from 'src/types'

export default function cmcRoutes(app: ZZHttpServer) {

  const defaultChainId = process.env.DEFAULT_CHAIN_ID
      ? Number(process.env.DEFAULT_CHAIN_ID)
      : 1

  app.get('/v1/markets', async (req, res) => {
    try {
      const markets: any = {}
      const marketSummarys: any =  await app.api.getMarketSummarys(defaultChainId)
      
      Object.keys(marketSummarys).forEach((market: string) => {
        const entry: any = {
          "trading_pairs": marketSummarys.market.market,
          "base_currency": marketSummarys.market.baseSymbol,
          "quote_currency": marketSummarys.market.quoteSymbol,
          "last_price": marketSummarys.market.lastPrice,
          "lowest_ask": marketSummarys.market.lowestAsk,
          "highest_bid": marketSummarys.market.highestBid,
          "base_volume": marketSummarys.market.baseVolume,
          "quote_volume": marketSummarys.market.quoteVolume,
          "price_change_percent_24h": marketSummarys.market.priceChangePercent_24h,
          "highest_price_24h": marketSummarys.market.highestPrice_24h,
          "lowest_price_24h": marketSummarys.market.lowestPrice_24h
        }
        markets[market] = entry
      })
      res.json(markets)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: 'Failed to fetch markets' })
    }
  })

  app.get('/v1/ticker', async (req, res) => {
    try {
      const ticker: any = {}
      const lastPrices: any =  await app.api.getLastPrices(defaultChainId)
      lastPrices.forEach((price: string[]) => {
        const entry: any = {
          "last_price": price[1],
          "base_volume": price[4],
          "quote_volume": price[3],          
          "isFrozen": 0
        }
        ticker[price[0]] = entry
      })
      res.json(ticker)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: 'Failed to fetch ticker prices' })
    }
  })

  app.get('/v1/orderbook/:market_pair', async (req, res) => {
    const market = (req.params.market_pair).replace('_','-')    
    let depth: number = (req.query.depth) ? Number(req.query.depth) : 0
    const level: number = (req.query.level) ? Number(req.query.level) : 2
    try {
      // get data
      const timestamp = Date.now()
      const liquidity = await app.api.getLiquidity(
        defaultChainId,
        market
      )

      // sort for bids and asks
      let bids: number [][] = liquidity
        .filter((l) => l[0] === 'b')
        .map((l) => [
          Number(l[1]),
          Number(l[2])
        ])
        .reverse()
      let asks: number [][] = liquidity
        .filter((l) => l[0] === 's')
        .map((l) => [
          Number(l[1]),
          Number(l[2])
        ])

      // if depth is set, only used every n entrys
      if(depth > 1) {
        depth = Math.floor(depth * 0.5)
        bids = bids.filter((entry, i) => {
          return (i % depth === 0)
        })
        asks = asks.filter((entry, i) => {
          return (i % depth === 0)
        })
      }
        
      if (level == 1) {
        // CMC => 'Level 1 – Only the best bid and ask.'
        res.json({
          "timestamp": timestamp,
          "bids": bids[0],
          "asks": asks[0]
        })
      } else if (level == 2) {
        // CMC => 'Level 2 – Arranged by best bids and asks.'
        const marketInfo = await app.api.getMarketInfo(
          market,
          defaultChainId
        )
        // get mid price
        const redis_key_prices = `lastprices:${defaultChainId}`
        const midPrice = Number(
          await app.api.redis.HGET(
            redis_key_prices,
            market
          )
        )
        const returnBids: number [][] = []
        const returnAsks: number [][] = []
        const step = midPrice * 0.0005

        // group bids by steps
        let stepBidValues: any = {}
        bids.map(b => {
          const stepCount = Math.ceil(Math.abs(b[0] - midPrice) % step)
          const stepValue = (midPrice - (stepCount * step))
          if(stepBidValues[stepValue]) {
            stepBidValues[stepValue] = stepBidValues[stepValue] + b[1]
          } else {
            stepBidValues[stepValue] = b[1]
          }
        })
        // create new bids array
        const bidSteps = Object.keys(stepBidValues)
        bidSteps.forEach(bid => {
          returnBids.push(
            [
              (+bid).toFixed(marketInfo.pricePrecisionDecimal),,
              stepBidValues[bid]
            ]
          )
        })

        // group asks by steps
        let stepAskValues: any = {}
        asks.map(a => {
          const stepCount = Math.ceil(Math.abs(a[0] - midPrice) % step)
          const stepValue = (midPrice + (stepCount * step))
          if(stepAskValues[stepValue]) {
            stepAskValues[stepValue] = stepAskValues[stepValue] + a[1]
          } else {
            stepAskValues[stepValue] = a[1]
          }
        })
        // create new asks array
        const askSteps = Object.keys(stepAskValues)
        askSteps.forEach(ask => {
          returnAsks.push(
            [
              (+ask).toFixed(marketInfo.pricePrecisionDecimal),
              stepAskValues[ask]
            ]
          )
        })

        res.json({
          "timestamp": timestamp,
          "bids": returnBids,
          "asks": returnAsks
        })
      } else if (level == 3) {
        // CMC => 'Level 3 – Complete order book, no aggregation.'
        res.json({
          "timestamp": timestamp,
          "bids": bids,
          "asks": asks
        })
      } else {
        res.send({ op: 'error', message: `'level': ${level} is not supported for orderbook. Use 1, 2 or 3` })
      }
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: `Failed to fetch orderbook for ${market}` })
    }
  })

  app.get('/v1/trades/:market_pair', async (req, res) => {
    const market = (req.params.market_pair).replace('_','-') 
    try {
      const fills = await app.api.getfills(
        defaultChainId,
        market
      )

      const response: any[] = []
      fills.forEach(fill => {
        const date = new Date(fill[12])
        const entry: any = {
          "trade_id": fill[1],
          "price": fill[4],
          "base_volume": fill[5],
          "quote_volume": (fill[5] * fill[4]),
          "timestamp": date.getTime(),
          "type": (fill[3] === 's') ? 'sell' : 'buy',
          "txHash": fill[7]
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
