import type { ZZServiceHandler } from 'src/types'

export const indicateliq2: ZZServiceHandler = async (
  api,
  ws,
  [chainid, market, liquidity]
) => {
  const makerConnId = `${chainid}:${ws.uuid}`
  api.MAKER_CONNECTIONS[makerConnId] = ws
  try {
    await api.updateLiquidity(chainid, market, liquidity, makerConnId)
  } catch (e: any) {
    ws.send(JSON.stringify({ op: 'error', args: ['indicateliq2', e.message] }))
  }
}
