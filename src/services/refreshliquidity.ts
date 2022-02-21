import type { ZZServiceHandler } from 'src/types'

export const refreshliquidity: ZZServiceHandler = async (api, ws, [chainid, market]) => {
  const liquidity = await api.getLiquidity(chainid, market)
  const liquidityMsg = { op: 'liquidity2', args: [chainid, market, liquidity] }
  if (ws) ws.send(JSON.stringify(liquidityMsg))
  return liquidityMsg
}
