import type { ZZServiceHandler } from 'src/types'

export const dailyvolumereq: ZZServiceHandler = async (
  api,
  ws,
  [chainId]
) => {
  const historicalVolume = await api.dailyVolumes(chainId)
  const dailyVolumeMsg = { op: 'dailyvolume', args: [historicalVolume] }
  if (ws) ws.send(JSON.stringify(dailyVolumeMsg))
  return dailyVolumeMsg
}
