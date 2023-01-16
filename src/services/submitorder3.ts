import type { WSMessage, ZZServiceHandler } from 'src/types'

// Exact same thing as submitorder2 but it follows our standardized response format
// Returns:
//   {"op":"userorderack","args":[[1002,4734,"USDC-USDT","b",1.0015431034482758,127.6,127.7969,1646051432,"1285612","o",null,127.6]]}
export const submitorder3: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, zktx]
) => {
  let msg: WSMessage
  try {
    if (api.VALID_CHAINS_ZKSYNC.includes(chainId)) {
      msg = await api.processorderzksync(chainId, market, zktx)
    } else {
      msg = { op: 'error', args: ['submitorder3', `'${chainId}' is an invalid chainId`] }
    }
  } catch (err: any) {
    console.error(err)
    msg = { op: 'error', args: ['submitorder3', err.message] }
  }

  if (ws) ws.send(JSON.stringify(msg))
  return msg
}
