import type { ZZServiceHandler } from 'src/types'

const BLACKLIST = process.env.BLACKLIST || ''

export const fillrequest: ZZServiceHandler = async (
  api,
  ws,
  [chainid, orderId, fillOrder]
) => {
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
    await api.matchorder(chainid, orderId, fillOrder, ws)    
  } catch (err: any) {
    console.log(err)
    ws.send(JSON.stringify({ op: 'error', args: ['fillrequest', maker_user_id, err.message] }))
  }
}
