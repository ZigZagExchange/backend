import API from 'src/api'
import type { ZZHttpServer, ZZMarketSummary } from 'src/types'

export default function cmcRoutes(app: ZZHttpServer) {
  app.get('/ticker', async (req, res) => {
    try {
      const marketSummarys: any =  await app.api.getMarketSummarys(1000)
      res.json(marketSummarys)

    } catch (error: any) {
      console.log(error.message)
      res.send({ op: 'error', message: 'Failed to fetch market prices' })
    }
  })
}
