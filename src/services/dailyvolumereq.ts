import type { ZZServiceHandler } from 'src/types'

export const dailyvolumereq: ZZServiceHandler = async (
  api,
  ws,
  [chainId]
) => {
  if(!api.VALID_CHAINS.includes(chainId)) {
    const errorMsg = { op: 'error', args: ['dailyvolumereq', `${chainId} is not a valid chain id. Use ${api.VALID_CHAINS}`] }
    ws.send(JSON.stringify(errorMsg))
    console.log(`Error, ${chainId} is not a valid chain id.`)
    return null
  }
  
  const historicalVolume = await api.dailyVolumes(chainId)
  const dailyVolumeMsg = { op: 'dailyvolume', args: [historicalVolume] }
  if (ws) ws.send(JSON.stringify(dailyVolumeMsg))
  return dailyVolumeMsg
}
