import type { ZZServiceHandler } from 'src/types'

const BLACKLIST = process.env.BLACKLIST || ''

export const fillrequest: ZZServiceHandler = async (
  api,
  ws,
  [chainId, orderId, fillOrder]
) => {
  if (!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', args: ['fillrequest', `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`] }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return
  }

  const makerUserId = fillOrder.accountId.toString()
  const blacklistedAccounts = BLACKLIST.split(',')
  if (blacklistedAccounts.includes(makerUserId)) {
    ws.send(
      JSON.stringify({
        op: 'error',
        args: [
          'fillrequest',
          makerUserId,
          "You're running a bad version of the market maker. Please run git pull to update your code.",
        ],
      })
    )
    console.log('fillrequest - return blacklisted market maker.')
    return
  }

  try {
    await api.matchorder(chainId, orderId, fillOrder, ws.uuid)
  } catch (err: any) {
    console.log(err.message)
    ws.send(JSON.stringify({ op: 'error', args: ['fillrequest', makerUserId, err.message] }))
  }
}
