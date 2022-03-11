import type { ZZServiceHandler } from 'src/types'

export const cancelorder: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId]
) => {

  let cancelresult
  try {
    cancelresult = await api.cancelorder(chainId, orderId, ws)
  } catch (e: any) {
    ws.send(
      JSON.stringify({ op: 'error', args: ['cancelorder', orderId, e.message] })
    )
    return
  }

  await api.broadcastMessage(chainId, cancelresult.market, {
    op: 'orderstatus',
    args: [[[chainId, orderId, 'c']]],
  })
}
