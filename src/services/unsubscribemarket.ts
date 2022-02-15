import type { ZZServiceHandler } from 'src/types'

export const unsubscribemarket: ZZServiceHandler = async (
  api,
  ws,
  [chainid, market]
) => {
  if (ws.chainid !== chainid) ws.marketSubscriptions = []
  ws.marketSubscriptions = ws.marketSubscriptions.filter((m) => m !== market)
}
