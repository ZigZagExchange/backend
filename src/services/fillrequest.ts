import type { ZZServiceHandler } from 'src/types'

const BLACKLIST = process.env.BLACKLIST || ''

export const fillrequest: ZZServiceHandler = async (
  api,
  ws,
  [chainid, orderId, fillOrder]
) => {
  const blacklisted_accounts = BLACKLIST.split(',')
  if (blacklisted_accounts.includes(fillOrder.accountId.toString())) {
    ws.send(
      JSON.stringify({
        op: 'error',
        args: [
          'fillrequest',
          "You're running a bad version of the market maker. Please run git pull to update your code.",
        ],
      })
    )
    return
  }

  const redisKey = `bussymarketmaker:${chainid}:${fillOrder.accountId.toString()}`
  const processingOrderId = (JSON.parse(await api.redis.get(redisKey) as string) as any).orderId
  if (processingOrderId) {
    const remainingTime = await api.redis.ttl(redisKey)
    ws.send(
      JSON.stringify({
        op: 'error',
        args: [
          'fillrequest',
          // eslint-disable-next-line prefer-template
          'Your address did not respond to order: ' +
            processingOrderId +
            ') yet. Remaining timeout: ' +
            remainingTime +
            '.',
        ],
      })
    )
    return
  }

  try {
    const matchOrderResult = await api.matchorder(chainid, orderId, fillOrder)
    const market = matchOrderResult.fill[2]
    ws.send(
      JSON.stringify({
        op: 'userordermatch',
        args: [chainid, orderId, matchOrderResult.zktx, fillOrder],
      })
    )
    await api.redis.set(
      redisKey,
      JSON.stringify({ orderId, ws_uuid: ws.uuid }),
      { EX: api.MARKET_MAKER_TIMEOUT }
    )

    api.broadcastMessage(chainid, market, {
      op: 'orderstatus',
      args: [[[chainid, orderId, 'm']]],
    })

    api.broadcastMessage(chainid, market, {
      op: 'fills',
      args: [[matchOrderResult.fill]],
    })
  } catch (err: any) {
    console.error(err)
    ws.send(JSON.stringify({ op: 'error', args: ['fillrequest', err.message] }))
  }
}
