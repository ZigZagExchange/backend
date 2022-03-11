import type { ZZServiceHandler } from 'src/types'

export const refreshliquidity: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market]
) => {
  if(!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', message: `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}` }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return null
  }

  const liquidity = await api.getLiquidity(chainId, market)
  const liquidityMsg = { op: 'liquidity2', args: [chainId, market, liquidity] }
  if (ws) ws.send(JSON.stringify(liquidityMsg))
  return liquidityMsg
}
