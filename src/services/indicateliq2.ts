import type { ZZServiceHandler } from 'src/types'

export const indicateliq2: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, liquidity]
) => {
  const makerConnId = `${chainId}:${ws.uuid}`
  api.MAKER_CONNECTIONS[makerConnId] = ws
  try {
    const errorMsg = await api.updateLiquidity(
      chainId,
      market,
      liquidity,
      ws.uuid
    )

    // return any bad liquidity msg
    if (errorMsg.length > 0) {
      const errorString = `Send one or more invalid liquidity positions: ${errorMsg.join(
        '. '
      )}.`
      ws.send(
        JSON.stringify({ op: 'error', args: ['indicateliq2', errorString] })
      )
    }
  } catch (e: any) {
    ws.send(JSON.stringify({ op: 'error', args: ['indicateliq2', e.message] }))
  }
}
