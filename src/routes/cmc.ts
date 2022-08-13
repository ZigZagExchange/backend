import type { ZZHttpServer } from 'src/types'

export default function cmcRoutes(app: ZZHttpServer) {

  const defaultChainId = process.env.DEFAULT_CHAIN_ID
    ? Number(process.env.DEFAULT_CHAIN_ID)
    : 1

  app.get('/api/coinmarketcap/v1/:chainid/markets', async (req, res) => {
    try {
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

      const markets: any = {}
      const marketSummarys: any = await app.api.getMarketSummarys(chainId)

      Object.keys(marketSummarys).forEach((market: string) => {
        const marketSummary = marketSummarys[market]
        const entry: any = {
          trading_pairs: marketSummary.market,
          base_currency: marketSummary.baseSymbol,
          quote_currency: marketSummary.quoteSymbol,
          last_price: marketSummary.lastPrice,
          lowest_ask: marketSummary.lowestAsk,
          highest_bid: marketSummary.highestBid,
          base_volume: marketSummary.baseVolume,
          quote_volume: marketSummary.quoteVolume,
          price_change_percent_24h: marketSummary.priceChangePercent_24h,
          highest_price_24h: marketSummary.highestPrice_24h,
          lowest_price_24h: marketSummary.lowestPrice_24h,
        }
        markets[market] = entry
      })
      res.status(200).json(markets)
    } catch (error: any) {
      console.log(error.message)
      res.status(400).send({ op: 'error', message: 'Failed to fetch markets' })
    }
  })

  app.get('/api/coinmarketcap/v1/:chainid/ticker', async (req, res) => {
    try {
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

      const ticker: any = {}
      const lastPrices: any = await app.api.getLastPrices(chainId)
      lastPrices.forEach((price: string[]) => {
        const entry: any = {
          last_price: price[1],
          base_volume: price[4],
          quote_volume: price[3],
          isFrozen: 0,
        }
        ticker[price[0]] = entry
      })
      res.status(200).json(ticker)
    } catch (error: any) {
      console.log(error.message)
      res
        .status(400)
        .send({ op: 'error', message: 'Failed to fetch ticker prices' })
    }
  })

  app.get(
    '/api/coinmarketcap/v1/:chainid/orderbook/:market_pair',
    async (req, res) => {
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

      const market = req.params.market_pair.replace('_', '-').toUpperCase()
      const altMarket = req.params.market_pair.replace('_', '-')
      const depth: number = req.query.depth ? Number(req.query.depth) : 0
      const level: number = req.query.level ? Number(req.query.level) : 2
      if (![1, 2, 3].includes(level)) {
        res
          .status(400)
          .send({
            op: 'error',
            message: `Level: ${level} is not a valid level. Use 1, 2 or 3.`,
          })
        return
      }

      try {
        // get data
        let orderBook = await app.api.getOrderBook(
          chainId,
          market,
          depth,
          level
        )
        if (orderBook.asks.length === 0 && orderBook.bids.length === 0) {
          orderBook = await app.api.getOrderBook(
            chainId,
            altMarket,
            depth,
            level
          )
        }
        res.status(200).json(orderBook)
      } catch (error: any) {
        console.log(error.message)
        res
          .status(400)
          .send({
            op: 'error',
            message: `Failed to fetch orderbook for ${market}, ${error.message}`,
          })
      }
    }
  )

  app.get(
    '/api/coinmarketcap/v1/:chainid/trades/:market_pair',
    async (req, res) => {
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

      const market = req.params.market_pair.replace('_', '-').toUpperCase()
      const altMarket = req.params.market_pair.replace('_', '-')
      try {
        let fills = await app.api.getfills(chainId, market)
        if (fills.length === 0) {
          fills = await app.api.getfills(chainId, altMarket)
        }

        if (fills.length === 0) {
          res
            .status(400)
            .send({ op: 'error', message: `Can not find trades for ${market}` })
          return
        }

        const response: any[] = []
        fills.forEach((fill) => {
          const date = new Date(fill[12])
          const entry: any = {
            trade_id: fill[1],
            price: fill[4],
            base_volume: fill[5],
            quote_volume: fill[5] * fill[4],
            timestamp: date.getTime(),
            type: fill[3] === 's' ? 'sell' : 'buy',
          }
          response.push(entry)
        })

        res.status(200).send(response)
      } catch (error: any) {
        console.log(error.message)
        res
          .status(400)
          .send({
            op: 'error',
            message: `Failed to fetch trades for ${market}`,
          })
      }
    }
  )
}
