// SPDX-License-Identifier: BUSL-1.1
import { ethers } from 'ethers'
import fetch from 'isomorphic-fetch'
import { EventEmitter } from 'events'
import { zksyncOrderSchema, EVMOrderSchema } from 'src/schemas'
import { WebSocket } from 'ws'
import fs from 'fs'
import * as zksync from 'zksync'
import * as starknet from 'starknet'
import type { Pool } from 'pg'
import type { RedisClientType } from 'redis'
import * as services from 'src/services'
import type {
  ZkTx,
  WSocket,
  WSMessage,
  ZZMarketInfo,
  ZZMarketSide,
  ZZFillOrder,
  AnyObject,
  ZZMarket,
  ZZHttpServer,
  ZZSocketServer,
  ZZMarketSummary,
  ZZOrder,
} from 'src/types'
import {
  formatPrice,
  getNetwork,
  getRPCURL,
  getERC20Info,
  getNewToken,
} from 'src/utils'
import {
  getEvmEIP712Types,
  modifyOldSignature,
  verifyMessage,
} from 'src/cryptography'

export default class API extends EventEmitter {
  USER_CONNECTIONS: AnyObject = {}
  MAKER_CONNECTIONS: AnyObject = {}
  SYNC_PROVIDER: AnyObject = {}
  ETHERS_PROVIDERS: AnyObject = {}
  STARKNET_EXCHANGE: AnyObject = {}
  MARKET_MAKER_TIMEOUT = 300
  VALID_CHAINS: number[] = process.env.VALID_CHAINS
    ? JSON.parse(process.env.VALID_CHAINS)
    : [1, 1002, 1001, 42161, 421613]
  VALID_CHAINS_ZKSYNC: number[] = this.VALID_CHAINS.filter((chainId) =>
    [1, 1002].includes(chainId)
  )
  VALID_EVM_CHAINS: number[] = this.VALID_CHAINS.filter((chainId) =>
    [42161, 421613].includes(chainId)
  )
  EVMConfig: any
  ERC20_ABI: any
  ZKSYNC_BASE_URL: AnyObject = {}

  watchers: NodeJS.Timer[] = []
  started = false
  wss: ZZSocketServer
  redis: RedisClientType
  redisSubscriber: any
  redisPublisher: any
  http: ZZHttpServer
  db: Pool

  constructor(
    wss: ZZSocketServer,
    db: Pool,
    http: ZZHttpServer,
    redis: RedisClientType,
    subscriber: RedisClientType,
    publisher: RedisClientType
  ) {
    super()
    this.db = db
    this.redis = redis
    this.redisSubscriber = subscriber
    this.redisPublisher = publisher
    this.http = http
    this.wss = wss
    this.http.api = this
    this.wss.api = this
  }

  serviceHandler = (msg: WSMessage, ws?: WSocket): any => {
    if (msg.op === 'ping') {
      return false
    }
    if (!Object.prototype.hasOwnProperty.call(services, msg.op)) {
      console.error(`Operation failed: ${msg.op}`)
      return false
    }
    try {
      return (services as any)[msg.op].apply(this, [
        this,
        ws,
        Array.isArray(msg.args) ? msg.args : [],
      ])
    } catch (e: any) {
      console.error(`Operation failed: ${msg.op} because ${e.message}`)
      return false
    }
  }

  start = async (port: number) => {
    if (this.started) return
    this.started = true

    this.ZKSYNC_BASE_URL.mainnet = 'https://api.zksync.io/api/v0.2/'
    this.ZKSYNC_BASE_URL.goerli = 'https://goerli-api.zksync.io/api/v0.2/'

    await this.redis.connect()
    await this.redisSubscriber.connect()
    await this.redisPublisher.connect()

    this.ERC20_ABI = JSON.parse(fs.readFileSync('abi/ERC20.abi', 'utf8'))
    this.EVMConfig = JSON.parse(fs.readFileSync('EVMConfig.json', 'utf8'))
    const starknetContractABI = JSON.parse(
      fs.readFileSync('abi/starknet_v1.abi', 'utf8')
    )

    // connect infura providers
    this.VALID_EVM_CHAINS.forEach((chainId) => {
      try {
        if (this.ETHERS_PROVIDERS[chainId]) return
        try {
          this.ETHERS_PROVIDERS[chainId] = new ethers.providers.InfuraProvider(
            getNetwork(chainId),
            process.env.INFURA_PROJECT_ID
          )
          console.log(`Connected InfuraProvider for ${chainId}`)
        } catch (e: any) {
          console.warn(
            `Could not connect InfuraProvider for ${chainId}, trying RPC...`
          )
          this.ETHERS_PROVIDERS[chainId] = new ethers.providers.JsonRpcProvider(
            getRPCURL(chainId)
          )
          console.log(`Connected JsonRpcProvider for ${chainId}`)
        }
      } catch (e: any) {
        console.log(`Failed to setup ${chainId}. Disabling...`)
        const indexA = this.VALID_CHAINS.indexOf(chainId)
        this.VALID_CHAINS.splice(indexA, 1)
        const indexB = this.VALID_EVM_CHAINS.indexOf(chainId)
        this.VALID_EVM_CHAINS.splice(indexB, 1)
      }
    })

    // setup provider
    if (!process.env.STARKNET_CONTRACT_ADDRESS)
      throw new Error('process.env.STARKNET_CONTRACT_ADDRESS not set!')
    this.STARKNET_EXCHANGE.goerli = new starknet.Contract(
      starknetContractABI,
      process.env.STARKNET_CONTRACT_ADDRESS
    )

    try {
      this.SYNC_PROVIDER.mainnet = await zksync.getDefaultRestProvider(
        'mainnet'
      )
    } catch (e: any) {
      console.log('Failed to setup 1. Disabling...')
      const indexA = this.VALID_CHAINS.indexOf(1)
      this.VALID_CHAINS.splice(indexA, 1)
      const indexB = this.VALID_CHAINS_ZKSYNC.indexOf(1)
      this.VALID_CHAINS_ZKSYNC.splice(indexB, 1)
    }
    try {
      this.SYNC_PROVIDER.goerli = await zksync.getDefaultRestProvider('goerli')
    } catch (e: any) {
      console.log('Failed to setup 1002. Disabling...')
      const indexA = this.VALID_CHAINS.indexOf(1002)
      this.VALID_CHAINS.splice(indexA, 1)
      const indexB = this.VALID_CHAINS_ZKSYNC.indexOf(1002)
      this.VALID_CHAINS_ZKSYNC.splice(indexB, 1)
    }

    // setup redisSubscriber
    this.redisSubscriber.PSUBSCRIBE(
      'broadcastmsg:*',
      (message: string, channel: string) => {
        const channelArgs = channel.split(':')
        if (channelArgs.length !== 4) {
          console.error(`redisSubscriber wrong channel format: ${channel}`)
          return
        }
        const op = channelArgs[0]
        const broadcastChannel = channelArgs[1]
        const chainId = Number(channelArgs[2])
        const target = channelArgs[3]

        if (!this.VALID_CHAINS.includes(chainId)) {
          console.error(`redisSubscriber wrong chainId: ${chainId}`)
          return
        }
        if (op !== 'broadcastmsg') throw new Error('Sanity check failed.')
        if (broadcastChannel === 'user') {
          this.sendMessageToUser(chainId, target, message)
        } else if (broadcastChannel === 'all') {
          this.broadcastMessage(chainId, target, message)
        } else if (broadcastChannel === 'maker') {
          this.sendMessageToMM(chainId, target, message)
        } else if (broadcastChannel === 'swap_event') {
          this.sendSwapEventV3(chainId, target, message)
        } else {
          console.error(
            `redisSubscriber wrong broadcastChannel: ${broadcastChannel}`
          )
        }
      }
    )

    this.watchers = [
      setInterval(this.clearDeadConnections, 30000),
      setInterval(this.broadcastLiquidity, 10000),
      setInterval(this.broadcastLastPrice, 10000),
    ]

    this.started = true

    this.http.listen(port, () => {
      console.log(`Server listening on port ${port}.`)
    })
  }

