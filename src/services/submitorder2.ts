import type { WSMessage, ZZServiceHandler } from 'src/types'

export const submitorder2: ZZServiceHandler = async (
  api,
  ws,
  [chainId, market, zktx]
) => {
  let msg: WSMessage
  try {
    if (api.VALID_CHAINS_ZKSYNC.includes(chainId)) {
      msg = await api.processorderzksync(chainId, market, zktx)
    } else {
      msg = { op: 'error', args: ['submitorder2', `'${chainId}' is an invalid chainId`] }
    }
  } catch (err: any) {
    console.error(err)
    msg = { op: 'error', args: ['submitorder2', err.message] }
  }

  if (ws) ws.send(JSON.stringify(msg))
  // submitorder2 only returns the args and should no longer be used
  return msg.args
}
