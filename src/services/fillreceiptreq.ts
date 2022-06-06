import type { ZZServiceHandler } from 'src/types'

export const fillreceiptreq: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId]
) => {
  if (!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', args: ['fillreceiptreq', `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`] }
    if (ws) ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return errorMsg
  }

  if(typeof orderId === 'object' && orderId.length > 25) {
    const errorMsg = { op: 'error', args: ['fillreceiptreq', `${orderId.length} is not a valid length. Use up to 25`] }
    if (ws) ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }

  try {
    const fillreceipt = await api.getFill(chainId, orderId)
    const msg = { op: 'fillreceipt', args: fillreceipt }
    if (ws) ws.send(JSON.stringify(msg))
    return fillreceipt
  } catch (err: any) {
    const errorMsg = { op: 'error', args: ['fillreceiptreq', err.message] }
    if (ws) ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }
}
