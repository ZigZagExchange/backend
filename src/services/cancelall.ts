import type { WSMessage, ZZServiceHandler } from 'src/types'

export const cancelall: ZZServiceHandler = async (
  api,
  ws,
  [chainId, userId]
) => {
  
  const errorMsg: WSMessage = {
    op: 'error',
    args: [
      'cancelorder',
      `cancelall is no longer supported. Use cancelall2 or cancelall3. Docs: https://github.com/ZigZagExchange/backend#operation-cancelall2`,
    ],
  }
  ws.send(JSON.stringify(errorMsg))
  console.log(`Error, cancelall for ${chainId}:${userId} is no longer supported.`)
}
