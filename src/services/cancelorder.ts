import type { ZZServiceHandler } from 'src/types'

export const cancelorder: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId]
) => {
  if(!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', args: ['cancelorder', `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`] }
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

  // return the new status to the sender, regardless of market
  ws.send(
    JSON.stringify({ op: 'orderstatus', args: [[[chainId, orderId, 'c']]], })
  )

  await api.broadcastMessage(chainId, cancelresult.market, {
    op: 'orderstatus',
    args: [[[chainId, orderId, 'c']]],
  })
}
