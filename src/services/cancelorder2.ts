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
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return
  }

  try {
    const cancelResult: boolean = await api.cancelorder2(chainId, orderId, signedMessage)
    if (!cancelResult) throw new Error('Unexpected error')
  } catch (e: any) {
    ws.send(
      JSON.stringify({
        op: 'error',
        args: ['cancelorder2', e.message, orderId],
      })
    )
  }

  // return the new status to the sender
  ws.send(
    JSON.stringify({ op: 'orderstatus', args: [[[chainId, orderId, 'c']]] })
  )
}
