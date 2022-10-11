import type { ZZServiceHandler } from 'src/types'

export const cancelorder: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId]
) => {
  const errorMsg = {
    op: 'error',
    args: [
      'cancelorder',
      `cancelorder is no longer supported. Use cancelorder2 or cancelorder3. Docs: https://github.com/ZigZagExchange/backend#operation-cancelorder2`,
    ],
  }
  ws.send(JSON.stringify(errorMsg))
  console.log(`Error, cancelorder for ${chainId}:${orderId} is no longer supported.`)
}
