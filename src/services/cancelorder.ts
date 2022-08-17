import type { ZZServiceHandler } from 'src/types'

export const cancelorder: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId]
) => {
  if (!api.VALID_CHAINS_ZKSYNC.includes(chainId)) {
    const errorMsg = {
      op: 'error',
      args: [
        'cancelorder',
        `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`,
      ],
    }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return
  }

  try {
    const cancelresult = await api.cancelorder(chainId, orderId, ws)
    if (!cancelresult) throw new Error('Unexpected error')
  } catch (e: any) {
    ws.send(
      JSON.stringify({ op: 'error', args: ['cancelorder', e.message, orderId] })
    )
  }

  // return the new status to the sender
  ws.send(
    JSON.stringify({ op: 'orderstatus', args: [[[chainId, orderId, 'c', 0]]] })
  )
}
