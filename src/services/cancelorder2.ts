import type { WSMessage, ZZServiceHandler } from 'src/types'

export const cancelorder2: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId, signedMessage]
) => {
  if (!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg: WSMessage = {
      op: 'error',
      args: [
        'cancelorder2',
        `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`,
      ],
    }
    console.log(`Error, ${chainId} is not a valid chain id.`)
    if (ws) ws.send(JSON.stringify(errorMsg))    
    return errorMsg
  }

  try {
    const cancelResult: boolean = await api.cancelorder2(chainId, orderId, signedMessage)
    if (!cancelResult) throw new Error('Unexpected error')
  } catch (e: any) {
    const errorMsg: WSMessage = {
      op: 'error',
      args: ['cancelorder2', e.message, orderId],
    }
    if (ws) ws.send(JSON.stringify(errorMsg))    
    return errorMsg
  }

  // return the new status to the sender
  const successMsg: WSMessage = { op: 'orderstatus', args: [[[chainId, orderId, 'c']]] }
  if (ws) ws.send(JSON.stringify(successMsg))  
  return successMsg
}
