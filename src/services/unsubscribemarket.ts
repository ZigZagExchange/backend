import type { ZZServiceHandler } from 'src/types'

export const unsubscribemarket: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market]
) => {
  if (ws.chainid !== chainId) {
    ws.marketSubscriptions = []
  } else {
    ws.marketSubscriptions = ws.marketSubscriptions.filter((m) => m !== market)
  }  
}
