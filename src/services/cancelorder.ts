import type { ZZServiceHandler } from 'src/types'

export const cancelorder: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId]
) => {
  if(!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', message: `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}` }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return
  }

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
