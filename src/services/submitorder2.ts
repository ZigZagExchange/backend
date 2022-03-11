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
      const errorMsg = { op: 'error', args: ['submitorder2', 'Chain id 1001 not suported for now.'] }
      ws.send(JSON.stringify(errorMsg))
      return errorMsg
      // @TODO: Fix me
      // const order = await api.processorderstarknet(chainId, market, zktx)
      // return order
    } catch (err: any) {
      console.error(err)
      const errorMsg = { op: 'error', args: ['submitorder2', err.message] }
      ws.send(JSON.stringify(errorMsg))
      return errorMsg
    }
  } else {
    const errorMsg = { op: 'error', args: ['submitorder2', 'Invalid chainId'] }
    ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }
}
