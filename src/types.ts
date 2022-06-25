// SPDX-License-Identifier: BUSL-1.1
import type { Application } from 'express'
import type { WebSocket, WebSocketServer } from 'ws'
import type API from 'src/api'

export type AnyObject = { [key: string | number]: any }

export type ZZMarket = string

export type ZZMarketInfo = {
  [key: string]: any
}

export type ZZFillOrder = {
  amount: number
  accountId: string
}

export type ZZMarketSide = 'b' | 's'

export type WSocket = WebSocket & {
  uuid: string
  isAlive: boolean
  marketSubscriptions: ZZMarket[]
  chainid: number
  userid: string
}

export type ZZAPITransport = { api: API }
export type ZZServiceHandler = (api: API, ws: WSocket, args: any[]) => any
export type ZZSocketServer = WebSocketServer & ZZAPITransport
export type ZZHttpServer = Application & ZZAPITransport

export type ZkTx = {
  accountId: string
  tokenSell: string
  tokenBuy: string
  nonce: string
  ratio: [number, number]
  amount: number
  validUntil: number
}

export type WSMessage = {
  op: string
  args: any[]
}

export type ZZMarketSummary = {
  market: string
  baseSymbol: string
  quoteSymbol: string
  lastPrice: number
  lowestAsk: number
  highestBid: number
  baseVolume: number
  quoteVolume: number
  priceChange: number
  priceChangePercent_24h: number
  highestPrice_24h: number
  lowestPrice_24h: number
}

export type ZZOrder = {
  makerAddress: string
  makerToken: string
  takerToken: string
  feeRecipientAddress: string
  makerAssetAmount: string
  takerAssetAmount: string
  makerVolumeFee: string
  takerVolumeFee: string
  gasFee: string
  expirationTimeSeconds: string
  salt: string
  signature?: string
}
