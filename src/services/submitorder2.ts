import type { ZZServiceHandler } from 'src/types'

export const submitorder2: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, zktx]
) => {
  let msg = { op: 'error', args: ['submitorder3'] }
  try {
    switch (chainId) {
      case 1: case 1002:
        msg = await api.processorderzksync(chainId, market, zktx)
        break
      // case 1001:
      //   msg = await api.processorderstarknet(chainId, market, zktx)
      //   break
      case 42161: case 421613:
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
  // submitorder2 only returns the args and should no longer be used
  return msg.args
}
