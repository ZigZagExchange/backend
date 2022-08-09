import type { ZZServiceHandler } from 'src/types'

// Exact same thing as submitorder2 but it follows our standardized response format
// Returns:
//   {"op":"userorderack","args":[[1002,4734,"USDC-USDT","b",1.0015431034482758,127.6,127.7969,1646051432,"1285612","o",null,127.6]]}
export const submitorder3: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, zktx]
) => {
  let msg
  try {
    switch (chainId) {
      case 1: case 1002:
        msg = await api.processorderzksync(chainId, market, zktx)
        break
      case 1001:
        msg = await api.processorderstarknet(chainId, market, zktx)
        break
      case 42161:
        msg = await api.processOrderEVM(chainId, market, zktx)
        break
      default:
        msg = { op: 'error', args: ['submitorder3', 'Invalid chainId'] }
    }
  } catch (err: any) {
    console.error(err)
    msg = { op: 'error', args: ['submitorder3', err.message] }
  }
  
  if (ws) ws.send(JSON.stringify(msg))
  return msg
}
