import type { ZZServiceHandler } from 'src/types'

export const indicateliq2: ZZServiceHandler = async (
  api,
  ws,
  [chainid, market, liquidity]
) => {
  const client_id = ws.uuid
  try {
    await api.updateLiquidity(chainid, market, liquidity, client_id)
  } catch (e: any) {
    ws.send(JSON.stringify({ op: 'error', args: ['indicateliq2', e.message] }))
  }
}
