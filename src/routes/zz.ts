import type {
  ZZHttpServer,
  ZZMarket,
  ZZMarketInfo,
  ZZMarketSummary,
} from 'src/types'

export default function zzRoutes(app: ZZHttpServer) {

  const defaultChainId = process.env.DEFAULT_CHAIN_ID
    ? Number(process.env.DEFAULT_CHAIN_ID)
    : 1

  app.use('/', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    )
    res.header('Access-Control-Allow-Methods', 'GET')
    next()
  })

  app.get('/api/v1/time', async (req, res) => {
    res.send({ serverTimestamp: +new Date() })
  })

  app.get('/api/v1/:chainid/markets', async (req, res) => {
    const chainId = req.params.chainid
      ? Number(req.params.chainid)
      : defaultChainId

    if (!app.api.VALID_CHAINS.includes(chainId)) {
      res
        .status(400)
        .send({
          op: 'error',
          message: `ChainId ${req.params.chainid} not found, use ${app.api.VALID_CHAINS}`,
        })
      return
    }

    const markets: string[] = []
    const altMarkets: string[] = []
    const UTCFlag = req.query.utc === 'true'

    if (req.query.market) {
      markets.push(
        (req.query.market as string).replace('_', '-').replace('/', '-')
      )
      altMarkets.push(
        (req.query.market as string)
          .replace('_', '-')
          .replace('/', '-')
          .toUpperCase()
      )
    }

    try {
      let marketSummarys: ZZMarketSummary = await app.api.getMarketSummarys(
        chainId,
        markets,
        UTCFlag
      )
      if (!marketSummarys && altMarkets) {
        marketSummarys = await app.api.getMarketSummarys(
          chainId,
          altMarkets,
          UTCFlag
        )
      }
      if (!marketSummarys) {
        if (markets.length === 0) {
          res.send({ op: 'error', message: `Can't find any markets.` })
        } else {
          res.send({
            op: 'error',
            message: `Can't find a summary for ${markets}.`,
          })
        }
        return
      }
      res.json(marketSummarys)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: 'Failed to fetch markets' })
    }
  })

  app.get('/api/v1/:chainid/ticker', async (req, res) => {
    const chainId = req.params.chainid
      ? Number(req.params.chainid)
      : defaultChainId

    if (!app.api.VALID_CHAINS.includes(chainId)) {
      res
        .status(400)
        .send({
          op: 'error',
          message: `ChainId ${req.params.chainid} not found, use ${app.api.VALID_CHAINS}`,
        })
      return
    }

    const markets: ZZMarket[] = []
    if (req.query.market) {
      const market = (req.query.market as string)
        .replace('_', '-')
        .replace('/', '-')
      markets.push(market)
      markets.push(market.toUpperCase())
    }

    try {
      const ticker: any = {}
      const lastPrices: any = await app.api.getLastPrices(chainId, markets)
      if (lastPrices.length === 0) {
        if (markets.length === 0) {
          res.send({
            op: 'error',
            message: `Can't find any lastPrices for any markets.`,
          })
        } else {
          res.send({
            op: 'error',
            message: `Can't find a lastPrice for ${req.query.market}.`,
          })
        }
        return
      }
      lastPrices.forEach((price: string[]) => {
        const entry: any = {
          lastPrice: price[1],
          priceChange: price[2],
          baseVolume: price[4],
          quoteVolume: price[3],
        }
        ticker[price[0]] = entry
      })
      res.json(ticker)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: 'Failed to fetch ticker prices' })
    }
  })

  app.get('/api/v1/:chainid/orderbook/:market_pair', async (req, res) => {
    const chainId = req.params.chainid
      ? Number(req.params.chainid)
      : defaultChainId

    if (!app.api.VALID_CHAINS.includes(chainId)) {
      res
        .status(400)
        .send({
          op: 'error',
          message: `ChainId ${req.params.chainid} not found, use ${app.api.VALID_CHAINS}`,
        })
      return
    }

    const market = req.params.market_pair
      .replace('_', '-')
      .replace('/', '-')
      .replace(':', '-')
    const altMarket = req.params.market_pair
      .replace('_', '-')
      .replace('/', '-')
      .replace(':', '-')
      .toUpperCase()
    const depth = req.query.depth ? Number(req.query.depth) : 0
    const level: number = req.query.level ? Number(req.query.level) : 2
    if (![1, 2, 3].includes(level)) {
      res.send({
        op: 'error',
        message: `Level: ${level} is not a valid level. Use 1, 2 or 3.`,
      })
      return
    }

    try {
      // get data
      let orderBook = await app.api.getOrderBook(chainId, market, depth, level)
      if (orderBook.asks.length === 0 && orderBook.bids.length === 0) {
        orderBook = await app.api.getOrderBook(chainId, altMarket, depth, level)
      }
      res.json(orderBook)
    } catch (error: any) {
      console.log(error.message)
      res.send({
        op: 'error',
        message: `Failed to fetch orderbook for ${market}, ${error.message}`,
      })
    }
  })

  app.get('/api/v1/:chainid/trades/', async (req, res) => {
    const chainId = req.params.chainid
      ? Number(req.params.chainid)
      : defaultChainId
      
    if (!app.api.VALID_CHAINS.includes(chainId)) {
      res
        .status(400)
        .send({
          op: 'error',
          message: `ChainId ${req.params.chainid} not found, use ${app.api.VALID_CHAINS}`,
        })
      return
    }

    let market = req.query.market as string
    let altMarket = req.query.market as string
    if (market) {
      market = market.replace('_', '-')
      altMarket = market.replace('_', '-').toUpperCase()
    }
    const type: string = req.query.type as string
    const direction = req.query.direction as string
    const limit = req.query.limit ? Number(req.query.limit) : 0
    const orderId = req.query.order_id ? Number(req.query.order_id) : 0
    const startTime = req.query.start_time ? Number(req.query.start_time) : 0
    const endTime = req.query.end_time ? Number(req.query.end_time) : 0
    const accountId = req.query.account_id ? Number(req.query.account_id) : 0

    if (type && !['s', 'b', 'sell', 'buy'].includes(type)) {
      res.send({
        op: 'error',
        message: `Type: ${type} is not a valid type. Use 's', 'b', 'sell', 'buy'`,
      })
      return
    }

    try {
      let fills = await app.api.getfills(
        chainId,
        market,
        limit,
        orderId,
        type,
        startTime,
        endTime,
        accountId,
        direction
      )
      if (fills.length === 0) {
        fills = await app.api.getfills(
          chainId,
          altMarket,
          limit,
          orderId,
          type,
          startTime,
          endTime,
          accountId,
          direction
        )
      }

      if (fills.length === 0) {
        res.send({ op: 'error', message: `Can not find fills for ${market}` })
        return
      }

      const response: any[] = []
      fills.forEach((fill) => {
        const date = new Date(fill[12])
        const entry: any = {
          chainId: fill[0],
          orderId: fill[1],
          market: fill[2],
          price: fill[4],
          baseVolume: fill[5],
          quoteVolume: fill[5] * fill[4],
          timestamp: date.getTime(),
          side: fill[3] === 's' ? 'sell' : 'buy',
          txHash: fill[7],
          takerId: Number(fill[8]),
          makerId: Number(fill[9]),
          feeAmount: fill[10],
          feeToken: fill[11],
        }
        response.push(entry)
      })

      res.send(response)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: `Failed to fetch trades for ${market}` })
    }
  })

  app.get('/api/v1/marketinfos', async (req, res) => {
    const chainId = req.query.chain_id
      ? Number(req.query.chain_id)
      : defaultChainId

    if (!app.api.VALID_CHAINS.includes(chainId)) {
      res.send({
        op: 'error',
        message: `${chainId} is not a valid chain id. Use ${app.api.VALID_CHAINS}`,
      })
      return
    }
    let markets: ZZMarket[] = []
    if (req.query.market) {
      markets = markets.concat(String(req.query.market).split(','))
    } else {
      res.send({
        op: 'error',
        message: `Set a requested pair with '?market=___'`,
      })
      return
    }

    const marketInfos: ZZMarketInfo = {}
    const results: Promise<any>[] = markets.map(async (market: ZZMarket) => {
      try {
        const marketInfo = await app.api.getMarketInfo(market, Number(chainId))
        if (!marketInfo) throw new Error('Market not found')
        marketInfos[market] = marketInfo
      } catch (err: any) {
        marketInfos[market] = {
          error: err.message,
          market,
        }
      }
    })
    await Promise.all(results)
    res.json(marketInfos)
  })
}
