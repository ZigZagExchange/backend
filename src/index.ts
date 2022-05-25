#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
import { createHttpServer } from 'src/httpServer'
import { createSocketServer } from 'src/socketServer'
import { redis, subscriber, publisher } from 'src/redisClient'
import db from 'src/db'
import API from 'src/api'
import type { RedisClientType } from 'redis'
import throng, { WorkerCount } from 'throng'

const socketServer = createSocketServer()
const httpServer = createHttpServer(socketServer)


function start () {
  const port = Number(process.env.PORT) || 3004
  const api = new API(
    socketServer as any,
    db,
    httpServer,
    redis as RedisClientType,
    subscriber as RedisClientType,
    publisher as RedisClientType
  )
  
  api.start(port).then(() => {
    console.log('Successfully started server.')
  })
}

let  WORKERS = Number(process.env.WEB_CONCURRENCY)
if (!WORKERS || Number.isNaN(WORKERS)) WORKERS = 2


throng({
  worker: start,
  count: WORKERS,
  lifetime: Infinity
})