  stop = async () => {
    if (!this.started) return
    await this.redis.disconnect()
    await this.redisSubscriber.disconnect()
    await this.redisPublisher.disconnect()
    this.watchers.forEach((watcher) => clearInterval(watcher))
    this.watchers = []
    this.started = false
  }

  /**
   * Get default market info from Arweave
   * @param market market alias or marketId
   * @returns
   */
  getDefaultValuesFromArweave = async (chainId: number, market: string) => {
    let marketInfo = null
    let marketArweaveId: string
    try {
      // get marketArweaveId
      if (market.length > 19) {
        marketArweaveId = market
      } else {
        const select = await this.db.query(
          'SELECT marketid FROM marketids WHERE marketAlias = $1 AND chainid = $2',
          [market, chainId]
        )
        if (select.rows.length === 0) {
          return marketInfo
        }
        marketArweaveId = select.rows[0].marketid
      }

      // get arweave default marketinfo
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 15000)
      console.log(`Arweave request ${`https://arweave.net/${marketArweaveId}`}`)
      const fetchResult = await fetch(
        `https://arweave.net/${marketArweaveId}`,
        {
          signal: controller.signal,
        }
      ).then((r: any) => r.json())
      console.log(`Arweave result: ${fetchResult}`)

      if (!fetchResult) return marketInfo
      marketInfo = fetchResult
    } catch (err: any) {
      console.error(
        `Can't fetch update default marketInfo for ${market}, Error ${err.message}`
      )
    }
    return marketInfo
  }

  /**
   * get marketInfo for a given marketAlias or marketId
   * @param market marketAlias or marketId
   * @param chainId
   * @returns marketInfo as ZZMarketInfo
   */
  getMarketInfo = async (
    market: ZZMarket,
    chainId: number
  ): Promise<ZZMarketInfo> => {
    if (!this.VALID_CHAINS.includes(chainId))
      throw new Error('No valid chainId')
    if (!market) throw new Error('Bad market')

    const redisKeyMarketInfo = `marketinfo:${chainId}`
    const cache = await this.redis.HGET(redisKeyMarketInfo, market)

    if (cache) {
      return JSON.parse(cache) as ZZMarketInfo
    }

    let marketInfoDefaults: any = {}
    if (this.VALID_CHAINS_ZKSYNC.includes(chainId)) {
      marketInfoDefaults = await this.getDefaultValuesFromArweave(
        chainId,
        market
      )
      if (
        !marketInfoDefaults ||
        Number(marketInfoDefaults.zigzagChainId) !== chainId
      ) {
        console.log(`getDefaultValuesFromArweave error: ${marketInfoDefaults}`)
        throw new Error(
          `Can't get marketInfo for market: ${market} and chainId: ${chainId}`
        )
      }
    }

    const marketInfo: ZZMarketInfo = {}
    marketInfo.zigzagChainId = chainId
    let baseTokenLike: any
    let quoteTokenLike: any
    if (this.VALID_CHAINS_ZKSYNC.includes(chainId)) {
      if (market.length > 19) {
        const network = getNetwork(chainId)
        baseTokenLike = await this.SYNC_PROVIDER[
          network
        ].tokenSet.resolveTokenSymbol(marketInfoDefaults.baseAssetId)
        quoteTokenLike = await this.SYNC_PROVIDER[
          network
        ].tokenSet.resolveTokenSymbol(marketInfoDefaults.quoteAssetId)
      } else {
        ;[baseTokenLike, quoteTokenLike] = market.split('-')
      }

      if (baseTokenLike.includes('ERC20'))
        throw new Error(
          'Your base token has no symbol on zkSync. Please contact ZigZag or zkSync to get it listed properly. You can also check here: https://zkscan.io/explorer/tokens'
        )
      if (quoteTokenLike.includes('ERC20'))
        throw new Error(
          'Your quote token has no symbol on zkSync. Please contact ZigZag or zkSync to get it listed properly. You can also check here: https://zkscan.io/explorer/tokens'
        )
    } else if (this.VALID_EVM_CHAINS.includes(chainId)) {
      ;[baseTokenLike, quoteTokenLike] = market.split('-')
    } else {
      console.log(`Listing market, bad chain ${chainId}`)
      throw new Error('Bad chainId')
    }

    let baseAsset: any
    let quoteAsset: any
    try {
      baseAsset = await this.getTokenInfo(chainId, baseTokenLike)
    } catch (e: any) {
      console.log(
        `Base asset ${baseTokenLike} no valid ERC20 token, error: ${e.message}`
      )
      throw new Error('Base asset no valid ERC20 token')
    }
    try {
      quoteAsset = await this.getTokenInfo(chainId, quoteTokenLike)
    } catch (e: any) {
      console.log(
        `Quote asset ${quoteAsset} no valid ERC20 token, error: ${e.message}`
      )
      throw new Error('Quote asset no valid ERC20 token')
    }

    /* update token fee */
    const [baseFee, quoteFee] = await Promise.all([
      this.redis.HGET(`tokenfee:${chainId}`, baseAsset.symbol),
      this.redis.HGET(`tokenfee:${chainId}`, quoteAsset.symbol),
    ])

    // set fee, use arewave fees as fallback
    marketInfo.baseFee = baseFee
      ? Number(baseFee)
      : Number(marketInfoDefaults?.baseFee)
    marketInfo.quoteFee = quoteFee
      ? Number(quoteFee)
      : Number(marketInfoDefaults?.quoteFee)
    marketInfo.baseAssetId = baseAsset.id
    marketInfo.quoteAssetId = quoteAsset.id

    if (this.VALID_EVM_CHAINS.includes(chainId)) {
      marketInfo.exchangeAddress = this.EVMConfig[chainId].exchangeAddress
    }

    // set tradingViewChart, use binance as fallback
    marketInfo.tradingViewChart = marketInfoDefaults?.tradingViewChart
      ? marketInfoDefaults.tradingViewChart
      : `${baseAsset.symbol}${quoteAsset.symbol}`
    // set pricePrecisionDecimal, use min decimals as fallback
    marketInfo.pricePrecisionDecimal = marketInfoDefaults?.pricePrecisionDecimal
      ? marketInfoDefaults.pricePrecisionDecimal
      : Math.min(baseAsset.decimals, quoteAsset.decimals)
    marketInfo.baseAsset = baseAsset
    marketInfo.quoteAsset = quoteAsset
    marketInfo.alias = `${baseAsset.symbol}-${quoteAsset.symbol}`

    // update redis infos
    await this.redis.HSET(
      redisKeyMarketInfo,
      marketInfo.alias,
      JSON.stringify(marketInfo)
    )
    await this.redis.HSET(
      redisKeyMarketInfo,
      market,
      JSON.stringify(marketInfo)
    )

    // return if alias
    if (market.length < 19 || this.VALID_EVM_CHAINS.includes(chainId))
      return marketInfo

    // update marketArweaveId in SQL
    try {
      await this.db.query(
        `INSERT INTO marketids (marketid, chainid, marketalias) VALUES($1, $2, $3) ON CONFLICT (marketalias) DO UPDATE SET marketid = EXCLUDED.marketid`,
        [market, chainId, marketInfo.alias] // market is the id in this case, as market > 19
      )
    } catch (err) {
      console.error(
        `Failed to update SQL for ${marketInfo.alias} SET id = ${market}`
      )
    }
    return marketInfo
  }

  getTokenInfo = async (chainId: number, tokenLike: string) => {
    let tokenInfo: any
    const cache = await this.redis.HGET(`tokeninfo:${chainId}`, tokenLike)
    if (cache) {
      tokenInfo = JSON.parse(cache)
      return tokenInfo
    }

    if (this.VALID_CHAINS_ZKSYNC.includes(chainId)) {
      const assetString = await this.redis.HGET(
        `tokeninfo:${chainId}`,
        tokenLike
      )

      if (!assetString) throw new Error('Unknown asset.')
      tokenInfo = JSON.parse(assetString) as AnyObject
    } else if (this.VALID_EVM_CHAINS.includes(chainId)) {
      if (tokenLike.length < 20) throw new Error('Use token address')

      try {
        tokenInfo = await getERC20Info(
          this.ETHERS_PROVIDERS[chainId],
          tokenLike,
          this.ERC20_ABI
        )
      } catch (e: any) {
        console.log(
          `Error getting ERC20 infos for ${tokenLike}, error: ${e.message}`
        )
        throw new Error('Asset no valid ERC20 token')
      }
      tokenInfo.id = tokenInfo.address
    } else {
      console.log(`getTokenInfo bad chain ${chainId}`)
      throw new Error('Bad chainId')
    }

    // update cache
    await this.redis.HSET(
      `tokeninfo:${chainId}`,
      tokenInfo.symbol,
      JSON.stringify(tokenInfo)
    )
    await this.redis.HSET(
      `tokeninfo:${chainId}`,
      tokenInfo.address,
      JSON.stringify(tokenInfo)
    )
    return tokenInfo
  }

