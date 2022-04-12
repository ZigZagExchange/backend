import type { ZZServiceHandler } from 'src/types'

export const submitorder2: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, zktx]
) => {
  if (chainId === 1 || chainId === 1000) {
    try {
      const order = await api.processorderzksync(chainId, market, zktx)
      if (ws) ws.send(JSON.stringify(order))
      return order.args
    } catch (err: any) {
      console.error(err)
      const errorMsg = { op: 'error', args: ['submitorder2', err.message] }
      if (ws) ws.send(JSON.stringify(errorMsg))
      return errorMsg
    }
  } else if (chainId === 1001) {
    try {
      // const order = await api.processorderstarknet(chainId, market, zktx)
      // return order
      throw new Error ("StarkNet not supported for now.")
    } catch (err: any) {
      console.error(err)
      const errorMsg = { op: 'error', args: ['submitorder2', err.message] }
      if (ws) ws.send(JSON.stringify(errorMsg))
      return errorMsg
    }
  } else {
    const errorMsg = { op: 'error', args: ['submitorder2', 'Invalid chainId'] }
    if (ws) ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }
}
