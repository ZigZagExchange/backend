import type { ZZServiceHandler, WSocket } from 'src/types'

export const indicateliq2: ZZServiceHandler = async (
  api,
  ws: WSocket,
  [chainId, market, liquidity]
) => {
  const makerConnId = `${chainId}:${ws.uuid}`
  api.MAKER_CONNECTIONS[makerConnId] = ws

  // check if timed out
  const redisKey = `timeoutmm:${chainId}:${ws.uuid}`
  const timeout_ws_message = await api.redis.GET(redisKey)
  if (timeout_ws_message) {
    const remainingTime = await api.redis.ttl(redisKey)
    ws.send(
      JSON.stringify({
        op: 'error',
        args: [
          'indicateliq2',
          `${timeout_ws_message} Remaining timeout: ${remainingTime}`,
        ],
      })
    )
    console.log('fillrequest - return blacklisted market maker.')
    return
  }

  try {
    await api.updateLiquidity(chainId, market, liquidity, makerConnId)
  } catch (e: any) {
    ws.send(JSON.stringify({ op: 'error', args: ['indicateliq2', e.message] }))
  }
}
