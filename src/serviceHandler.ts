// SPDX-License-Identifier: BUSL-1.1
import * as services from 'src/services'
import type { WSMessage, WSocket } from 'src/types'
import type API from 'src/api'

export default function serviceHandler(msg: WSMessage, api: API, ws?: WSocket): any {
    if (Object.prototype.hasOwnProperty.call(services, msg.op)) {
        console.error(`Operation failed: ${msg.op}`)
        return false
    }

    return (services as any)[msg.op].apply(ws, [ws, api, Array.isArray(msg.args) ? msg.args : []])
}