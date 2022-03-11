import type { ZZServiceHandler } from 'src/types'

export const orderreceiptreq: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId]
) => {
  try {
    const orderreceipt = await api.getorder(chainId, orderId)
    const msg = { op: 'orderreceipt', args: orderreceipt }
    if (ws) ws.send(JSON.stringify(msg))
    return orderreceipt
  } catch (err: any) {
    const errorMsg = { op: 'error', args: ['orderreceiptreq', err.message] }
    if (ws) ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }
}
