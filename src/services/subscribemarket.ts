import type { ZZServiceHandler, ZZMarketSummary} from 'src/types'

export const subscribemarket: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market]
) => {
  if(!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', message: `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}` }
    ws.send(JSON.stringify(errorMsg))
    return
  }

  try {
    const marketSummary: ZZMarketSummary = (await api.getMarketSummarys(
      chainId,
      market
    ))[market]
    if(marketSummary) {
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
    } else {
      const errorMsg = { op: 'error', message: `Can not find marketSummary for ${market}` }
      ws.send(JSON.stringify(errorMsg))
    }

    const marketinfo = await api.getMarketInfo(market, chainId)
    if(marketinfo) {
      const marketInfoMsg = { op: 'marketinfo', args: [marketinfo] }
      ws.send(JSON.stringify(marketInfoMsg))
    } else {
      const errorMsg = { op: 'error', message: `Can not find market ${market}` }
      ws.send(JSON.stringify(errorMsg))
    }    
  } catch (e) {
    console.error(e)
  }
  
  const openorders = await api.getopenorders(chainId, market)
  ws.send(JSON.stringify({ op: 'orders', args: [openorders] }))

  const fills = await api.getfills(chainId, market)
  ws.send(JSON.stringify({ op: 'fills', args: [fills] }))

  const liquidity = await api.getLiquidity(chainId, market)
  ws.send(
    JSON.stringify({ op: 'liquidity2', args: [chainId, market, liquidity] })
  )
  ws.chainid = chainId
  ws.marketSubscriptions.push(market)
}
