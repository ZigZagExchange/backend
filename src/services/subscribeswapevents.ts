import type { ZZServiceHandler, WSMessage } from 'src/types'
import { sortMarketPair } from 'src/utils'

/* ################ V3 functions  ################ */
export const subscribeswapevents: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market]
) => {
  if (!api.VALID_EVM_CHAINS.includes(chainId) || chainId === -1) {
    const errorMsg: WSMessage = {
      op: 'error',
      args: [
        'subscribeswapevents',
        `${chainId} is not a valid chain id. Use ${api.VALID_EVM_CHAINS} or -1`,
      ],
    }
    ws.send(JSON.stringify(errorMsg))
    return
  }

  if (!market.includes('-') && market !== 'all') {
    const errorMsg: WSMessage = {
      op: 'error',
      args: [
        'subscribeswapevents',
        `${market} is not a valid market Use "tokenA-tokenB" or all`,
      ],
    }
    ws.send(JSON.stringify(errorMsg))
    return
  }

  console.log("DEBUG: market0", market)
  console.log("DEBUG: tokenB", market.split['-'][0])
  console.log("DEBUG: market", market.split['-'][1])
  try {
    const [tokenA, tokenB] = market.split['-']
    market = sortMarketPair(tokenA, tokenB)
    console.log("DEBUG: market1", market)
    await api.sendInitialPastOrders(chainId, market, ws)
  } catch (e: any) {
    console.error(e)
    const errorMsg: WSMessage = {
      op: 'error',
      args: ['subscribeswapevents', e.message],
    }
    ws.send(JSON.stringify(errorMsg))
  }

  ws.chainId = chainId
  ws.swapEventSubscription = market
}
