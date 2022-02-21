import type { ZZHttpServer } from 'src/types'

export default function cmcRoutes(app: ZZHttpServer) {
  app.get('/ticker', async (req, res, next) => {
    try {
      // const marketinfo = await app.api?.getLastPrices()
      const markets = (await app.api.getV1Markets(1000)) as string[]
      const marketinfo = await app.api.fetchMarketInfoFromMarkets(markets, 1000)

      if (marketinfo) {
        res.send(marketinfo)
        return
      }

      res.send({ op: 'error', message: 'Failed to fetch market prices' })
    } catch (error) {
      next(error)
    }
  })
}
