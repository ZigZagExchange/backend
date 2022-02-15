import type { ZZServiceHandler } from 'src/types'

export const login: ZZServiceHandler = async (api, ws, [chainid, userid]) => {
  ws.chainid = chainid
  ws.userid = userid
  const userconnkey = `${chainid}:${userid}`
  api.USER_CONNECTIONS[userconnkey] = ws
  const userorders = await api.getuserorders(chainid, userid)
  const userfills = await api.getuserfills(chainid, userid)
  ws.send(JSON.stringify({ op: 'orders', args: [userorders] }))
  ws.send(JSON.stringify({ op: 'fills', args: [userfills] }))
}
