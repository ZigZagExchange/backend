import type { ZZServiceHandler } from 'src/types'

export const unsubscribemarket: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market]
) => {
  if (!chainId || !market) {
    ws.marketSubscriptions = []
  } else {
    const subscription = `${chainId}:${market}`
    ws.marketSubscriptions = ws.marketSubscriptions.filter(
      (m) => m !== subscription
    )
  }
}
