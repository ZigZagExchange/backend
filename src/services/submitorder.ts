import type { ZZServiceHandler } from 'src/types'

export const submitorder: ZZServiceHandler = async (api, ws, [chainid, zktx]) => {
  if (chainid !== 1) {
    const errorMsg = {
      op: 'error',
      args: [
        'submitorder',
        'v1 orders only supported on mainnet. upgrade to v2 orders',
      ],
    }
    if (ws) ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }

  const V1_MARKETS = await api.getV1Markets(chainid)
  const tokenBuy = api.V1_TOKEN_IDS[zktx.tokenBuy]
  const tokenSell = api.V1_TOKEN_IDS[zktx.tokenSell]
  let market

  if (V1_MARKETS.includes(`${tokenBuy}-${tokenSell}`)) {
    market = `${tokenBuy}-${tokenSell}`
  } else if (V1_MARKETS.includes(`${tokenSell}-${tokenBuy}`)) {
    market = `${tokenSell}-${tokenBuy}`
  } else {
    const errorMsg = { op: 'error', args: ['submitorder', 'invalid market'] }
    if (ws) ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }
  
  try {
    const order = await api.processorderzksync(chainid, market, zktx)
    return order
  } catch (err: any) {
    console.error(err)
    const errorMsg = { op: 'error', args: ['submitorder', err.message] }
    if (ws) ws.send(JSON.stringify(errorMsg))
    return errorMsg
  }
}
