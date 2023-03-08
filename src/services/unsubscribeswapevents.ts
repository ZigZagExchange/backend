import type { ZZServiceHandler, WSMessage } from 'src/types'

/* ################ V3 functions  ################ */
export const unsubscribeswapevents: ZZServiceHandler = async (
  api,
  ws,
  // eslint-disable-next-line no-empty-pattern
  []
) => {
  ws.swapEventSubscription = null

  const successMsg: WSMessage = {
    op: 'unsubscribeswapevents',
    args: ['success'],
  }
  ws.send(JSON.stringify(successMsg))
}
