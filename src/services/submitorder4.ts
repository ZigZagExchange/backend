import type { WSMessage, ZZOrder, ZZServiceHandler } from 'src/types'

// Exact same thing as submitorder4 but it allows for multiple orders at the same time
// Returns:
//   {"op":"userorderack","args":[[1002,4734,"USDC-USDT","b",1.0015431034482758,127.6,127.7969,1646051432,"1285612","o",null,127.6], [1002,4734,"USDC-USDT","b",1.0015431034482758,127.6,127.7969,1646051432,"1285612","o",null,127.6]]}
export const submitorder4: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, zktxArray, oldOrderArray]
) => {
  if (!api.VALID_EVM_CHAINS.includes(chainId)) {
    const errorMsg: WSMessage = {
      op: 'error',
      args: [
        'submitorder4',
        `${chainId} is not a valid EVM chain id. Use ${api.VALID_EVM_CHAINS}`,
      ],
    }
    console.log(`Error, ${chainId} is not a valid chain id.`)
    ws.send(JSON.stringify(errorMsg))
    return
  }

  if (
    !Array.isArray(zktxArray) ||
    (oldOrderArray && !Array.isArray(oldOrderArray))
  ) {
    console.error('submitorder4, argument is no array')
    const errorMsg: WSMessage = {
      op: 'error',
      args: ['submitorder4', 'Argument is no array'],
    }
    ws.send(JSON.stringify(errorMsg))
    return
  }

  if (oldOrderArray) {
    console.log(oldOrderArray)
    await Promise.all(
      oldOrderArray.map(async (oldOrderEntry: [number, string]) => {
        try {
          const [orderId, signature] = oldOrderEntry
          if (!orderId || !signature)
            throw new Error(
              `The argument ${oldOrderEntry} is wrongly formatted, use [orderId, signedMessage]`
            )
          const cancelResult: boolean = await api.cancelorder2(
            chainId,
            orderId,
            signature
          )
          if (!cancelResult) throw new Error('Unexpected error')
        } catch (err: any) {
          console.error(`Failed to cancel old orders, ${err.message}`)
          const errorMsg: WSMessage = {
            op: 'error',
            args: [
              'submitorder4',
              `Failed to cancel old orders, ${err.message}`,
            ],
          }
          ws.send(JSON.stringify(errorMsg))
        }
      })
    )
  }

  // only for EVM chains, check line 11
  await Promise.all(
    zktxArray.map(async (zktx: ZZOrder) => {
      try {
        const msg: WSMessage = await api.processOrderEVM(chainId, market, zktx)
        ws.send(JSON.stringify(msg))
      } catch (err: any) {
        console.error(`Failed to place new order, ${err.message}`)
        const errorMsg: WSMessage = {
          op: 'error',
          args: ['submitorder4', `Failed to place new order, ${err.message}`],
        }
        ws.send(JSON.stringify(errorMsg))
      }
    })
  )
}
