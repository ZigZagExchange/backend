import type { ZZServiceHandler, ZZMarketSummary} from 'src/types'

export const subscribemarket: ZZServiceHandler = async (
  api,
  ws,
  [chainid, market]
) => {
  if(!api.VALID_CHAINS.includes(chainid)) {
    const errorMsg = { op: 'error', message: `${chainid} is not a valid chain id. Use ${api.VALID_CHAINS}` }
    ws.send(JSON.stringify(errorMsg))
    return
  }

  try {
    const marketSummary: ZZMarketSummary = (await api.getMarketSummarys(
      chainid,
      market
    ))[market]
    const marketinfo = await api.getMarketInfo(market, chainid)
    if(!marketinfo) {
      const errorMsg = { op: 'error', message: `Can not find market ${market}` }
      ws.send(JSON.stringify(errorMsg))
      return
  }
    const marketSummaryMsg = {
      op: 'marketsummary',
      args: [
        marketSummary.market,
        marketSummary.lastPrice,
        marketSummary.highestPrice_24h,
        marketSummary.lowestPrice_24h,
        marketSummary.priceChange,
        marketSummary.baseVolume,
        marketSummary.quoteVolume,
      ],
    }
    ws.send(JSON.stringify(marketSummaryMsg))
    const marketInfoMsg = { op: 'marketinfo', args: [marketinfo] }
    ws.send(JSON.stringify(marketInfoMsg))  
  } catch (e) {
    console.error(e)
  }
  
  const openorders = await api.getopenorders(chainid, market)
  ws.send(JSON.stringify({ op: 'orders', args: [openorders] }))

  const fills = await api.getfills(chainid, market)
  ws.send(JSON.stringify({ op: 'fills', args: [fills] }))

  const liquidity = await api.getLiquidity(chainid, market)
  ws.send(
    JSON.stringify({ op: 'liquidity2', args: [chainid, market, liquidity] })
  )
  ws.chainid = chainid
  ws.marketSubscriptions.push(market)
}
