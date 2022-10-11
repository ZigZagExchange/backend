import type { ZZServiceHandler } from 'src/types'

// Exact same thing as submitorder4 but it allows for multiple orders at the same time
// Returns:
//   {"op":"userorderack","args":[[1002,4734,"USDC-USDT","b",1.0015431034482758,127.6,127.7969,1646051432,"1285612","o",null,127.6], [1002,4734,"USDC-USDT","b",1.0015431034482758,127.6,127.7969,1646051432,"1285612","o",null,127.6]]}
export const submitorder4: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, zktxArray, oldOrderArray]
) => {
  if (!api.VALID_EVM_CHAINS.includes(chainId)) {
    const errorMsg = {
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
    const errorMsg = {
      op: 'error',
      args: ['submitorder4', 'Argument is no array'],
    }
    ws.send(JSON.stringify(errorMsg))
    return
  }

  if (oldOrderArray) {
    try {
      const results: Promise<any>[] = oldOrderArray.map(
        async (oldOrderEntry: any) => {
          const [orderId, signature] = oldOrderEntry
          if (!orderId || !signature)
            throw new Error(
              `The argument ${oldOrderEntry} is wrongly formatted, use [orderId, signedMessage]`
            )
          await api.cancelorder2(chainId, orderId, signature)
        }
      )
      await Promise.all(results)
    } catch (err: any) {
      console.error(`Failed to cancel old orders, ${err.message}`)
      const errorMsg = {
        op: 'error',
        args: ['submitorder4', `Failed to cancel old orders, ${err.message}`],
      }
      ws.send(JSON.stringify(errorMsg))
      return
    }
  }

  const msg: any[] = []
  // only for EVM chains, check line 11
  const results: Promise<any>[] = zktxArray.map(async (zktx: any) => {
    try {
      msg.push(await api.processOrderEVM(chainId, market, zktx))
    } catch (err: any) {
      console.error(`Failed to place new order, ${err.message}`)
      const errorMsg = {
        op: 'error',
        args: ['submitorder4', `Failed to place new order, ${err.message}`],
      }
      ws.send(JSON.stringify(errorMsg))
    }
  })
  await Promise.all(results)

  ws.send(JSON.stringify(msg))
}
