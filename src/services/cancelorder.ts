import type { ZZServiceHandler } from 'src/types'

export const cancelorder: ZZServiceHandler = async (api, ws, [chainid, orderId]) => {
  let cancelresult

  try {
    cancelresult = await api.cancelorder(chainid, orderId, ws)
  } catch (e: any) {
    ws.send(
      JSON.stringify({ op: 'error', args: ['cancelorder', orderId, e.message] })
    )
    return
  }

  await api.broadcastMessage(chainid, cancelresult.market, {
    op: 'orderstatus',
    args: [[[chainid, orderId, 'c']]],
  })
}