  updateOrderFillStatus = async (
    chainId: number,
    orderid: number,
    newstatus: string,
    txhash: string
  ) => {
    chainId = Number(chainId)
    orderid = Number(orderid)

    if (chainId === 1001) throw new Error('Not for Starknet orders')

    let update
    let fillId
    let market
    let userId
    let fillPrice
    let side
    let makerUserId
    try {
      const valuesOffers = [newstatus, txhash, chainId, orderid]
      update = await this.db.query(
        "UPDATE offers SET order_status=$1, txhash=$2, update_timestamp=NOW() WHERE chainid=$3 AND id=$4 AND order_status IN ('b', 'm') RETURNING side, market, userid",
        valuesOffers
      )
      if (update.rows.length > 0) {
        side = update.rows[0].side
        market = update.rows[0].market
        userId = update.rows[0].userid
      }
    } catch (e) {
      console.error('Error while updateOrderFillStatus offers.')
      console.error(e)
      return false
    }

    let timestamp
    let feeAmount
    let feeToken
    try {
      const marketInfo = await this.getMarketInfo(market, chainId)
      if (marketInfo) {
        if (side === 's') {
          feeAmount = marketInfo.baseFee
          feeToken = marketInfo.baseAsset.symbol
        } else {
          feeAmount = marketInfo.quoteFee
          feeToken = marketInfo.quoteAsset.symbol
        }
      } else {
        feeAmount = 0.5
        feeToken = 'USDC'
      }

      if (newstatus === 'r') {
        feeAmount = 0
      }

      let update2: any
      if (newstatus === 'f') {
        // if filled we use the price set in the zksync tx data
        const network = getNetwork(chainId)
        const fetchResult = await fetch(
          `${this.ZKSYNC_BASE_URL[network]}transactions/0x${txhash}/data`
        ).then((r: any) => r.json())
        let baseAmount: number
        let quoteAmount: number
        if (side === 's') {
          baseAmount = Number(
            ethers.utils.formatUnits(
              fetchResult.result.tx.op.amounts[0],
              marketInfo.baseAsset.decimals
            )
          )
          baseAmount -= marketInfo.baseFee
          quoteAmount = Number(
            ethers.utils.formatUnits(
              fetchResult.result.tx.op.amounts[1],
              marketInfo.quoteAsset.decimals
            )
          )
        } else {
          baseAmount = Number(
            ethers.utils.formatUnits(
              fetchResult.result.tx.op.amounts[1],
              marketInfo.baseAsset.decimals
            )
          )
          quoteAmount = Number(
            ethers.utils.formatUnits(
              fetchResult.result.tx.op.amounts[0],
              marketInfo.quoteAsset.decimals
            )
          )
          quoteAmount -= marketInfo.quoteFee
        }
        const priceWithoutFee = quoteAmount / baseAmount

        const valuesFills = [
          newstatus,
          feeAmount,
          feeToken,
          priceWithoutFee,
          orderid,
          chainId,
        ]
        update2 = await this.db.query(
          "UPDATE fills SET fill_status=$1,feeamount=$2,feetoken=$3,price=$4 WHERE taker_offer_id=$5 AND chainid=$6 AND fill_status IN ('b', 'm') RETURNING id, market, price, amount, maker_user_id, insert_timestamp",
          valuesFills
        )
      } else {
        const valuesFills = [newstatus, feeAmount, feeToken, orderid, chainId]
        update2 = await this.db.query(
          "UPDATE fills SET fill_status=$1,feeamount=$2,feetoken=$3 WHERE taker_offer_id=$4 AND chainid=$5 AND fill_status IN ('b', 'm') RETURNING id, market, price, amount, maker_user_id, insert_timestamp",
          valuesFills
        )
      }

      if (update2.rows.length > 0) {
        fillId = update2.rows[0].id
        fillPrice = update2.rows[0].price
        makerUserId = update2.rows[0].maker_user_id
        timestamp = update2.rows[0].insert_timestamp
      }
    } catch (e) {
      console.error('Error while updateOrderFillStatus fills.')
      console.error(e)
      return false
    }

    const success = update.rowCount > 0
    if (success && ['f', 'pf'].includes(newstatus)) {
      const today = new Date().toISOString().slice(0, 10)
      const redisKeyTodayPrice = `dailyprice:${chainId}:${market}:${today}`
      this.redis.HSET(`lastprices:${chainId}`, `${market}`, `${fillPrice}`)
      this.redis.SET(`${redisKeyTodayPrice}`, `${fillPrice}`, { EX: 604800 })
    }
    return {
      success,
      fillId,
      market,
      fillPrice,
      makerUserId,
      feeAmount,
      feeToken,
      timestamp,
      userId,
    }
  }

  updateMatchedOrder = async (
    chainId: number,
    orderid: number,
    newstatus: string,
    txhash: string
  ) => {
    chainId = Number(chainId)
    orderid = Number(orderid)
    let update
    let fillId
    let market
    const values = [newstatus, txhash, chainId, orderid]
    try {
      update = await this.db.query(
        "UPDATE offers SET order_status=$1, txhash=$2, update_timestamp=NOW() WHERE chainid=$3 AND id=$4 AND order_status='m' RETURNING userid",
        values
      )
    } catch (e) {
      console.error('Error while updateMatchedOrder offers.')
      console.error(e)
      return false
    }

    try {
      const update2 = await this.db.query(
        'UPDATE fills SET fill_status=$1, txhash=$2 WHERE chainid=$3 AND taker_offer_id=$4 RETURNING id, market',
        values
      )
      if (update2.rows.length > 0) {
        fillId = update2.rows[0].id
        market = update2.rows[0].market
      }
    } catch (e) {
      console.error('Error while updateMatchedOrder fills.')
      console.error(e)
      return false
    }

    return { success: update.rowCount > 0, fillId, market }
  }

