#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
import { createHttpServer } from 'src/httpServer'
import { createSocketServer } from 'src/socketServer'
import redis from 'src/redisClient'
import db from 'src/db'
import API from 'src/api'
import type { RedisClientType } from 'redis'


const socketServer = createSocketServer()
const httpServer = createHttpServer(socketServer)

const port = Number(process.env.PORT) || 3004
const api = new API(socketServer, db, httpServer, redis as RedisClientType)

api.start(port).then(() => {
    console.log('Successfully started server.')
})