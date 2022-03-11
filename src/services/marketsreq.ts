import type { ZZMarketInfo, ZZServiceHandler } from 'src/types'

export const marketsreq: ZZServiceHandler = async (
  api,
  ws,
  [chainId, detailedFlag]
) => {
  if(!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', message: `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}` }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return null
  }

  let marketsMsg
  if (detailedFlag) {
    const marketInfo: ZZMarketInfo[] = []
    const activeMarkets = await api.redis.SMEMBERS(`activemarkets:${chainId}`)
    const result = activeMarkets.map(async (market: string) => {
      const details: ZZMarketInfo = await api.getMarketInfo(market, chainId)
      if (details) marketInfo.push(details)
    })
    await Promise.all(result)
    marketsMsg = { op: 'marketinfo2', args: [marketInfo] }
  } else {
    const lastPricesMarkets = await api.getLastPrices(chainId)
    marketsMsg = { op: 'markets', args: [lastPricesMarkets] }
  }

  if (ws) ws.send(JSON.stringify(marketsMsg))
  return marketsMsg
}
