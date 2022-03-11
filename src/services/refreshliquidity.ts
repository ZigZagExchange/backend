import type { ZZServiceHandler } from 'src/types'

export const refreshliquidity: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market]
) => {
  const liquidity = await api.getLiquidity(chainId, market)
  const liquidityMsg = { op: 'liquidity2', args: [chainId, market, liquidity] }
  if (ws) ws.send(JSON.stringify(liquidityMsg))
  return liquidityMsg
}