  processorderzksync = async (
    chainId: number,
    market: ZZMarket,
    zktx: ZkTx
  ) => {
    chainId = Number(chainId)

    const inputValidation = zksyncOrderSchema.validate(zktx)
    if (inputValidation.error) throw inputValidation.error
    if (!this.VALID_CHAINS_ZKSYNC.includes(chainId))
      throw new Error('Only for zkSync')
    if (zktx.validUntil * 1000 < Date.now())
      throw new Error(
        'Wrong expiry: sync your PC clock to the correct time to fix this error'
      )

    // Prevent DOS attacks. Rate limit one order every 3 seconds.
    const redisRateLimitKey = `ratelimit:zksync:${chainId}:${zktx.accountId}`
    const ratelimit = await this.redis.get(redisRateLimitKey)
    if (ratelimit) throw new Error('Only one order per 3 seconds allowed')
    else {
      await this.redis.SET(redisRateLimitKey, '1', { EX: 3 })
    }

    const marketInfo = await this.getMarketInfo(market, chainId)
    let side: ZZMarketSide
    let baseQuantity
    let quoteQuantity
    let price

    if (
      zktx.tokenSell === marketInfo.baseAssetId &&
      zktx.tokenBuy === marketInfo.quoteAssetId
    ) {
      side = 's'
      price =
        zktx.ratio[1] /
        10 ** marketInfo.quoteAsset.decimals /
        (zktx.ratio[0] / 10 ** marketInfo.baseAsset.decimals)
      baseQuantity = zktx.amount / 10 ** marketInfo.baseAsset.decimals
      quoteQuantity = baseQuantity * price
    } else if (
      zktx.tokenSell === marketInfo.quoteAssetId &&
      zktx.tokenBuy === marketInfo.baseAssetId
    ) {
      side = 'b'
      price =
        zktx.ratio[0] /
        10 ** marketInfo.quoteAsset.decimals /
        (zktx.ratio[1] / 10 ** marketInfo.baseAsset.decimals)
      quoteQuantity = zktx.amount / 10 ** marketInfo.quoteAsset.decimals
      baseQuantity =
        ((quoteQuantity / price) as any).toFixed(
          marketInfo.baseAsset.decimals
        ) / 1
    } else {
      throw new Error('Buy/sell tokens do not match market')
    }

    if (side === 's' && baseQuantity < marketInfo.baseFee) {
      throw new Error('Order size inadequate to pay fee')
    }
    if (side === 'b' && quoteQuantity < marketInfo.quoteFee) {
      throw new Error('Order size inadequate to pay fee')
    }
    const orderType = 'limit'
    const expires = zktx.validUntil
    const userid = zktx.accountId
    const token = getNewToken()
    const queryargs = [
      chainId,
      userid,
      zktx.nonce,
      market,
      side,
      price,
      baseQuantity,
      quoteQuantity,
      orderType,
      'o',
      expires,
      JSON.stringify(zktx),
      baseQuantity,
      token,
    ]
    // save order to DB
    const query =
      'INSERT INTO offers(chainid, userid, nonce, market, side, price, base_quantity, quote_quantity, order_type, order_status, expires, zktx, insert_timestamp, unfilled, token) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14) RETURNING id'
    const insert = await this.db.query(query, queryargs)
    const orderId = insert.rows[0].id
    const orderreceipt = [
      chainId,
      orderId,
      market,
      side,
      price,
      baseQuantity,
      quoteQuantity,
      expires,
      userid.toString(),
      'o',
      baseQuantity,
    ]

    // broadcast new order
    this.redisPublisher.PUBLISH(
      `broadcastmsg:all:${chainId}:${market}`,
      JSON.stringify({ op: 'orders', args: [[orderreceipt]] })
    )

    orderreceipt.push(token)
    return { op: 'userorderack', args: orderreceipt }
  }

  cancelorder2 = async (
    chainId: number,
    orderId: number,
    signature: string
  ): Promise<boolean> => {
    const values = [orderId, chainId]
    const select = await this.db.query(
      'SELECT userid, order_status FROM offers WHERE id=$1 AND chainid=$2',
      values
    )

    if (select.rows.length === 0) {
      throw new Error('Order not found')
    }


    // for zksync we need to convert the 0x address to the id
    if (this.VALID_CHAINS_ZKSYNC.includes(chainId)) {
      signature = modifyOldSignature(signature)
      let signerAddress = ethers.utils.verifyMessage(`cancelorder2:${chainId}:${orderId}`, signature)
      const url =
        chainId === 1
          ? `https://api.zksync.io/api/v0.2/accounts/${signerAddress}/committed`
          : `https://goerli-api.zksync.io/api/v0.2/accounts/${signerAddress}/committed`
      const res = (await fetch(url).then((r: any) => r.json())) as AnyObject
      if (!res.result) throw new Error('Unauthorized')
      
      signerAddress = res.result.accountId.toString()
      if (signerAddress !== select.rows[0].userid) throw new Error('Unauthorized')
    } else {
      const res = await verifyMessage({
        signer: select.rows[0].userid as string,
        message: `cancelorder2:${chainId}:${orderId}`,
        signature
      })
      if (!res) throw new Error('Unauthorized')
    }

    if (!['o', 'pf', 'pm'].includes(select.rows[0].order_status)) {
      throw new Error('Order is no longer open')
    }

    const updatevalues = [orderId]
    const update = await this.db.query(
      "UPDATE offers SET order_status='c', zktx=NULL, update_timestamp=NOW(), unfilled=0 WHERE id=$1 RETURNING market",
      updatevalues
    )

    if (update.rows.length > 0) {
      await this.redisPublisher.publish(
        `broadcastmsg:all:${chainId}:${update.rows[0].market}`,
        JSON.stringify({
          op: 'orderstatus',
          args: [[[chainId, orderId, 'c', null, 0]]],
        })
      )
    } else {
      throw new Error('Order not found')
    }

    return true
  }

  cancelorder3 = async (
    chainId: number,
    orderId: number,
    token: string
  ): Promise<boolean> => {
    const values = [orderId, chainId]
    const select = await this.db.query(
      'SELECT userid, order_status, token FROM offers WHERE id=$1 AND chainid=$2',
      values
    )

    if (select.rows.length === 0) {
      throw new Error('Order not found')
    }

    // validate if sender is ok to cancel
    if (token !== select.rows[0].token) throw new Error('Unauthorized')

    if (!['o', 'pf', 'pm'].includes(select.rows[0].order_status)) {
      throw new Error('Order is no longer open')
    }

    const updatevalues = [orderId]
    const update = await this.db.query(
      "UPDATE offers SET order_status='c', zktx=NULL, update_timestamp=NOW(), unfilled=0 WHERE id=$1 RETURNING market",
      updatevalues
    )

    if (update.rows.length > 0) {
      await this.redisPublisher.publish(
        `broadcastmsg:all:${chainId}:${update.rows[0].market}`,
        JSON.stringify({
          op: 'orderstatus',
          args: [[[chainId, orderId, 'c', null, 0]]],
        })
      )
    } else {
      throw new Error('Order not found')
    }

    return true
  }

  matchorder = async (
    chainId: number,
    orderId: number,
    fillOrder: ZZFillOrder,
    wsUUID: string
  ) => {
    const redisKeyOrder = `orderstatus:${chainId}:${orderId}`
    const cache = await this.redis.GET(redisKeyOrder)
    if (cache) {
      throw new Error(`Order ${orderId} is not open`)
    }

    const values = [orderId, chainId]
    const select = await this.db.query(
      "SELECT userid, price, base_quantity, quote_quantity, market, zktx, side FROM offers WHERE id=$1 AND chainid=$2 AND order_status='o'",
      values
    )
    if (select.rows.length === 0) {
      throw new Error(`Order ${orderId} is not open`)
    }

    const selectresult = select.rows[0]

    if (selectresult.userid === fillOrder.accountId.toString()) {
      throw new Error(`Selfe-swap is not allowed`)
    }

    if (selectresult.userid === fillOrder.accountId.toString()) {
      throw new Error(`Selfe-swap is not allowed`)
    }

    // Determine fill price
    const marketInfo = await this.getMarketInfo(selectresult.market, chainId)
    let baseQuantity: number
    let quoteQuantity: number

    if (selectresult.side === 's') {
      baseQuantity = selectresult.base_quantity
      quoteQuantity =
        Number(fillOrder.amount) / 10 ** marketInfo.quoteAsset.decimals
    } else if (selectresult.side === 'b') {
      baseQuantity =
        Number(fillOrder.amount) / 10 ** marketInfo.baseAsset.decimals
      quoteQuantity = selectresult.quote_quantity
    } else {
      throw new Error(`Side ${selectresult.side} is not valid!`)
    }

    const fillPrice = formatPrice(quoteQuantity / baseQuantity)
    const redisMembers: any = {
      score: fillPrice,
      value: JSON.stringify({
        zktx: JSON.parse(selectresult.zktx),
        market: selectresult.market,
        baseQuantity: selectresult.base_quantity,
        quoteQuantity: selectresult.quote_quantity,
        userId: selectresult.userid,
        fillOrder,
        wsUUID,
      }),
    }

    const redisKey = `matchingorders:${chainId}:${orderId}`
    const existingMembers = await this.redis.ZCOUNT(redisKey, 0, 99999999)
    this.redis.ZADD(redisKey, redisMembers)
    if (existingMembers === 0) {
      this.redis.EXPIRE(redisKey, 10)
      setTimeout(() => {
        this.redis.SET(redisKeyOrder, 'filled', { EX: 60 })
        this.senduserordermatch(chainId, orderId, selectresult.side)
      }, 250)
    }
  }

