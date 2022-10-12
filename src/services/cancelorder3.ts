import type { WSMessage, ZZServiceHandler } from 'src/types'

export const cancelorder3: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId, token]
) => {
  if (!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg: WSMessage = {
      op: 'error',
      args: [
        'cancelorder3',
        `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`,
      ],
    }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return
  }

  try {
    const cancelResult: boolean = await api.cancelorder3(
      chainId,
      orderId,
      token
    )
    if (!cancelResult) throw new Error('Unexpected error')
  } catch (e: any) {
    const errorMsg: WSMessage = {
      op: 'error',
      args: ['cancelorder3', e.message, orderId],
    }
    ws.send(JSON.stringify(errorMsg))
  }

  // return the new status to the sender
  ws.send(
    JSON.stringify({ op: 'orderstatus', args: [[[chainId, orderId, 'c']]] })
  )
}
