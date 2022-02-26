import type { AnyObject, ZZServiceHandler } from 'src/types'

export const orderstatusupdate: ZZServiceHandler = async (
  api,
  ws,
  [updates]
) => {
  const promises = Object.keys(updates).map(async i => {
    const update = updates[i]
    const chainid = Number(update[0])
    const orderId = update[1]
    const newstatus = update[2]
    let success
    let fillId
    let market
    let lastprice
    let feeAmount
    let feeToken
    
    if (newstatus === 'b') {
      const txhash = update[3]
      const result = await api.updateMatchedOrder(
        chainid,
        orderId,
        newstatus,
        txhash
      ) as AnyObject
      success = result.success
      fillId = result.fillId
      market = result.market
    }
    if (newstatus === 'r' || newstatus === 'f') {
      const txhash = update[3]
      const result = await api.updateOrderFillStatus(chainid, orderId, newstatus) as AnyObject
      success = result.success
      fillId = result.fillId
      market = result.market
      lastprice = result.fillPriceWithoutFee
      feeAmount = result.feeAmount
      feeToken = result.feeToken
      const mmAccount = result.maker_user_id
      const redisKey = `bussymarketmaker:${chainid}:${mmAccount}`
      await api.redis.del(redisKey)
    }
    if (success) {
      const fillUpdate = [...update]
      fillUpdate[1] = fillId
      fillUpdate[5] = feeAmount
      fillUpdate[6] = feeToken
      api.broadcastMessage(chainid, market, { 
        op: 'orderstatus', 
        args: [[update]] 
      })
      api.broadcastMessage(chainid, market, {
        op: 'fillstatus',
        args: [[fillUpdate]],
      })
    }
    if (success && newstatus === 'f') {
      const yesterday = new Date(Date.now() - 86400 * 1000)
        .toISOString()
        .slice(0, 10)
      const yesterdayPrice = Number(await api.redis.get(
        `dailyprice:${chainid}:${market}:${yesterday}`
      ))
      const priceChange = (lastprice - yesterdayPrice).toString()
      api.broadcastMessage(chainid, null, {
        op: 'lastprice',
        args: [[[market, lastprice, priceChange]]],
      })
      // TODO: Account for nonce checks here
      // const userId = update[5];
      // const userNonce = update[6];
      // if(userId && userNonce) {
      //    if(!NONCES[userId]) { NONCES[userId] = {}; };
      //    // nonce+1 to save the next expected nonce
      //    NONCES[userId][chainid] = userNonce+1;
      // }
    }
  })

  return Promise.all(promises)
}
