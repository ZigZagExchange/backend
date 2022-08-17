// SPDX-License-Identifier: BUSL-1.1
import * as Redis from 'redis'

const redisUrl = process.env.redisUrl || 'redis://0.0.0.0:6379'
const redisUseTLS = redisUrl.includes('rediss')

export const redis = Redis.createClient({
  url: redisUrl,
  socket: {
    tls: redisUseTLS,
    rejectUnauthorized: false,
  },
}).on('error', (err: Error) => console.log('Redis Client Error', err))

export const subscriber = Redis.createClient({
  url: redisUrl,
  socket: {
    tls: redisUseTLS,
    rejectUnauthorized: false,
  },
}).on('error', (err: Error) => console.log('Redis Subscriber Error', err))

export const publisher = Redis.createClient({
  url: redisUrl,
  socket: {
    tls: redisUseTLS,
    rejectUnauthorized: false,
  },
}).on('error', (err: Error) => console.log('Redis Publisher Error', err))
