import API from 'src/api'
import type { ZZHttpServer, ZZMarketSummary } from 'src/types'

export default function cmcRoutes(app: ZZHttpServer) {
  app.get('/all', async (req, res) => {
    try {
      const marketSummarys: any =  await app.api.getMarketSummarys(1000)
      res.json(marketSummarys)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: 'Failed to fetch market prices' })
    }
  })

  app.get('/ticker', async (req, res) => {
    try {
      const ticker: any = {}
      const lastPrices: any =  await app.api.getLastPrices(1000)
      lastPrices.forEach((price: string[]) => {
        ticker[price[0]] = {
          "last_price": price[1],
          "quote_volume": price[3],
          "base_volume": price[4],
          "isFrozen": 0
        }
      })
      res.json(lastPrices)
    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: 'Failed to fetch market prices' })
    }
  })
}
