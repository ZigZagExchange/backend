import type { ZZServiceHandler, ZZMarketSummary} from 'src/types'

export const subscribemarket: ZZServiceHandler = async (
  api,
  ws,
  [chainid, market]
) => {
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

  if ([1, 1000].includes(chainid)) {
    const liquidity = await api.getLiquidity(chainid, market)
    ws.send(
      JSON.stringify({ op: 'liquidity2', args: [chainid, market, liquidity] })
    )
  }  
  ws.chainid = chainid
  ws.marketSubscriptions.push(market)
}
