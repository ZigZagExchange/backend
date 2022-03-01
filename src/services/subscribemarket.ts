import type { ZZServiceHandler } from 'src/types'

export const subscribemarket: ZZServiceHandler = async (
  api,
  ws,
  [chainid, market]
) => {
  const openorders = await api.getopenorders(chainid, market)
  const fills = await api.getfills(chainid, market)
  const lastprices = await api.getLastPrices(chainid)
  try {
    const yesterday = new Date(Date.now() - 86400 * 1000)
      .toISOString()
      .slice(0, 10)
    let lastprice
    try {
      ;[, lastprice] = lastprices.find((l) => l[0] === market) as any
    } catch (e) {
      console.error(`No price found for ${market}`)
      lastprice = 0
    }
    const marketinfo = await api.getMarketInfo(market, chainid)
    const baseVolume = await api.redis.HGET(`volume:${chainid}:base`, market)
    const quoteVolume = await api.redis.HGET(`volume:${chainid}:quote`, market)
    const yesterdayPrice = Number(
      await api.redis.get(`dailyprice:${chainid}:${market}:${yesterday}`)
    )
    let priceChange
    if (yesterdayPrice) {
      priceChange = (lastprice - yesterdayPrice).toFixed(
        marketinfo.pricePrecisionDecimals
      )
    } else {
      priceChange = 0
    }
    const hi24 = Math.max(lastprice, yesterdayPrice)
    const lo24 = Math.min(lastprice, yesterdayPrice)
    const marketSummaryMsg = {
      op: 'marketsummary',
      args: [
        market,
        lastprice,
        hi24,
        lo24,
        priceChange,
        baseVolume,
        quoteVolume,
      ],
    }
    ws.send(JSON.stringify(marketSummaryMsg))
    const marketInfoMsg = { op: 'marketinfo', args: [marketinfo] }
    ws.send(JSON.stringify(marketInfoMsg))
  } catch (e) {
    console.error(e)
  }
  ws.send(JSON.stringify({ op: 'lastprice', args: [lastprices] }))
  ws.send(JSON.stringify({ op: 'orders', args: [openorders] }))
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
