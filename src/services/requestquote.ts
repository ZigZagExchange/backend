import type { ZZServiceHandler } from 'src/types'

export const requestquote: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, side, baseQuantity = null, quoteQuantity = null]
): Promise<any> => {
  if (!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', args: ['requestquote', `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`] }
    if (ws) ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return errorMsg
  }

  let quoteMessage
  try {
    const quote = await api.genquote(
      chainId,
      market,
      side,
      baseQuantity,
      quoteQuantity
    )

    quoteMessage = {
      op: 'quote',
      args: [
        chainId,
        market,
        side,
        quote.softBaseQuantity,
        quote.softPrice,
        quote.softQuoteQuantity,
      ],
    }
  } catch (e: any) {
    console.error(e.message)
    quoteMessage = { op: 'error', args: ['requestquote', e.message] }
  }

  if (ws) {
    ws.send(JSON.stringify(quoteMessage))
  }

  return quoteMessage
}
