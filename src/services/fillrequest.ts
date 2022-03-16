import type { ZZServiceHandler } from 'src/types'

const BLACKLIST = process.env.BLACKLIST || ''

export const fillrequest: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId, fillOrder]
) => {
  if(!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', message: `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}` }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return
  }
  
  const maker_user_id = fillOrder.accountId.toString()
  const blacklisted_accounts = BLACKLIST.split(',')
  if (blacklisted_accounts.includes(maker_user_id)) {
    ws.send(
      JSON.stringify({
        op: 'error',
        args: [
          'fillrequest',
          maker_user_id,
          "You're running a bad version of the market maker. Please run git pull to update your code.",
        ],
      })
    )
    console.log('fillrequest - return blacklisted market maker.')
    return
  }

  try {
    await api.matchorder(chainId, orderId, fillOrder, ws)    
  } catch (err: any) {
    console.log(err)
    ws.send(JSON.stringify({ op: 'error', args: ['fillrequest', maker_user_id, err.message] }))
  }
}