  senduserordermatch = async (
    chainId: number,
    orderId: number,
    side: ZZMarketSide
  ) => {
    const redisKeyMatchingOrder = `matchingorders:${chainId}:${orderId}`
    const existingMembers = await this.redis.ZCOUNT(
      redisKeyMatchingOrder,
      -Infinity,
      Infinity
    )
    if (existingMembers === 0) {
      return
    }

    let redisMembers
    if (side === 'b') {
      redisMembers = await this.redis.ZPOPMIN(redisKeyMatchingOrder)
    } else {
      redisMembers = await this.redis.ZPOPMAX(redisKeyMatchingOrder)
    }
    if (!redisMembers) {
      return
    }

    const fillPrice = redisMembers.score
    const value = JSON.parse(redisMembers.value)
    const { fillOrder } = value
    const makerAccountId = fillOrder.accountId.toString()

    let fill
    try {
      const valuesOrder = [orderId, chainId]
      const update1 = await this.db.query(
        "UPDATE offers SET order_status='m' WHERE id=$1 AND chainid=$2 AND order_status='o' RETURNING id, base_quantity, quote_quantity",
        valuesOrder
      )
      if (update1.rows.length === 0)
        // this *should* not happen, so no need to send to ws
        throw new Error(`Order ${orderId} is not open`)

      let priceWithoutFee: string
      try {
        const marketInfo = await this.getMarketInfo(value.market, chainId)
        if (side === 's') {
          const quoteQuantity =
            Number(fillOrder.amount) / 10 ** marketInfo.quoteAsset.decimals
          const baseQuantityWithoutFee = value.baseQuantity - marketInfo.baseFee
          const reportedPrice = quoteQuantity / baseQuantityWithoutFee
          const worstPrice = update1.rows[0].quote_quantity / (update1.rows[0].base_quantity - marketInfo.baseFee)
          priceWithoutFee = formatPrice(reportedPrice > worstPrice ? worstPrice : reportedPrice)
        } else {
          const baseQuantity =
            Number(fillOrder.amount) / 10 ** marketInfo.baseAsset.decimals
          const quoteQuantityWithoutFee =
            value.quoteQuantity - marketInfo.quoteFee
          const reportedPrice = quoteQuantityWithoutFee / baseQuantity
          const worstPrice = (update1.rows[0].quote_quantity - marketInfo.quoteFee) / update1.rows[0].base_quantity
          priceWithoutFee = formatPrice(reportedPrice < worstPrice ? worstPrice : reportedPrice)
        }
      } catch (e: any) {
        console.log(e.message)
        priceWithoutFee = fillPrice.toString()
      }

      const valuesFills = [
        chainId,
        value.market,
        orderId,
        value.userId,
        makerAccountId,
        priceWithoutFee,
        value.baseQuantity,
        side,
      ]
      let update2
      try {
        update2 = await this.db.query(
          "INSERT INTO fills (chainid, market, taker_offer_id, taker_user_id, maker_user_id, price, amount, side, fill_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'm') RETURNING id",
          valuesFills
        )
      } catch (e: any) {
        // reset order updates
        await this.db.query(
          "UPDATE offers SET order_status='o' WHERE id=$1 AND chainid=$2 RETURNING id",
          valuesOrder
        )
        throw new Error(
          `Failed to update fills: ${e.message}, args: ${valuesFills}`
        )
      }

      const fillId = update2.rows[0].id
      fill = [
        chainId,
        fillId,
        value.market,
        side,
        priceWithoutFee,
        value.baseQuantity,
        'm',
        null,
        value.userId,
        makerAccountId,
        null,
        null,
      ]

      this.redisPublisher.PUBLISH(
        `broadcastmsg:maker:${chainId}:${value.wsUUID}`,
        JSON.stringify({
          op: 'userordermatch',
          args: [chainId, orderId, value.zktx, fillOrder],
        })
      )

      // update user
      this.redisPublisher.PUBLISH(
        `broadcastmsg:user:${chainId}:${value.userId}`,
        JSON.stringify({ op: 'orderstatus', args: [[[chainId, orderId, 'm']]] })
      )
    } catch (err: any) {
      if (err.message.includes('is not open')) {
        console.log(`Failed to match order because ${err.message}. Abort`)
      } else {
        console.log(
          `Failed to match order because ${err.message}, sending next best`
        )
        // try next best one
        this.senduserordermatch(chainId, orderId, side)
      }
      return
    }

    try {
      // send result to other mm's, remove set
      const otherMakerList: any[] = await this.redis.ZRANGE(
        redisKeyMatchingOrder,
        0,
        -1
      )
      otherMakerList.map(async (otherMaker: any) => {
        const otherValue = JSON.parse(otherMaker)
        const otherFillOrder = otherValue.fillOrder
        const otherMakerAccountId = otherFillOrder.accountId.toString()
        this.redisPublisher.PUBLISH(
          `broadcastmsg:maker:${chainId}:${otherValue.wsUUID}`,
          JSON.stringify({
            op: 'error',
            args: [
              'fillrequest',
              otherMakerAccountId,
              `Order ${orderId} was filled by better offer`,
            ],
          })
        )
      })
    } catch (err: any) {
      console.log(
        `senduserordermatch: Error while updating other mms: ${err.message}`
      )
    }

    this.redisPublisher.PUBLISH(
      `broadcastmsg:all:${chainId}:${value.market}`,
      JSON.stringify({ op: 'orderstatus', args: [[[chainId, orderId, 'm']]] })
    )
    this.redisPublisher.PUBLISH(
      `broadcastmsg:all:${chainId}:${value.market}`,
      JSON.stringify({ op: 'fills', args: [[fill]] })
    )
  }

  /**
   * Broadcast message to all subscibed connections
   * @param chainId
   * @param market market alias - all for all markets
   * @param msg JSON.stringify( WSMessage )
   */
  broadcastMessage = async (chainId: number, market: ZZMarket, msg: string) => {
    const subscription = `${chainId}:${market}`
      ; (this.wss.clients as Set<WSocket>).forEach((ws: WSocket) => {
        if (ws.readyState !== WebSocket.OPEN) return
        if (market !== 'all' && !ws.marketSubscriptions.includes(subscription))
          return
        ws.send(msg)
      })
  }

  /**
   * Send msg to user
   * @param chainId
   * @param userId user ws id like: `${chainId}:${userid}`
   * @param msg JSON.stringify( WSMessage )
   */
  sendMessageToUser = async (chainId: number, userId: string, msg: string) => {
    const userConnKey = `${chainId}:${userId}`
    const userWs = this.USER_CONNECTIONS[userConnKey]
    if (userWs) {
      userWs.send(msg)
    }
  }

  /**
   * Send msg to marketmaker (zkSync V1.X)
   * @param chainId
   * @param marketmakerId user ws id like: `${chainId}:${userid}`
   * @param msg JSON.stringify( WSMessage )
   */
  sendMessageToMM = async (
    chainId: number,
    marketmakerId: string,
    msg: string
  ) => {
    const makerConnKey = `${chainId}:${marketmakerId}`
    const makerWs = this.MAKER_CONNECTIONS[makerConnKey]
    if (makerWs) {
      makerWs.send(msg)
    }
  }

