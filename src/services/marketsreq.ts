import type { ZZMarketInfo, ZZServiceHandler } from 'src/types'

export const marketsreq: ZZServiceHandler = async (
  api, 
  ws,
  [chainId, detailedFlag]
) => {
  let marketsMsg
  if (detailedFlag) {
    const marketInfo: ZZMarketInfo[] = []
    const activeMarkets = await api.redis.SMEMBERS(`activemarkets:${chainId}`)
    const result = activeMarkets.map(async (market: string) => {
      const details: ZZMarketInfo = await api.getMarketInfo(market, chainId)
      if (details) marketInfo.push(details)
    })
    Promise.all(result)
    marketsMsg = {op:"marketinfo2", args: [marketInfo]}
  }
  else {
    const lastPricesMarkets = await api.getLastPrices(chainId)
    marketsMsg = { op: 'markets', args: [lastPricesMarkets] }
  }

  if (ws) ws.send(JSON.stringify(marketsMsg))
}
