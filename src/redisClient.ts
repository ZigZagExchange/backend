// SPDX-License-Identifier: BUSL-1.1
import * as Redis from 'redis'

const redis_url = process.env.REDIS_URL || 'redis://0.0.0.0:6379'
const redis_use_tls = redis_url.includes('rediss')

export const redis = Redis.createClient({
  url: redis_url,
  socket: {
    tls: redis_use_tls,
    rejectUnauthorized: false,
  },
}).on('error', (err: Error) => console.log('Redis Client Error', err))

export const subscriber = Redis.createClient({
  url: redis_url,
  socket: {
    tls: redis_use_tls,
    rejectUnauthorized: false,
  },
}).on('error', (err: Error) => console.log('Redis Subscriber Error', err))

export const publisher = Redis.createClient({
  url: redis_url,
  socket: {
    tls: redis_use_tls,
    rejectUnauthorized: false,
  },
}).on('error', (err: Error) => console.log('Redis Publisher Error', err))