  /**
   * Returns the liquidity for a given market.
   * Returns the orderBook for a given market.
   * @param {number} chainId The reqested chain (1->zkSync, 1002->zkSync_goerli)
   * @param {ZZMarket} market The reqested market
   * @param {number} depth Depth of returned orderBook (depth/2 buckets per return)
   * @param {number} level Level of returned orderBook (1->best ask/bid, 2->0.05% steps, 3->all)
   * @return {number} The resulting orderBook -> {"timestamp": _, "bids": _, "asks": _}
   */
  getOrderBook = async (
    chainId: number,
    market: ZZMarket,
    depth = 0,
    level = 3
  ) => {
    const timestamp = Date.now()

    let bids: number[][] = []
    let asks: number[][] = []
    if (this.VALID_CHAINS_ZKSYNC.includes(chainId)) {
      const liquidity: any[] = await this.getSnapshotLiquidity(chainId, market)
      bids = liquidity
        .filter((l) => l[0] === 'b')
        .map((l: any[]) => [Number(l[1]), Number(l[2])])
        .sort((a: any[], b: any[]) => b[0] - a[0])
      asks = liquidity
        .filter((l) => l[0] === 's')
        .map((l: any[]) => [Number(l[1]), Number(l[2])])
        .sort((a: any[], b: any[]) => a[0] - b[0])
    } else {
      const orderBook: any[] = await this.getopenorders(chainId, market)
      bids = orderBook
        .filter((o) => o[3] === 'b')
        .map((o: any[]) => [Number(o[4]), Number(o[5])])
        .sort((a: any[], b: any[]) => b[0] - a[0])
      asks = orderBook
        .filter((o) => o[3] === 's')
        .map((o: any[]) => [Number(o[4]), Number(o[5])])
        .sort((a: any[], b: any[]) => a[0] - b[0])
    }

    if (bids.length === 0 && asks.length === 0) {
      return {
        timestamp,
        bids: [],
        asks: [],
      }
    }

    // if depth is set, only used every n entrys
    if (depth > 1) {
      depth *= 0.5
      const newBids: number[][] = []
      const newAsks: number[][] = []

      for (let i = 0; i < bids.length; i++) {
        const index = Math.floor(i / depth)
        if (newBids[index]) {
          newBids[index][1] += bids[i][1]
        } else {
          newBids[index] = bids[i]
        }
      }
      for (let i = 0; i < asks.length; i++) {
        const index = Math.floor(i / depth)
        if (newAsks[index]) {
          newAsks[index][1] += asks[i][1]
        } else {
          newAsks[index] = asks[i]
        }
      }
      asks = newAsks
      bids = newBids
    }

    if (level === 1) {
      // Level 1 – Only best bid and ask.
      return {
        timestamp,
        bids: bids?.[0] ? bids[0] : [],
        asks: asks?.[0] ? asks[0] : [],
      }
    }

    if (level === 2) {
      // Level 2 – Arranged by best bids and asks.
      let marketInfo: any = {}
      try {
        marketInfo = await this.getMarketInfo(market, chainId)
      } catch (e: any) {
        console.log(e.message)
        return {
          timestamp,
          bids: [],
          asks: [],
        }
      }
      // get mid price
      const redisKeyPrices = `lastprices:${chainId}`
      const midPrice = Number(await this.redis.HGET(redisKeyPrices, market))
      const returnBids: number[][] = []
      const returnAsks: number[][] = []
      const step = midPrice * 0.0005

      // group bids by steps
      const stepBidValues: any = {}
      bids.forEach((b) => {
        const stepCount = Math.ceil(Math.abs(b[0] - midPrice) % step)
        const stepValue = midPrice - stepCount * step
        if (stepBidValues[stepValue]) {
          stepBidValues[stepValue] += b[1]
        } else {
          // eslint-disable-next-line prefer-destructuring
          stepBidValues[stepValue] = b[1]
        }
      })
      // create new bids array
      const bidSteps = Object.keys(stepBidValues)
      bidSteps.forEach((bid) => {
        returnBids.push([
          (+bid).toFixed(marketInfo.pricePrecisionDecimal),
          stepBidValues[bid],
        ])
      })

      // group asks by steps
      const stepAskValues: any = {}
      asks.forEach((a) => {
        const stepCount = Math.ceil(Math.abs(a[0] - midPrice) % step)
        const stepValue = midPrice + stepCount * step
        if (stepAskValues[stepValue]) {
          stepAskValues[stepValue] += a[1]
        } else {
          // eslint-disable-next-line prefer-destructuring
          stepAskValues[stepValue] = a[1]
        }
      })
      // create new asks array
      const askSteps = Object.keys(stepAskValues)
      askSteps.forEach((ask) => {
        returnAsks.push([
          (+ask).toFixed(marketInfo.pricePrecisionDecimal),
          stepAskValues[ask],
        ])
      })

      return {
        timestamp,
        bids: returnBids,
        asks: returnAsks,
      }
    }
    if (level === 3) {
      // Level 3 – Complete order book, no aggregation.
      return {
        timestamp,
        bids,
        asks,
      }
    }
    throw new Error(
      `level': ${level} is not supported for getOrderBook. Use 1, 2 or 3`
    )
  }

