// SPDX-License-Identifier: BUSL-1.1
import * as Redis from 'redis'

const redis_url = process.env.REDIS_URL || 'redis://0.0.0.0:6379'
const redis_use_tls = redis_url.includes('rediss')

const redis = Redis.createClient({
  url: redis_url,
  socket: {
    tls: redis_use_tls,
    rejectUnauthorized: false,
  },
})

redis.on('error', (err: Error) => console.log('Redis Client Error', err))

export default redis