import type { ZZServiceHandler } from 'src/types'

export const cancelall: ZZServiceHandler = async (
  api,
  ws,
  [chainId, userid]
) => {
  if(!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', args: ['cancelall', `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`] }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return
  }

  const userconnkey = `${chainId}:${userid}`
  if (api.USER_CONNECTIONS[userconnkey] !== ws) {
    ws.send(
      JSON.stringify({
        op: 'error',
        args: ['cancelall', userid, 'Unauthorized'],
      })
    )
  }
  const canceled_orders = await api.cancelallorders(userid)
  const orderupdates = canceled_orders.map((orderid: string) => [
    chainId,
    orderid,
    'c',
  ])
  await api.broadcastMessage(chainId, null, {
    op: 'orderstatus',
    args: [orderupdates],
  })
}