  // The liquidity here gets wiped regularly so it's very unreliable
  // YOu want to use getSnapshotLiquidity most of the time and it's a
  // drop in replacement for this
  getLiquidity = async (chainId: number, market: ZZMarket) => {
    const redisKeyLiquidity = `liquidity2:${chainId}:${market}`
    const liquidityList = await this.redis.HGETALL(redisKeyLiquidity)
    const liquidity: string[] = []
    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const clientId in liquidityList) {
      const liquidityPosition = JSON.parse(liquidityList[clientId])
      liquidity.push(...liquidityPosition)
    }
    return liquidity
  }

  getSnapshotLiquidity = async (chainId: number, market: ZZMarket) => {
    const redisKeyLiquidity = `bestliquidity:${chainId}:${market}`
    const liquidityString = await this.redis.GET(redisKeyLiquidity)
    const liquidity = liquidityString ? JSON.parse(liquidityString) : []
    return liquidity
  }

  getopenorders = async (chainId: number, market: string) => {
    chainId = Number(chainId)
    const query = {
      text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,unfilled,txhash FROM offers WHERE market=$1 AND chainid=$2 AND order_status='o'",
      values: [market, chainId],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    return select.rows
  }

  getOrder = async (chainId: number, orderId: number | number[]) => {
    chainId = Number(chainId)
    orderId = typeof orderId === 'string' ? [orderId] : orderId
    const query = {
      text: 'SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,unfilled,txhash FROM offers WHERE chainid=$1 AND id IN ($2) LIMIT 25',
      values: [chainId, orderId],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    if (select.rows.length === 0) throw new Error('Order not found')
    return select.rows
  }

  getFill = async (chainId: number, orderId: number | number[]) => {
    chainId = Number(chainId)
    orderId = typeof orderId === 'string' ? [orderId] : orderId
    const query = {
      text: 'SELECT chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id,feeamount,feetoken,insert_timestamp FROM fills WHERE chainid=$1 AND id IN ($2) LIMIT 25',
      values: [chainId, orderId],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    if (select.rows.length === 0) throw new Error('Fill(s) not found')
    return select.rows
  }

  getuserfills = async (chainId: number, userid: string) => {
    chainId = Number(chainId)
    const query = {
      text: 'SELECT chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id,feeamount,feetoken,insert_timestamp FROM fills WHERE chainid=$1 AND (maker_user_id=$2 OR taker_user_id=$2) ORDER BY id DESC LIMIT 25',
      values: [chainId, userid],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    return select.rows
  }

  getuserorders = async (chainId: number, userid: string) => {
    const query = {
      text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,unfilled,txhash FROM offers WHERE chainid=$1 AND userid=$2 AND order_status IN ('o','pm','pf') ORDER BY id DESC LIMIT 25",
      values: [chainId, userid],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    return select.rows
  }

  /**
   * Returns fills for a given market.
   * @param {number} chainId reqested chain (1->zkSync, 1002->zkSync_goerli)
   * @param {ZZMarket} market reqested market
   * @param {number} limit number of trades returnd (MAX 25)
   * @param {number} orderId orderId to start at
   * @param {number} type side of returned fills 's', 'b', 'buy' or 'sell'
   * @param {number} startTime time for first fill
   * @param {number} endTime time for last fill
   * @param {number} accountId accountId to search for (maker or taker)
   * @param {string} direction used to set ASC or DESC ('older' or 'newer')
   * @return {number} array of fills [[chainId,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id,feeamount,feetoken,insert_timestamp],...]
   */
  getfills = async (
    chainId: number,
    market?: ZZMarket,
    limit?: number,
    orderId?: number,
    type?: string,
    startTime?: number,
    endTime?: number,
    accountId?: number,
    direction?: string
  ) => {
    let text =
      "SELECT chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id,feeamount,feetoken,insert_timestamp FROM fills WHERE chainid=$1 AND fill_status='f'"

    if (market) {
      text += ` AND market = '${market}'`
    }

    let sqlDirection = 'DESC'
    if (direction) {
      if (direction === 'older') {
        sqlDirection = 'DESC'
      } else if (direction === 'newer') {
        sqlDirection = 'ASC'
      } else {
        throw new Error("Only direction 'older' or 'newer' is allowed.")
      }
    }

    if (orderId) {
      if (sqlDirection === 'DESC') {
        text += ` AND id <= '${orderId}'`
      } else {
        text += ` AND id >= '${orderId}'`
      }
    }

    if (type) {
      let side: ZZMarketSide
      switch (type) {
        case 's':
          side = 's'
          break
        case 'b':
          side = 'b'
          break
        case 'sell':
          side = 's'
          break
        case 'buy':
          side = 'b'
          break
        default:
          throw new Error("Only type 's', 'b', 'sell' or 'buy' is allowed.")
      }
      text += ` AND side = '${side}'`
    }

    if (startTime) {
      const date = new Date(startTime).toISOString()
      text += ` AND insert_timestamp >= '${date}'`
    }

    if (endTime) {
      const date = new Date(endTime).toISOString()
      text += ` AND insert_timestamp <= '${date}'`
    }

    if (accountId) {
      text += ` AND (maker_user_id='${accountId}' OR taker_user_id='${accountId}')`
    }

    limit = limit ? Math.min(50, Number(limit)) : 50
    text += ` ORDER BY id ${sqlDirection} LIMIT ${limit}`

    try {
      const query = {
        text,
        values: [chainId],
        rowMode: 'array',
      }
      const select = await this.db.query(query)
      return select.rows
    } catch (e: any) {
      console.log(`Error in getFills: ${text}, Error: ${e.message}`)
      return []
    }
  }

  getTradeData = async (chainId: number, markets: ZZMarket, days: 1 | 7 | 31): Promise<[number, number, number, number, number, number, number][]> => {
    const resString: string | undefined = await this.redis.HGET(`tradedata:${chainId}:${days}`, markets)
    if (!resString) return []

    const res: [number, number, number, number, number, number, number][] = JSON.parse(resString)
    return res
  }

  getLastPrices = async (chainId: number, markets: ZZMarket[] = []) => {
    const redisKeyPriceInfo = `lastpriceinfo:${chainId}`

    if (markets.length === 1) {
      const redisPriceInfo = await this.redis.HGET(
        redisKeyPriceInfo,
        markets[0]
      )
      if (!redisPriceInfo) return []
      const priceInfo = JSON.parse(redisPriceInfo)
      return [
        markets[0],
        +priceInfo.price,
        priceInfo.priceChange,
        priceInfo.quoteVolume,
        priceInfo.baseVolume,
      ]
    }
    // fetch all active markets if none is requested
    if (markets.length === 0) {
      markets = await this.redis.SMEMBERS(`activemarkets:${chainId}`)
    }
    const redisPriceInfo = await this.redis.HGETALL(redisKeyPriceInfo)
    const lastprices: any[] = []
    for (let i = 0; i < markets.length; i++) {
      const redisString = redisPriceInfo[markets[i]]
      // eslint-disable-next-line no-continue
      if (!redisString) continue
      const priceInfo = JSON.parse(redisString)
      if (redisPriceInfo) {
        lastprices.push([
          markets[i],
          +priceInfo.price,
          priceInfo.priceChange,
          priceInfo.quoteVolume,
          priceInfo.baseVolume,
        ])
      }
    }
    return lastprices
  }

  getMarketSummarys = async (
    chainId: number,
    markets: string[] = [],
    UTCFlag = false
  ) => {
    const marketSummarys: any = {}
    const redisKeyMarketSummary = UTCFlag
      ? `marketsummary:utc:${chainId}`
      : `marketsummary:${chainId}`

    if (markets.length === 1) {
      const marketId: ZZMarket = markets[0]
      const redisMarketSummaryString = await this.redis.HGET(
        redisKeyMarketSummary,
        marketId
      )
      if (redisMarketSummaryString) {
        marketSummarys[marketId] = JSON.parse(
          redisMarketSummaryString
        ) as ZZMarketSummary
      } else {
        marketSummarys[marketId] = null
      }
      return marketSummarys
    }

    // fetch all active markets if none is requested
    if (markets.length === 0) {
      markets = await this.redis.SMEMBERS(`activemarkets:${chainId}`)
    }

    const redisMarketSummarys = await this.redis.HGETALL(redisKeyMarketSummary)
    for (let i = 0; i < markets.length; i++) {
      const marketId: ZZMarket = markets[i]
      const redisMarketSummaryString = redisMarketSummarys[marketId]
      if (redisMarketSummaryString) {
        marketSummarys[marketId] = JSON.parse(
          redisMarketSummaryString
        ) as ZZMarketSummary
      } else {
        marketSummarys[marketId] = null
      }
    }
    return marketSummarys
  }

  // Ladder has to be a sorted 2-D array contaning price and quantity
  // Example: [ [3500,1], [3501,2] ]
  static getQuoteFromLadder(ladder: any[][], qty: number): number {
    let unfilledQuantity = qty
    let price

    for (let i = 0; i < ladder.length; i++) {
      ;[price] = ladder[i]
      const orderQuantity = ladder[i][1]
      if (orderQuantity >= unfilledQuantity) {
        unfilledQuantity = 0
        break
      } else {
        unfilledQuantity -= orderQuantity
      }
    }
    if (unfilledQuantity > 0) throw new Error('Insufficient liquidity')
    return price
  }

  genquote = async (
    chainId: number,
    market: ZZMarket,
    side: ZZMarketSide,
    baseQuantity: number,
    quoteQuantity: number
  ) => {
    if (baseQuantity && quoteQuantity)
      throw new Error('Only one of baseQuantity or quoteQuantity should be set')
    if (!['b', 's'].includes(side)) throw new Error('Invalid side')

    if (baseQuantity) baseQuantity = Number(baseQuantity)
    if (quoteQuantity) quoteQuantity = Number(quoteQuantity)
    if (baseQuantity && baseQuantity <= 0)
      throw new Error('Quantity must be positive')
    if (quoteQuantity && quoteQuantity <= 0)
      throw new Error('Quantity must be positive')

    const marketInfo = await this.getMarketInfo(market, chainId)
    const liquidity = await this.getOrderBook(chainId, market)

    let softQuoteQuantity: number
    let hardQuoteQuantity: number
    let softBaseQuantity: number
    let hardBaseQuantity: number
    let softPrice: number
    let hardPrice: number
    let ladderPrice: number

    if (baseQuantity) {
      if (baseQuantity < marketInfo.baseFee)
        throw new Error('Amount is inadequate to pay fee')

      hardBaseQuantity = baseQuantity

      if (side === 'b') {
        const { asks } = liquidity
        ladderPrice = API.getQuoteFromLadder(asks as any[][], baseQuantity)

        hardQuoteQuantity = this.VALID_CHAINS_ZKSYNC.includes(chainId)
          ? baseQuantity * ladderPrice + Number(marketInfo.quoteFee)
          : baseQuantity * ladderPrice

        hardPrice = hardQuoteQuantity / hardBaseQuantity
        softPrice = hardPrice * 1.001
      } else {
        const { bids } = liquidity
        ladderPrice = API.getQuoteFromLadder(bids as any[][], baseQuantity)

        hardQuoteQuantity = this.VALID_CHAINS_ZKSYNC.includes(chainId)
          ? (baseQuantity - Number(marketInfo.baseFee)) * ladderPrice
          : baseQuantity * ladderPrice

        hardPrice = hardQuoteQuantity / hardBaseQuantity
        softPrice = hardPrice * 0.999
      }

      softBaseQuantity = baseQuantity
      softQuoteQuantity = baseQuantity * softPrice
    } else if (quoteQuantity) {
      if (quoteQuantity < marketInfo.quoteFee)
        throw new Error('Amount is inadequate to pay fee')

      hardQuoteQuantity = quoteQuantity

      if (side === 'b') {
        const asks: any[] = liquidity.asks.map((l: any) => [
          l[0],
          Number(l[0]) * Number(l[1]),
        ])
        ladderPrice = API.getQuoteFromLadder(asks, quoteQuantity)

        hardBaseQuantity = this.VALID_CHAINS_ZKSYNC.includes(chainId)
          ? (quoteQuantity - Number(marketInfo.quoteFee)) / ladderPrice
          : quoteQuantity / ladderPrice

        hardPrice = hardQuoteQuantity / hardBaseQuantity
        softPrice = hardPrice * 1.001
      } else {
        const bids = liquidity.bids.map((l: any) => [
          l[0],
          Number(l[0]) * Number(l[1]),
        ])
        ladderPrice = API.getQuoteFromLadder(bids, quoteQuantity)

        hardBaseQuantity = this.VALID_CHAINS_ZKSYNC.includes(chainId)
          ? quoteQuantity / ladderPrice + Number(marketInfo.baseFee)
          : quoteQuantity / ladderPrice

        hardPrice = hardQuoteQuantity / hardBaseQuantity
        softPrice = hardPrice * 0.999
      }

      softQuoteQuantity = quoteQuantity
      softBaseQuantity = quoteQuantity / softPrice
    } else {
      throw new Error('baseQuantity or quoteQuantity should be set')
    }

    if (
      !softPrice ||
      !hardPrice ||
      Number.isNaN(softPrice) ||
      Number.isNaN(hardPrice)
    )
      throw new Error('Internal Error. No price generated.')

    return {
      softPrice: formatPrice(softPrice),
      hardPrice: formatPrice(hardPrice),
      softQuoteQuantity: softQuoteQuantity.toFixed(
        marketInfo.quoteAsset.decimals
      ),
      hardQuoteQuantity: hardQuoteQuantity.toFixed(
        marketInfo.quoteAsset.decimals
      ),
      softBaseQuantity: softBaseQuantity.toFixed(marketInfo.baseAsset.decimals),
      hardBaseQuantity: hardBaseQuantity.toFixed(marketInfo.baseAsset.decimals),
    }
  }

  clearDeadConnections = () => {
    const numberUsers = Object.keys(this.USER_CONNECTIONS).length
    const numberMMs = Object.keys(this.MAKER_CONNECTIONS).length
    console.log(
      `Active WS connections: USER_CONNECTIONS: ${numberUsers}, MAKER_CONNECTIONS: ${numberMMs}`
    )
      ; (this.wss.clients as Set<WSocket>).forEach((ws) => {
        if (!ws.isAlive) {
          const userconnkey = `${ws.chainId}:${ws.userId}`
          delete this.USER_CONNECTIONS[userconnkey]
          delete this.MAKER_CONNECTIONS[userconnkey]
          ws.terminate()
        } else {
          ws.isAlive = false
          ws.ping()
        }
      })

    console.log(`${this.wss.clients.size} active connections.`)
  }

  broadcastLiquidity = async () => {
    const result = this.VALID_CHAINS_ZKSYNC.map(async (chainId) => {
      const markets = await this.redis.SMEMBERS(`activemarkets:${chainId}`)
      if (!markets || markets.length === 0) return
      const results: Promise<any>[] = markets.map(async (marketId) => {
        const liquidity = await this.getSnapshotLiquidity(chainId, marketId)
        if (liquidity) {
          this.broadcastMessage(
            chainId,
            marketId,
            JSON.stringify({
              op: 'liquidity2',
              args: [chainId, marketId, liquidity],
            })
          )
        }
      })

      // eslint-disable-next-line consistent-return
      return Promise.all(results)
    })

    return Promise.all(result)
  }

  broadcastLastPrice = async () => {
    const result = this.VALID_CHAINS.map(async (chainId) => {
      const lastprices = await this.getLastPrices(chainId)
      this.broadcastMessage(
        chainId,
        'all',
        JSON.stringify({ op: 'lastprice', args: [lastprices, chainId] })
      )
    })

    return Promise.all(result)
  }

  updateLiquidity = async (
    chainId: number,
    market: ZZMarket,
    liquidity: any[],
    clientId: string
  ): Promise<string[]> => {
    const NINE_SECONDS = ((Date.now() / 1000) | 0) + 9
    const marketInfo = await this.getMarketInfo(market, chainId)

    const redisKeyPassive = `passivews:${chainId}:${clientId}`
    const msg = await this.redis.get(redisKeyPassive)
    if (msg) {
      const remainingTime = await this.redis.ttl(redisKeyPassive)
      throw new Error(
        `Your address did not respond to order ${msg} yet. Remaining timeout: ${remainingTime}.`
      )
    }

    const baseToken = market.split('-')[0]
    const basePrice = await this.getUsdPrice(chainId, baseToken)

    // $100 min size
    let minSize = 0
    if (baseToken !== 'ZZ') {
      minSize = basePrice ? 100 / basePrice : marketInfo.baseFee
    }

    const redisKeyLiquidity = `liquidity2:${chainId}:${market}`

    const errorMsg: string[] = []
    const redisMembers: any[] = []
    for (let i = 0; i < liquidity.length; i++) {
      const l: any[] = liquidity[i]
      const price = Number(l[1])
      const amount = Number(l[2])

      // validation
      if (!['b', 's'].includes(l[0])) {
        errorMsg.push('Bad side')
      } else if (!price || Number.isNaN(price)) {
        errorMsg.push('Price is not a number')
      } else if (price < 0) {
        errorMsg.push('Price cant be negative')
      } else if (Number.isNaN(amount)) {
        errorMsg.push('Amount is not a number')
      } else if (amount <= minSize) {
        // don't show this error to users
        // errorMsg.push('Amount to small')
      } else {
        // Add expirations to liquidity if needed
        if (!l[3] || Number(l[3]) > NINE_SECONDS) {
          l[3] = NINE_SECONDS
        }
        if (clientId) l[4] = clientId

        // Add to valid liquidity
        redisMembers.push(l)
      }
    }

    if (redisMembers.length > 0) {
      try {
        await this.redis.HSET(
          redisKeyLiquidity,
          clientId,
          JSON.stringify(redisMembers)
        )
      } catch (e: any) {
        console.log(`updateLiquidity for ${market}`)
        console.error(e)
        console.log(liquidity)
        console.log(redisKeyLiquidity)
        console.log(redisMembers)
        throw new Error(`Unexpected error: ${e.message}`)
      }
    } else {
      // Users don't like seeing that their liquidity isn't working so disable this
      // throw new Error('No valid liquidity send')
    }
    await this.redis.SADD(`activemarkets:${chainId}`, market)
    return errorMsg
  }

  dailyVolumes = async (chainId: number) => {
    const redisKey = `volume:history:${chainId}`
    const cache = await this.redis.get(redisKey)
    if (cache) return JSON.parse(cache)
    const query = {
      text: "SELECT chainid, market, DATE(insert_timestamp) AS trade_date, SUM(base_quantity) AS base_volume, SUM(quote_quantity) AS quote_volume FROM offers WHERE order_status IN ('m', 'f', 'b') AND chainid = $1 GROUP BY (chainid, market, trade_date)",
      values: [chainId],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    const volumes = select.rows
    await this.redis.SET(redisKey, JSON.stringify(volumes))
    await this.redis.expire(redisKey, 1200)
    return volumes
  }

  getUsdPrice = async (
    chainId: number,
    tokenSymbol: string
  ): Promise<number> => {
    const cache = await this.redis.HGET(`tokeninfo:${chainId}`, tokenSymbol)
    if (cache) {
      const tokenInfo = JSON.parse(cache)
      return Number(tokenInfo.usdPrice)
    }
    return 0
  }

  /* ################ V3 functions  ################ */
  sendInitialPastOrders = async (chainId: number, market: string, ws: WebSocket, count = 45) => {
    const msgStrings: string[] = await this.redis.LRANGE(`swap_event:${chainId}:${market}`, 0, count - 1)
    if (!msgStrings) return

    const msg = msgStrings.map((msgString: string) => JSON.parse(msgString))
    ws.send(JSON.stringify({ op: 'swap_event', args: msg }))
  }

  sendSwapEventV3 = async (chainId: number, market: ZZMarket, msg: string) => {
    (this.wss.clients as Set<WSocket>).forEach((ws: WSocket) => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (chainId !== -1 && ws.chainId !== chainId) return
      if (market !== 'all' && ws.swapEventSubscription !== market) return
      ws.send(msg)
    })
  }
}
