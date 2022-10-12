import type { WSMessage, ZZServiceHandler } from 'src/types'

export const login: ZZServiceHandler = async (api, ws, [chainId, userId]) => {
  if (!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg: WSMessage = {
      op: 'error',
      args: [
        'login',
        `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`,
      ],
    }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return
  }

  ws.chainId = chainId
  ws.userId = userId
  const userconnkey = `${chainId}:${userId}`
  api.USER_CONNECTIONS[userconnkey] = ws
  const userorders = await api.getuserorders(chainId, userId)
  const userfills = await api.getuserfills(chainId, userId)
  ws.send(JSON.stringify({ op: 'orders', args: [userorders] }))
  ws.send(JSON.stringify({ op: 'fills', args: [userfills] }))
}
