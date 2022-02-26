import type { ZZServiceHandler } from 'src/types'

export const submitorder2: ZZServiceHandler = async (
  api,
  ws,
  [chainid, market, zktx]
) => {
  if (chainid === 1 || chainid === 1000) {
    try {
      const order = await api.processorderzksync(chainid, market, zktx)
      return order
    } catch (err: any) {
      console.error(err)
      const errorMsg = { op: 'error', args: ['submitorder', err.message] }
      if (ws) ws.send(JSON.stringify(errorMsg))
      return errorMsg
    }
  } else if (chainid === 1001) {
    try {
      // @TODO: Fix me
      // const order = await api.processorderstarknet(chainid, market, zktx)
      // return order
    } catch (err: any) {
      console.error(err)
      const errorMsg = { op: 'error', args: ['submitorder', err.message] }
      ws.send(JSON.stringify(errorMsg))
      return errorMsg
    }
  } else {
    const errorMsg = { op: 'error', args: ['Invalid chainid in submitorder'] }
    ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }
}
