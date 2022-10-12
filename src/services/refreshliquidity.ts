import type { WSMessage, ZZServiceHandler } from 'src/types'

export const refreshliquidity: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market]
) => {
  if (!api.VALID_CHAINS_ZKSYNC.includes(chainId)) {
    const errorMsg: WSMessage = {
      op: 'error',
      args: [
        'refreshliquidity',
        `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS_ZKSYNC}`,
      ],
    }
    if (ws) ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return errorMsg
  }

  const liquidity = await api.getLiquidity(chainId, market)
  const liquidityMsg: WSMessage = { op: 'liquidity2', args: [chainId, market, liquidity] }
  if (ws) ws.send(JSON.stringify(liquidityMsg))
  return liquidityMsg
}
