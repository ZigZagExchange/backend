import type { ZZServiceHandler } from 'src/types'

export const cancelall: ZZServiceHandler = async (
  api,
  ws,
  [chainId, userid]
) => {
  if (
    !api.VALID_CHAINS.includes(chainId) ||
    Number(chainId) === 0
  ) {
    const errorMsg = { op: 'error', args: ['cancelall', `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS} or 0 to cancel on all networks`] }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return
  }

  const userconnkey = `${chainId}:${userid}`
  if (api.USER_CONNECTIONS[userconnkey] !== ws) {
    ws.send(
      JSON.stringify({
        op: 'error',
        args: ['cancelall', 'Unauthorized', userid],
      })
    )
    return
  }
  try {
    const cancelresult = await api.cancelallorders(chainId, userid)
    if (!cancelresult) throw new Error('Unexpected error')
  } catch (e: any) {
    ws.send(
      JSON.stringify({ op: 'error', args: ['cancelall', e.message, userid] })
    )
  }
}
