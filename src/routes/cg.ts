import API from 'src/api'
import type { ZZHttpServer } from 'src/types'

export default function cmcRoutes(app: ZZHttpServer) {

  const defaultChainId = process.env.DEFAULT_CHAIN_ID
      ? Number(process.env.DEFAULT_CHAIN_ID)
      : 1

    app.get('/api/coingecko/v1/pairs', async (req, res) => {
    try {
        const results: any[] = []
        const markets = await app.api.redis.SMEMBERS(`activemarkets:${defaultChainId}`)
        markets.forEach(market => {
            const [base, target] = market.split('-')
            const entry: any = {
                "ticker_id": (base + "_" + target),           
                "base": base,
                "target": target
            }
            results.push(entry)
        })
        res.send(results)
        } catch (error: any) {
        console.log(error.message)
        res.send({ op: 'error', message: 'Failed to fetch markets' })
        }
    })

    app.get('/api/coingecko/v1/tickers', async (req, res) => {
        try {
            const markets: any = {}
            const marketSummarys: any =  await app.api.getMarketSummarys(defaultChainId)
            
            Object.keys(marketSummarys).forEach((market: string) => {
                const marketSummary = marketSummarys[market]
            const entry: any = {
                "ticker_id": marketSummary.market,
                "base_currency": marketSummary.baseSymbol,
                "target_currency": marketSummary.quoteSymbol,
                "last_price": marketSummary.lastPrice,
                "base_volume": marketSummary.baseVolume,
                "target_volume": marketSummary.quoteVolume,
                "bid": marketSummary.highestBid,
                "ask": marketSummary.lowestAsk,
                "high": marketSummary.highestPrice_24h,
                "low": marketSummary.lowestPrice_24h
            }
            markets[market] = entry
            })
            res.json(markets)
        } catch (error: any) {
            console.log(error.message)
            res.send({ op: 'error', message: 'Failed to fetch markets' })
        }
    })

    app.get('/api/coingecko/v1/orderbook', async (req, res) => {
        const tickerId: string = req.query.ticker_id as string
        let depth: number = (req.query.depth) ? Number(req.query.depth) : 0
        let market: string;
        if(tickerId) {
            market = tickerId.replace('_','-').toUpperCase()
        } else {
            res.send({ op: 'error', message: "Please set a 'ticker_id' like '/orderbook?ticker_id'" })
            return
        }

        try {
            // get data
            const liquidity = await app.api.getLiquidityPerSide(
                defaultChainId,
                market,
                depth,
                3
            )
            res.json(liquidity)
        } catch (error: any) {
            console.log(error.message)
            res.send({ op: 'error', message: `Failed to fetch orderbook for ${market}, ${error.message}` })
        }
    })

    app.get('/api/coingecko/v1/historical_trades', async (req, res) => {
        const tickerId: string = req.query.ticker_id as string
        const type: string = req.query.type as string
        const limit = (req.query.limit) ? Number(req.query.limit) : 0
        const startTime = (req.query.start_time) ? Number(req.query.start_time) : 0
        const endTime = (req.query.end_time) ? Number(req.query.end_time) : 0

        let market: string;
        if(tickerId) {
            market = tickerId.replace('_','-').toUpperCase()
        } else {
            res.send({ op: 'error', message: "Please set a 'ticker_id' like '/orderbook?ticker_id'" })
            return
        }
        
        if(type && !['s', 'b', 'sell', 'buy'].includes(type)) {
            res.send({ op: 'error', message: `Type: ${type} is not a valid type. Use 's', 'b', 'sell', 'buy'` })
            return
        }

        try {
          const fills = await app.api.getfills(
            defaultChainId,
            market,
            limit,
            0,
            type,
            startTime,
            endTime
          )
          if(fills.length === 0) {
            res.send({ op: 'error', message: `Can not find trades for ${market}` })
            return
          }

          const response: any[] = []
          for(let i=0; i<fills.length; i++) {
            const fill = fills[i]
            const date = new Date(fill[12])
            const entry: any = {
              "trade_id": fill[1],
              "price": fill[4],
              "base_volume": fill[5],
              "target_volume": (fill[5] * fill[4]),
              "trade_timestamp": date.getTime(),
              "type": (fill[3] === 's') ? 'sell' : 'buy'
            }
            response.push(entry)
          }    
          res.send(response)
        } catch (error: any) {
          console.log(error.message)
          res.send({ op: 'error', message: `Failed to fetch trades for ${market}` })
        }
    })
}