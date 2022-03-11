import type { ZZServiceHandler } from 'src/types'

export const requestquote: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, side, baseQuantity = null, quoteQuantity = null]
): Promise<any> => {

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
    console.error(e)
    quoteMessage = { op: 'error', args: ['requestquote', e.message] }
  }
  
  if (ws) {
    ws.send(JSON.stringify(quoteMessage))
  }

  return quoteMessage
}
