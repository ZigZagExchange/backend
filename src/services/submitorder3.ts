import type { ZZServiceHandler } from 'src/types'

// Exact same thing as submitorder2 but it follows our standardized response format
// Returns:
//   {"op":"userorderack","args":[[1000,4734,"USDC-USDT","b",1.0015431034482758,127.6,127.7969,1646051432,"1285612","o",null,127.6]]}
export const submitorder3: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, zktx]
) => {
  if (chainId === 1 || chainId === 1000) {
    try {
      const order = await api.processorderzksync(chainId, market, zktx)
      return order
    } catch (err: any) {
      console.error(err)
      const errorMsg = { op: 'error', args: ['submitorder3', err.message] }
      if (ws) ws.send(JSON.stringify(errorMsg))
      return errorMsg
    }
  } else if (chainId === 1001) {
    try {
      const errorMsg = { op: 'error', args: ['submitorder2', 'Chain id 1001 not suported for now.'] }
      if (ws) ws.send(JSON.stringify(errorMsg))
      return errorMsg
      const order = await api.processorderstarknet(chainId, market, zktx)
      return order
    } catch (err: any) {
      console.error(err)
      const errorMsg = { op: 'error', args: ['submitorder3', err.message] }
      if (ws) ws.send(JSON.stringify(errorMsg))
      return errorMsg
    }
  } else {
    const errorMsg = { op: 'error', args: ['submitorder3', 'Invalid chainId'] }
    if (ws) ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }
}
