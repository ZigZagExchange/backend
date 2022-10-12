import type { WSMessage, ZZServiceHandler } from 'src/types'

export const indicateliq2: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, liquidity]
) => {
  const makerConnId = `${chainId}:${ws.uuid}`
  api.MAKER_CONNECTIONS[makerConnId] = ws
  try {
    const errorArgs: string[] = await api.updateLiquidity(
      chainId,
      market,
      liquidity,
      ws.uuid
    )

    // return any bad liquidity msg
    if (errorArgs.length > 0) {
      const errorMsg: WSMessage = {
        op: 'error',
        args: [
          'indicateliq2',
          `Send one or more invalid liquidity positions: ${errorArgs.join(
            '. '
          )}.`,
        ],
      }
      ws.send(JSON.stringify(errorMsg))
    }
  } catch (e: any) {
    const errorMsg: WSMessage = {
      op: 'error',
      args: ['indicateliq2', e.message],
    }
    ws.send(JSON.stringify(errorMsg))
  }
}
