import type { ZZServiceHandler } from 'src/types'

export const marketsreq: ZZServiceHandler = async (api, ws, [chainid]) => {
  const lastPricesMarkets = await api.getLastPrices(chainid)
  const marketsMsg = { op: 'markets', args: [lastPricesMarkets] }
  if (ws) ws.send(JSON.stringify(marketsMsg))
}
