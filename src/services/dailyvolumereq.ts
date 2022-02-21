import type { ZZServiceHandler } from 'src/types'

export const dailyvolumereq: ZZServiceHandler = async (api, ws, [chainid]) => {
  const historicalVolume = await api.dailyVolumes(chainid)
  const dailyVolumeMsg = { op: 'dailyvolume', args: [historicalVolume] }
  if (ws) ws.send(JSON.stringify(dailyVolumeMsg))
  return dailyVolumeMsg
}
