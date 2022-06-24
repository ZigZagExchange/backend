// SPDX-License-Identifier: BUSL-1.1
import fetch from 'isomorphic-fetch'
import { EventEmitter } from 'events'
import { zksyncOrderSchema, ZZMessageSchema } from 'src/schemas'
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
} from 'src/types'
import {
  formatPrice,
  stringToFelt,
  getNetwork
} from 'src/utils'

export default class API extends EventEmitter {
  USER_CONNECTIONS: AnyObject = {}
  MAKER_CONNECTIONS: AnyObject = {}
  V1_TOKEN_IDS: AnyObject = {}
  SYNC_PROVIDER: AnyObject = {}
  ETHERS_PROVIDER: AnyObject = {}
  STARKNET_EXCHANGE: AnyObject = {}
  MARKET_MAKER_TIMEOUT = 300
  VALID_CHAINS: number[] = process.env.VALID_CHAINS ? JSON.parse(process.env.VALID_CHAINS) : [1, 1000, 1001]
  VALID_CHAINS_ZKSYNC: number[] = this.VALID_CHAINS.filter(chainId => [1, 1000].includes(chainId))
  VALID_SMART_CONTRACT_CHAIN: number[] = this.VALID_CHAINS.filter(chainId => [1001].includes(chainId))


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
    if (msg.op === "ping") {
      return false
    }
    if (!Object.prototype.hasOwnProperty.call(services, msg.op)) {
      console.error(`Operation failed: ${msg.op}`)
      return false
    }

    return (services as any)[msg.op].apply(this, [
      this,
      ws,
      Array.isArray(msg.args) ? msg.args : [],
    ])
  }

  start = async (port: number) => {
    if (this.started) return
    this.started = true

    await this.redis.connect()
    await this.redisSubscriber.connect()
    await this.redisPublisher.connect()

    const starknetContractABI = JSON.parse(
      fs.readFileSync(
        'abi/starknet_v1.abi',
        'utf8'
      )
    )

    // setup provider
    if (!process.env.STARKNET_CONTRACT_ADDRESS) throw new Error('process.env.STARKNET_CONTRACT_ADDRESS not set!')
    this.STARKNET_EXCHANGE.goerli = new starknet.Contract(
      starknetContractABI,
      process.env.STARKNET_CONTRACT_ADDRESS
    )    
    this.SYNC_PROVIDER.mainnet = await zksync.getDefaultRestProvider("mainnet")
    this.SYNC_PROVIDER.rinkeby = await zksync.getDefaultRestProvider("rinkeby")

    // setup redisSubscriber
    this.redisSubscriber.PSUBSCRIBE("broadcastmsg:*", (message: string, channel: string) => {
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
      if (op !== "broadcastmsg") throw new Error('Sanity check failed.')
      if (broadcastChannel === "user") {
        this.sendMessageToUser(
          chainId,
          target,
          message
        )
      } else if (broadcastChannel === "all") {
        this.broadcastMessage(
          chainId,
          target,
          message
        )
      } else if (broadcastChannel === "maker") {
        this.sendMessageToMM(
          chainId,
          target,
          message
        )
      } else {
        console.error(`redisSubscriber wrong broadcastChannel: ${broadcastChannel}`)
      }
    })

    this.watchers = [
      setInterval(this.clearDeadConnections, 30000),
      setInterval(this.broadcastLiquidity, 5000),
    ]

    // add valid open orders to Liquidity
    const addLiquidityPromise: Promise<any>[] = this.VALID_SMART_CONTRACT_CHAIN.map(async (chainId) => {
      const query = {
        text: "SELECT chainid,market,side,price,expires,unfilled,id FROM offers WHERE chainid=$1 AND order_status IN ('o', 'pm', 'pf')",
        values: [chainId]
      }
      const select = await this.db.query(query)
      const rowsPromise: Promise<any>[] = select.rows.map(async (row) => {
        await this.addLiquidity(
          row.chainid,
          row.market,
          [row.side, row.price, row.unfilled, row.expires, row.id]
        )
      })
      await Promise.all(rowsPromise)
    })
    await Promise.all(addLiquidityPromise)

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
  getDefaultValuesFromArweave = async (
    chainId: number,
    market: string
  ) => {
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
      const fetchResult = await fetch(`https://arweave.net/${marketArweaveId}`, {
        signal: controller.signal,
      }).then((r: any) => r.json())

      if (!fetchResult) return marketInfo
      marketInfo = fetchResult
    } catch (err: any) {
      console.error(`Can't fetch update default marketInfo for ${market}, Error ${err.message}`)
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
    if (!this.VALID_CHAINS.includes(chainId)) throw new Error('No valid chainId')
    if (!market) throw new Error('Bad market')

    const redisKeyMarketInfo = `marketinfo:${chainId}`
    const cache = await this.redis.HGET(
      redisKeyMarketInfo,
      market
    )

    if (cache) {
      return JSON.parse(cache) as ZZMarketInfo
    }

    const marketInfoDefaults: ZZMarketInfo = await this.getDefaultValuesFromArweave(
      chainId,
      market
    )

    if (
      market.length > 19 &&
      (!marketInfoDefaults || Number(marketInfoDefaults.zigzagChainId) !== chainId)
    ) {
      return {} as ZZMarketInfo
    }

    let baseSymbol: string
    let quoteSymbol: string
    if (market.length > 19) {
      const network = getNetwork(chainId)
      baseSymbol = await this.SYNC_PROVIDER[network].tokenSet.resolveTokenSymbol(marketInfoDefaults.baseAssetId)
      quoteSymbol = await this.SYNC_PROVIDER[network].tokenSet.resolveTokenSymbol(marketInfoDefaults.quoteAssetId)
    } else {
      [baseSymbol, quoteSymbol] = market.split('-')
    }

    if (baseSymbol.includes("ERC20")) throw new Error('Your base token has no symbol on zkSync. Please contact ZigZag or zkSync to get it listed properly. You can also check here: https://zkscan.io/explorer/tokens')
    if (quoteSymbol.includes("ERC20")) throw new Error('Your quote token has no symbol on zkSync. Please contact ZigZag or zkSync to get it listed properly. You can also check here: https://zkscan.io/explorer/tokens')

    // get last fee
    const [
      baseFee,
      quoteFee,
      baseAssetString,
      quoteAssetString
    ] = await Promise.all([
      this.redis.HGET(`tokenfee:${chainId}`, baseSymbol),
      this.redis.HGET(`tokenfee:${chainId}`, quoteSymbol),
      this.redis.HGET(`tokeninfo:${chainId}`, baseSymbol),
      this.redis.HGET(`tokeninfo:${chainId}`, quoteSymbol)
    ])

    if (!baseAssetString) throw new Error('Unkown base asset.')
    if (!quoteAssetString) throw new Error('Unkown quote asset.')
    const baseAsset = JSON.parse(baseAssetString) as AnyObject
    const quoteAsset = JSON.parse(quoteAssetString) as AnyObject

    const marketInfo: ZZMarketInfo = {}
    marketInfo.zigzagChainId = chainId
    marketInfo.baseAssetId = baseAsset.id
    marketInfo.quoteAssetId = quoteAsset.id
    // set fee, use arewavw fees as fallback
    marketInfo.baseFee = (baseFee)
      ? Number(baseFee)
      : Number(marketInfoDefaults?.baseFee)
    marketInfo.quoteFee = (quoteFee)
      ? Number(quoteFee)
      : Number(marketInfoDefaults?.quoteFee)
    // set tradingViewChart, use binance as fallback
    marketInfo.tradingViewChart = (marketInfoDefaults?.tradingViewChart)
      ? marketInfoDefaults.tradingViewChart
      : `BINANCE:${baseSymbol}${quoteSymbol}`
    // set pricePrecisionDecimal, use min decimals as fallback
    marketInfo.pricePrecisionDecimal = marketInfoDefaults?.pricePrecisionDecimal
      ? marketInfoDefaults.pricePrecisionDecimal
      : Math.min(baseAsset.decimals, quoteAsset.decimals)
    marketInfo.baseAsset = baseAsset
    marketInfo.quoteAsset = quoteAsset
    marketInfo.alias = `${baseSymbol}-${quoteSymbol}`

    await this.redis.HSET(
      redisKeyMarketInfo,
      marketInfo.alias,
      JSON.stringify(marketInfo)
    )

    // return if alias
    if (market.length < 19) return marketInfo

    // update marketArweaveId in SQL
    try {
      await this.db.query(
        'INSERT INTO marketids (marketid, chainid, marketalias) VALUES($1, $2, $3) ON CONFLICT (marketalias) DO UPDATE SET marketid = EXCLUDED.marketid',
        [market, chainId, marketInfo.alias] // market is the id in this case, as market > 19
      )
    } catch (err) {
      console.error(`Failed to update SQL for ${marketInfo.alias} SET id = ${market}`)
    }
    return marketInfo
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

    let feeAmount
    let feeToken
    let timestamp
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
        feeToken = "USDC"
      }
    } catch (err: any) {
      feeAmount = 0.5
      feeToken = "USDC"
    }

    if (newstatus === 'r') {
      feeAmount = 0
    }

    try {
      const valuesFills = [newstatus, feeAmount, feeToken, orderid, chainId]
      const update2 = await this.db.query(
        "UPDATE fills SET fill_status=$1,feeamount=$2,feetoken=$3 WHERE taker_offer_id=$4 AND chainid=$5 AND fill_status IN ('b', 'm') RETURNING id, market, price, amount, maker_user_id, insert_timestamp",
        valuesFills
      )
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
    if (chainId !== 1 && chainId !== 1000) throw new Error("Only for zkSync")
    if ((zktx.validUntil * 1000) < Date.now()) throw new Error("Wrong expiry: sync your PC clock to the correct time to fix this error")

    // TODO: Activate nonce check here
    // if(NONCES[zktx.accountId] && NONCES[zktx.accountId][chainId] && NONCES[zktx.accountId][chainId] > zktx.nonce) {
    //    throw new Error("badnonce");
    // }

    // Prevent DOS attacks. Rate limit one order every 3 seconds.
    const redisRateLimitKey = `ratelimit:zksync:${chainId}:${zktx.accountId}`
    const ratelimit = await this.redis.get(redisRateLimitKey)
    if (ratelimit) throw new Error('Only one order per 3 seconds allowed')
    else {
      await this.redis.SET(
        redisRateLimitKey,
        '1',
        { EX: 3 }
      )
    }

    const marketInfo = await this.getMarketInfo(market, chainId)
    let side
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
    ]
    // save order to DB
    const query =
      'INSERT INTO offers(chainid, userid, nonce, market, side, price, base_quantity, quote_quantity, order_type, order_status, expires, zktx, insert_timestamp, unfilled) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13) RETURNING id'
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
      null,
      baseQuantity,
    ]

    // broadcast new order
    this.redisPublisher.PUBLISH(
      `broadcastmsg:all:${chainId}:${market}`,
      JSON.stringify({ op: 'orders', args: [[orderreceipt]] })
    )

    return { op: 'userorderack', args: orderreceipt }
  }

  processorderstarknet = async (
    chainId: number,
    market: string,
    ZZMessageString: string
  ) => {
    const ZZMessage = JSON.parse(ZZMessageString)
    const inputValidation = ZZMessageSchema.validate(ZZMessage)
    if (inputValidation.error) throw inputValidation.error
    if (chainId !== 1001) throw new Error("Only for StarkNet")

    const marketInfo = await this.getMarketInfo(market, chainId)
    const { order } = ZZMessage

    order.base_quantity = Number(order.base_quantity)
    if (order.base_quantity <= 0) throw new Error('Quantity cannot be negative')

    order.price.numerator = Number(order.price.numerator)
    if (order.price.numerator <= 0) throw new Error('Price numerator cannot be negative')

    order.price.denominator = Number(order.price.denominator)
    if (order.price.denominator <= 0) throw new Error('Price denominator cannot be negative')

    const userAddress = ZZMessage.sender
    if (order.side !== '1' && order.side !== '0') throw new Error('Invalid side')
    const side = order.side === '0' ? 'b' : 's'
    const baseQuantity = order.base_quantity / 10 ** marketInfo.baseAsset.decimals
    const price = (order.price.numerator / order.price.denominator)

    const quoteQuantity = price * baseQuantity

    // starknet uses unix * 100, generate correct unix
    const expirationStarkNet = Number(order.expiration)
    if ((expirationStarkNet * 10) < Date.now()) throw new Error("Wrong expiry, check PC clock")
    const expiration = (expirationStarkNet / 100) | 0
    // const order_type = 'limit' - set in match_limit_order

    let remainingAmount = baseQuantity

    const query = 'SELECT * FROM match_limit_order($1, $2, $3, $4, $5, $6, $7, $8, $9)'
    const values = [
      chainId,
      userAddress,
      market,
      side,
      price,
      baseQuantity,
      quoteQuantity,
      expiration,
      ZZMessageString
    ]


    const matchquery = await this.db.query(query, values)
    const fillIds = matchquery.rows
      .slice(0, matchquery.rows.length - 1)
      .map((r) => r.id)
    const offerId = matchquery.rows[matchquery.rows.length - 1].id

    const fills = await this.db.query(
      'SELECT fills.*, maker_offer.unfilled AS maker_unfilled, maker_offer.zktx AS maker_zktx, maker_offer.side AS maker_side FROM fills JOIN offers AS maker_offer ON fills.maker_offer_id=maker_offer.id WHERE fills.id = ANY ($1)',
      [fillIds]
    )
    const offerquery = await this.db.query('SELECT * FROM offers WHERE id = $1', [
      offerId,
    ])
    const offer = offerquery.rows[0]

    const orderupdates: any[] = []
    const marketFills: any[] = []
    const liquidityUpdates: any = {}
    fills.rows.forEach(async (row) => {
      if (row.maker_unfilled > 0) {
        orderupdates.push([
          chainId,
          row.maker_offer_id,
          'pm',
          row.amount,
          row.maker_unfilled,
        ])
      } else {
        orderupdates.push([chainId, row.maker_offer_id, 'm'])
      }
      marketFills.push([
        chainId,
        row.id,
        market,
        side,
        row.price,
        row.amount,
        row.fill_status,
        row.txhash,
        row.taker_user_id,
        row.maker_user_id,
      ])

      let buyer: any
      let seller: any
      if (row.maker_side === 'b') {
        buyer = row.maker_zktx
        seller = offer.zktx
      } else if (row.maker_side === 's') {
        buyer = offer.zktx
        seller = row.maker_zktx
      } else {
        throw new Error('Invalid side')
      }
      this.relayStarknetMatch(
        chainId,
        market,
        JSON.parse(buyer),
        JSON.parse(seller),
        row.amount,
        row.price,
        row.id,
        row.maker_offer_id,
        offer.id
      )

      // addes the amount filled to liquidityUpdates to update later
      liquidityUpdates[row.maker_offer_id] = row.amount
      remainingAmount -= row.amount
    })
    const orderMsg = [
      chainId,
      offer.id,
      market,
      offer.side,
      offer.price,
      offer.base_quantity,
      offer.price * offer.base_quantity,
      offer.expires,
      offer.userid,
      offer.order_status,
      null,
      offer.unfilled,
    ]
    this.redisPublisher.PUBLISH(
      `broadcastmsg:all:${chainId}:${market}`,
      JSON.stringify({ op: 'orders', args: [[orderMsg]] })
    )
    if (orderupdates.length > 0) {
      this.redisPublisher.PUBLISH(
        `broadcastmsg:all:${chainId}:${market}`,
        JSON.stringify({ op: 'orderstatus', args: [orderupdates] })
      )
    }
    if (marketFills.length > 0) {
      this.redisPublisher.PUBLISH(
        `broadcastmsg:all:${chainId}:${market}`,
        JSON.stringify({ op: 'fills', args: [marketFills] })
      )
    }
    const liquidityKeys = Object.keys(liquidityUpdates)
    if (liquidityKeys.length > 0) {
      const redisKeyLiquidity = `liquidity:${chainId}:${market}`
      const liquidityList = await this.redis.ZRANGEBYSCORE(
        redisKeyLiquidity,
        '0',
        '1000000'
      )

      const lenght = Object.keys(liquidityList).length
      for (let i = 0; i < lenght; i++) {
        const liquidityString = liquidityList[i]
        const liquidity = JSON.parse(liquidityString)
        if (liquidityKeys.includes(liquidity[4].toString())) {
          // remove outdated liquidity
          this.redis.ZREM(redisKeyLiquidity, liquidityString)

          // substract filledliquidity for that orderID
          const newLiquidity = Number(liquidity[2]) - Number(liquidityUpdates[liquidity[4]])
          if (newLiquidity > Number(marketInfo.baseFee)) {
            // add new liquidity to HSET
            liquidity[2] = newLiquidity
            this.addLiquidity(chainId, market, liquidity)
          }
        }
      }
    }

    // 'remainingAmount > marketInfo.baseFee' => 'remainingAmount > 0'
    // only add to the orderbook if not filled instantly
    if (remainingAmount > marketInfo.baseFee) {
      this.addLiquidity(
        chainId,
        market,
        [side, price, remainingAmount, expiration, offer.id]
      )
    }
  }

  relayStarknetMatch = async (
    chainId: number,
    market: ZZMarket,
    buyer: any,
    seller: any,
    fillQuantity: number,
    fillPrice: number,
    fillId: number,
    makerOfferId: number,
    takerOfferId: number
  ) => {
    const marketInfo = await this.getMarketInfo(market, chainId)
    const network = getNetwork(chainId)
    const baseAssetDecimals = marketInfo.baseAsset.decimals
    const getFraction = (decimals: number) => {
      let denominator = 1
      for (; (decimals * denominator) % 1 !== 0; denominator++);
      return { numerator: decimals * denominator, denominator }
    }
    const fillPriceRatioNumber = getFraction(fillPrice)
    const calldataFillPrice = [
      fillPriceRatioNumber.numerator.toFixed(0),
      fillPriceRatioNumber.denominator.toFixed(0)
    ]
    const calldataFillQuantity = (fillQuantity * 10 ** baseAssetDecimals).toFixed(0)

    const calldataBuyOrder = [
      stringToFelt(buyer.message_prefix),
      stringToFelt(buyer.domain_prefix.name),
      buyer.domain_prefix.version,
      stringToFelt(buyer.domain_prefix.chain_id),
      buyer.sender,
      buyer.order.base_asset,
      buyer.order.quote_asset,
      buyer.order.side,
      buyer.order.base_quantity,
      buyer.order.price.numerator,
      buyer.order.price.denominator,
      buyer.order.expiration,
      buyer.sig_r,
      buyer.sig_s
    ]

    const calldataSellOrder = [
      stringToFelt(seller.message_prefix),
      stringToFelt(seller.domain_prefix.name),
      seller.domain_prefix.version,
      stringToFelt(seller.domain_prefix.chain_id),
      seller.sender,
      seller.order.base_asset,
      seller.order.quote_asset,
      seller.order.side,
      seller.order.base_quantity,
      seller.order.price.numerator,
      seller.order.price.denominator,
      seller.order.expiration,
      seller.sig_r,
      seller.sig_s
    ]

    let relayResult: any
    try {
      relayResult = await this.STARKNET_EXCHANGE[network].invoke(
        'fill_order',
        [
          calldataBuyOrder,
          calldataSellOrder,
          calldataFillPrice,
          calldataFillQuantity
        ]
      )

      console.log('Starknet tx success')
      const fillupdateBroadcast = await this.db.query(
        "UPDATE fills SET fill_status='b', txhash=$1 WHERE id=$2 RETURNING id, fill_status, txhash",
        [relayResult.transaction_hash, fillId]
      )
      const orderUpdateBroadcast = await this.db.query(
        "UPDATE offers SET order_status='b', update_timestamp=NOW() WHERE id IN ($1, $2) AND unfilled = 0 RETURNING id, order_status, unfilled",
        [makerOfferId, takerOfferId]
      )
      const orderUpdatesBroadcast = orderUpdateBroadcast.rows.map((row) => [
        chainId,
        row.id,
        row.order_status,
        row.unfilled,
      ])
      const fillUpdatesBroadcast = fillupdateBroadcast.rows.map((row) => [
        chainId,
        row.id,
        row.fill_status,
        row.txhash,
        null, // remaing
        0, // fee amount
        0, // fee amount
        Date.now() // timestamp
      ])

      if (orderUpdatesBroadcast.length) {
        this.redisPublisher.PUBLISH(
          `broadcastmsg:all:${chainId}:${market}`,
          JSON.stringify({ op: 'orderstatus', args: [orderUpdatesBroadcast] })
        )
        this.redisPublisher.PUBLISH(
          `broadcastmsg:user:${chainId}:${buyer.sender}`,
          JSON.stringify({ op: 'orderstatus', args: [orderUpdatesBroadcast] })
        )
        this.redisPublisher.PUBLISH(
          `broadcastmsg:user:${chainId}:${seller.sender}`,
          JSON.stringify({ op: 'orderstatus', args: [orderUpdatesBroadcast] })
        )
      }
      if (fillUpdatesBroadcast.length) {
        this.redisPublisher.PUBLISH(
          `broadcastmsg:all:${chainId}:${market}`,
          JSON.stringify({ op: 'fillstatus', args: [fillUpdatesBroadcast] })
        )
        this.redisPublisher.PUBLISH(
          `broadcastmsg:user:${chainId}:${buyer.sender}`,
          JSON.stringify({ op: 'fillstatus', args: [fillUpdatesBroadcast] })
        )
        this.redisPublisher.PUBLISH(
          `broadcastmsg:user:${chainId}:${seller.sender}`,
          JSON.stringify({ op: 'fillstatus', args: [fillUpdatesBroadcast] })
        )
      }

      await starknet.defaultProvider.waitForTransaction(relayResult.transaction_hash)


      console.log(`New starknet tx: ${relayResult.transaction_hash}`)

      // TODO we want to add fees here

      console.log('Starknet tx success')
      const fillupdateFill = await this.db.query(
        "UPDATE fills SET fill_status='f', txhash=$1 WHERE id=$2 RETURNING id, fill_status, txhash",
        [relayResult.transaction_hash, fillId]
      )
      const orderupdateFill = await this.db.query(
        "UPDATE offers SET order_status=(CASE WHEN unfilled > 0 THEN 'pf' ELSE 'f' END), update_timestamp=NOW() WHERE id IN ($1, $2) RETURNING id, order_status, unfilled",
        [makerOfferId, takerOfferId]
      )
      const orderUpdateFills = orderupdateFill.rows.map((row) => [
        chainId,
        row.id,
        row.order_status,
        row.unfilled,
      ])
      const fillUpdateFills = fillupdateFill.rows.map((row) => [
        chainId,
        row.id,
        row.fill_status,
        row.txhash,
        null,
        0, // fee amount - TODO this should be marketInfo fees
        0, // fee token - TODO this should be marketInfo fees
        Date.now() // timestamp
      ])

      if (orderUpdateFills.length) {
        this.redisPublisher.PUBLISH(
          `broadcastmsg:all:${chainId}:${market}`,
          JSON.stringify({ op: 'orderstatus', args: [orderUpdateFills] })
        )
        this.redisPublisher.PUBLISH(
          `broadcastmsg:user:${chainId}:${buyer.sender}`,
          JSON.stringify({ op: 'orderstatus', args: [orderUpdateFills] })
        )
        this.redisPublisher.PUBLISH(
          `broadcastmsg:user:${chainId}:${seller.sender}`,
          JSON.stringify({ op: 'orderstatus', args: [orderUpdateFills] })
        )
      }
      if (fillUpdateFills.length) {
        this.redisPublisher.PUBLISH(
          `broadcastmsg:all:${chainId}:${market}`,
          JSON.stringify({ op: 'fillstatus', args: [fillUpdateFills] })
        )
        this.redisPublisher.PUBLISH(
          `broadcastmsg:user:${chainId}:${buyer.sender}`,
          JSON.stringify({ op: 'fillstatus', args: [fillUpdateFills] })
        )
        this.redisPublisher.PUBLISH(
          `broadcastmsg:user:${chainId}:${seller.sender}`,
          JSON.stringify({ op: 'fillstatus', args: [fillUpdateFills] })
        )
      }
    } catch (e: any) {
      console.log(`Starknet tx failed: ${relayResult.transaction_hash}`)
      console.error(calldataBuyOrder)
      console.error(calldataSellOrder)
      console.error(calldataFillPrice)
      console.error(calldataFillQuantity)
      console.error(e)
      console.error('Starknet tx failed')
      const rejectedFillupdate = await this.db.query(
        "UPDATE fills SET fill_status='r', txhash=$1 WHERE id=$2 RETURNING id, fill_status, txhash",
        [relayResult.transaction_hash, fillId]
      )
      const rejectedOrderupdate = await this.db.query(
        "UPDATE offers SET order_status='r', update_timestamp=NOW() WHERE id IN ($1, $2) RETURNING id, order_status",
        [makerOfferId, takerOfferId]
      )
      const rejectedFillUpdates = rejectedFillupdate.rows.map((row) => [
        chainId,
        row.id,
        row.fill_status,
        row.txhash,
        0, // remaining
        0, // fee amount
        0, // fee amount
        Date.now() // timestamp
      ])
      const rejectedOrderUpdates = rejectedOrderupdate.rows.map((row) => [
        chainId,
        row.id,
        row.order_status,
        relayResult.transaction_hash,
        e.message
      ])
      this.redisPublisher.PUBLISH(
        `broadcastmsg:all:${chainId}:${market}`,
        JSON.stringify({ op: 'orderstatus', args: [rejectedOrderUpdates] })
      )
      this.redisPublisher.PUBLISH(
        `broadcastmsg:user:${chainId}:${buyer.sender}`,
        JSON.stringify({ op: 'orderstatus', args: [rejectedOrderUpdates] })
      )
      this.redisPublisher.PUBLISH(
        `broadcastmsg:user:${chainId}:${seller.sender}`,
        JSON.stringify({ op: 'orderstatus', args: [rejectedOrderUpdates] })
      )

      this.redisPublisher.PUBLISH(
        `broadcastmsg:all:${chainId}:${market}`,
        JSON.stringify({ op: 'fillstatus', args: [rejectedFillUpdates] })
      )
      this.redisPublisher.PUBLISH(
        `broadcastmsg:user:${chainId}:${buyer.sender}`,
        JSON.stringify({ op: 'fillstatus', args: [rejectedFillUpdates] })
      )
      this.redisPublisher.PUBLISH(
        `broadcastmsg:user:${chainId}:${seller.sender}`,
        JSON.stringify({ op: 'fillstatus', args: [rejectedFillUpdates] })
      )
    }
  }

  cancelallorders = async (
    chainId: number,
    userid: string | number
  ) => {
    let orders: any
    if (chainId) {
      // cancel for chainId set
      const values = [userid, chainId]
      orders = await this.db.query(
        "UPDATE offers SET order_status='c',zktx=NULL, update_timestamp=NOW() WHERE userid=$1 AND chainid=$2 AND order_status='o' RETURNING chainid, id, order_status;",
        values
      )
    } else {
      // cancel for all chainIds - chainId not set
      const values = [userid]
      orders = await this.db.query(
        "UPDATE offers SET order_status='c',zktx=NULL, update_timestamp=NOW() WHERE userid=$1 AND order_status='o' RETURNING chainid, id, order_status;",
        values
      )
    }

    if (orders.rows.length === 0) throw new Error('No open Orders')

    this.VALID_CHAINS.forEach(async (broadcastChainId) => {
      const orderStatusUpdate = orders.rows
        .filter((o: any) => Number(o.chainid) === broadcastChainId)
        .map((o: any) => [
          o.chainid,
          o.id,
          o.order_status
        ])

      await this.redisPublisher.publish(
        `broadcastmsg:all:${broadcastChainId}:all`,
        JSON.stringify({ op: 'orderstatus', args: [orderStatusUpdate], })
      )
      await this.redisPublisher.publish(
        `broadcastmsg:user:${broadcastChainId}:${userid}`,
        JSON.stringify({ op: 'orderstatus', args: [orderStatusUpdate], })
      )
    })

    return true
  }

  cancelorder = async (
    chainId: number,
    orderId: string,
    ws?: WSocket
  ) => {
    const values = [orderId, chainId]
    const select = await this.db.query(
      'SELECT userid, order_status FROM offers WHERE id=$1 AND chainid=$2',
      values
    )

    if (select.rows.length === 0) {
      throw new Error('Order not found')
    }

    const userconnkey = `${chainId}:${select.rows[0].userid}`

    if (select.rows[0].order_status !== 'o') {
      throw new Error('Order is no longer open')
    }

    if (this.USER_CONNECTIONS[userconnkey] !== ws) {
      throw new Error('Unauthorized')
    }

    const updatevalues = [orderId]
    const update = await this.db.query(
      "UPDATE offers SET order_status='c', zktx=NULL, update_timestamp=NOW() WHERE id=$1 RETURNING market",
      updatevalues
    )

    if (update.rows.length > 0) {
      await this.redisPublisher.publish(
        `broadcastmsg:all:${chainId}:${update.rows[0].market}`,
        JSON.stringify({ op: 'orderstatus', args: [[[chainId, orderId, 'c']]], })
      )
    } else {
      throw new Error('Order not found')
    }

    return true
  }

  matchorder = async (
    chainId: number,
    orderId: string,
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

    // Determine fill price
    const marketInfo = await this.getMarketInfo(selectresult.market, chainId)
    let baseQuantity: number
    let quoteQuantity: number

    if (selectresult.side === 's') {
      baseQuantity = selectresult.base_quantity
      quoteQuantity = Number(fillOrder.amount) / 10 ** marketInfo.quoteAsset.decimals
    } else if (selectresult.side === 'b') {
      baseQuantity = Number(fillOrder.amount) / 10 ** marketInfo.baseAsset.decimals
      quoteQuantity = selectresult.quote_quantity
    } else {
      throw new Error(`Side ${selectresult.side} is not valid!`)
    }

    const fillPrice = formatPrice(quoteQuantity / baseQuantity)
    const redisMembers: any = {
      score: fillPrice,
      value: JSON.stringify({
        "zktx": JSON.parse(selectresult.zktx),
        "market": selectresult.market,
        "baseQuantity": selectresult.base_quantity,
        "quoteQuantity": selectresult.quote_quantity,
        "userId": selectresult.userid,
        "fillOrder": fillOrder,
        "wsUUID": wsUUID
      })
    }

    const redisKey = `matchingorders:${chainId}:${orderId}`
    const existingMembers = await this.redis.ZCOUNT(redisKey, 0, 99999999)
    this.redis.ZADD(redisKey, redisMembers)
    if (existingMembers === 0) {
      this.redis.EXPIRE(redisKey, 10)
      setTimeout(() => {
        this.redis.SET(redisKeyOrder, 'filled', { EX: 60 })
        this.senduserordermatch(
          chainId,
          orderId,
          selectresult.side
        )
      }, 250)
    }
  }

  senduserordermatch = async (
    chainId: number,
    orderId: string,
    side: string
  ) => {
    const redisKeyMatchingOrder = `matchingorders:${chainId}:${orderId}`
    const existingMembers = await this.redis.ZCOUNT(redisKeyMatchingOrder, -Infinity, Infinity)
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
    const redisKeyBussy = `bussymarketmaker:${chainId}:${makerAccountId}`
    try {
      // const redisBusyMM = (await this.redis.get(redisKeyBussy)) as string
      const redisBusyMM = ''
      if (redisBusyMM) {
        const processingOrderId: number = (JSON.parse(redisBusyMM) as any).orderId
        const remainingTime = await this.redis.ttl(redisKeyBussy)
        this.redisPublisher.PUBLISH(
          `broadcastmsg:maker:${chainId}:${value.wsUUID}`,
          JSON.stringify({
            op: 'error',
            args: [
              'fillrequest',
              makerAccountId,
              `Your address did not respond to order (${processingOrderId}) yet. Remaining timeout: ${remainingTime}.`
            ]
          })
        )
        throw new Error('fillrequest - market maker is timed out.')
      }


      let priceWithoutFee: string
      try {
        const marketInfo = await this.getMarketInfo(value.market, chainId)
        if (side === 's') {
          const quoteQuantity = Number(fillOrder.amount) / 10 ** marketInfo.quoteAsset.decimals
          const baseQuantityWithoutFee = value.baseQuantity - marketInfo.baseFee
          priceWithoutFee = formatPrice(quoteQuantity / baseQuantityWithoutFee)
        } else {
          const baseQuantity = Number(fillOrder.amount) / 10 ** marketInfo.baseAsset.decimals
          const quoteQuantityWithoutFee = value.quoteQuantity - marketInfo.quoteFee
          priceWithoutFee = formatPrice(quoteQuantityWithoutFee / baseQuantity)
        }
      } catch (e: any) {
        console.log(e.message)
        priceWithoutFee = fillPrice.toString()
      }

      let values = [orderId, chainId]
      const update1 = await this.db.query(
        "UPDATE offers SET order_status='m' WHERE id=$1 AND chainid=$2 AND order_status='o' RETURNING id",
        values
      )
      if (update1.rows.length === 0)
        // this *should* not happen, so no need to send to ws
        throw new Error(`Order ${orderId} is not open`)

      values = [
        chainId,
        value.market,
        orderId,
        value.userId,
        makerAccountId,
        priceWithoutFee,
        value.baseQuantity,
        side,
      ]
      const update2 = await this.db.query(
        "INSERT INTO fills (chainid, market, taker_offer_id, taker_user_id, maker_user_id, price, amount, side, fill_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'm') RETURNING id",
        values
      )
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
        JSON.stringify({ op: 'orderstatus', args: [[[chainId, orderId, 'm']]], })
      )

      this.redis.SET(
        redisKeyBussy,
        JSON.stringify({ "orderId": orderId, "ws_uuid": value.wsUUID }),
        { EX: this.MARKET_MAKER_TIMEOUT }
      )
    } catch (err: any) {
      if (err.message.includes('is not open')) {
        console.log(`Failed to match order because ${err.message}. Abort`)
      } else {
        console.log(`Failed to match order because ${err.message}, sending next best`)
        // try next best one
        this.senduserordermatch(
          chainId,
          orderId,
          side
        )
      }
      return
    }

    try {
      // send result to other mm's, remove set
      const otherMakerList: any[] = await this.redis.ZRANGE(redisKeyMatchingOrder, 0, -1)
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
              `Order ${orderId} was filled by better offer`
            ],
          })
        )
      })
    } catch (err: any) {
      console.log(`senduserordermatch: Error while updating other mms: ${err.message}`)
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
  broadcastMessage = async (
    chainId: number,
    market: ZZMarket,
    msg: string
  ) => {
    ; (this.wss.clients as Set<WSocket>).forEach((ws: WSocket) => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (ws.chainid !== chainId) return
      if (market !== "all" && !ws.marketSubscriptions.includes(market)) return
      ws.send(msg)
    })
  }

  /**
   * Send msg to user
   * @param chainId 
   * @param userId user ws id like: `${chainId}:${userid}`
   * @param msg JSON.stringify( WSMessage )
   */
  sendMessageToUser = async (
    chainId: number,
    userId: string,
    msg: string
  ) => {
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
   * @param {number} chainId The reqested chain (1->zkSync, 1000->zkSync_rinkeby)
   * @param {ZZMarket} market The reqested market
   * @param {number} depth Depth of returned liquidity (depth/2 buckets per return)
   * @param {number} level Level of returned liquidity (1->best ask/bid, 2->0.05% steps, 3->all)
   * @return {number} The resulting liquidity -> {"timestamp": _, "bids": _, "asks": _}
   */
  getLiquidityPerSide = async (
    chainId: number,
    market: ZZMarket,
    depth = 0,
    level = 3
  ) => {
    const timestamp = Date.now()
    if (level === 1) {
      // Level 1 – Only best bid and ask.
      const bestAsk = await this.redis.HGET(`bestask:${chainId}`, market)
      const bestBid = await this.redis.HGET(`bestbid:${chainId}`, market)
      return {
        timestamp,
        bids: bestAsk ? [bestAsk] : [],
        asks: bestBid ? [bestBid] : [],
      }
    }

    const liquidity: any[] = await this.getSnapshotLiquidity(chainId, market)
    if (liquidity.length === 0) {
      return {
        timestamp,
        bids: [],
        asks: [],
      }
    }

    // sort for bids and asks
    let bids: number[][] = liquidity
      .filter((l) => l[0] === 'b')
      .map((l) => [Number(l[1]), Number(l[2])])
      .reverse()
    let asks: number[][] = liquidity
      .filter((l) => l[0] === 's')
      .map((l) => [Number(l[1]), Number(l[2])])

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
      `level': ${level} is not supported for getLiquidityPerSide. Use 1, 2 or 3`
    )
  }

  addLiquidity = async (
    chainId: number,
    market: ZZMarket,
    liquidity: any[]
  ) => {
    const redisKeyLiquidity = `liquidity:${chainId}:${market}`
    const redisMember = {
      score: Number(liquidity[1]),
      value: JSON.stringify(liquidity),
    }
    this.redis.ZADD(
      redisKeyLiquidity,
      redisMember
    )
    this.redis.SADD(`activemarkets:${chainId}`, market)
  }

  // The liquidity here gets wiped regularly so it's very unreliable
  // YOu want to use getSnapshotLiquidity most of the time and it's a 
  // drop in replacement for this
  getLiquidity = async (
    chainId: number,
    market: ZZMarket
  ) => {
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

  getSnapshotLiquidity = async (
    chainId: number,
    market: ZZMarket
  ) => {
    const redisKeyLiquidity = `bestliquidity:${chainId}:${market}`
    const liquidityString = await this.redis.GET(redisKeyLiquidity)
    const liquidity = liquidityString ? JSON.parse(liquidityString) : []
    return liquidity
  }

  getopenorders = async (chainId: number, market: string) => {
    chainId = Number(chainId)
    const query = {
      text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,unfilled,txhash FROM offers WHERE market=$1 AND chainid=$2 AND order_status IN ('o', 'pm', 'pf')",
      values: [market, chainId],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    return select.rows
  }

  getOrder = async (chainId: number, orderId: string | string[]) => {
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

  getFill = async (chainId: number, orderId: string | string[]) => {
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
      text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status FROM offers WHERE chainid=$1 AND userid=$2 AND order_status IN ('o','pm','pf') ORDER BY id DESC LIMIT 25",
      values: [chainId, userid],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    return select.rows
  }

  /**
   * Returns fills for a given market.
   * @param {number} chainId reqested chain (1->zkSync, 1000->zkSync_rinkeby)
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
    market: ZZMarket,
    limit?: number,
    orderId?: number,
    type?: string,
    startTime?: number,
    endTime?: number,
    accountId?: number,
    direction?: string
  ) => {
    let text = "SELECT chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id,feeamount,feetoken,insert_timestamp FROM fills WHERE chainid=$1 AND fill_status='f'"

    if (market) {
      text += ` AND market = '${market}'`
    }

    let sqlDirection = "DESC"
    if (direction) {
      if (direction === "older") {
        sqlDirection = "DESC"
      } else if (direction === "newer") {
        sqlDirection = "ASC"
      } else {
        throw new Error("Only direction 'older' or 'newer' is allowed.")
      }
    }

    if (orderId) {
      if (sqlDirection === "DESC") {
        text += ` AND id <= '${orderId}'`
      } else {
        text += ` AND id >= '${orderId}'`
      }
    }

    if (type) {
      let side
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

    limit = limit ? Math.min(25, Number(limit)) : 25
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

  getLastPrices = async (
    chainId: number,
    markets: ZZMarket[] = []
  ) => {
    const redisKeyPriceInfo = `lastpriceinfo:${chainId}`

    if (markets.length === 1) {
      const redisPriceInfo = await this.redis.HGET(redisKeyPriceInfo, markets[0])
      if (!redisPriceInfo) return []
      const priceInfo = JSON.parse(redisPriceInfo)
      return [
        markets[0],
        +priceInfo.price,
        priceInfo.priceChange,
        priceInfo.quoteVolume,
        priceInfo.baseVolume
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
      if (!redisString) return []
      const priceInfo = JSON.parse(redisString)
      if (!redisPriceInfo) return []
      lastprices.push([
        markets[i],
        +priceInfo.price,
        priceInfo.priceChange,
        priceInfo.quoteVolume,
        priceInfo.baseVolume
      ])
    }
    return lastprices
  }

  getMarketSummarys = async (
    chainId: number,
    markets: string[] = []
  ) => {
    const marketSummarys: any = {}
    const redisKeyMarketSummary = `marketsummary:${chainId}`

    if (markets.length === 1) {
      const marketId: ZZMarket = markets[0]
      const redisMarketSummaryString = await this.redis.HGET(redisKeyMarketSummary, marketId)
      if (redisMarketSummaryString) {
        marketSummarys[marketId] = JSON.parse(redisMarketSummaryString) as ZZMarketSummary
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
        marketSummarys[marketId] = JSON.parse(redisMarketSummaryString) as ZZMarketSummary
      } else {
        marketSummarys[marketId] = null
      }
    }
    return marketSummarys
  }

  // Ladder has to be a sorted 2-D array contaning price and quantity
  // Example: [ [3500,1], [3501,2] ]
  static getQuoteFromLadder(ladder: any[][], qty: number): number {
    let sum = 0
    let unfilledQuantity = qty

    for (let i = 0; i < ladder.length; i++) {
      const askPrice = ladder[i][0]
      const askQuantity = ladder[i][1]
      if (askQuantity >= unfilledQuantity) {
        sum += unfilledQuantity * askPrice
        unfilledQuantity = 0
        break
      } else {
        sum += askQuantity * askPrice
        unfilledQuantity -= askQuantity
      }
    }
    if (unfilledQuantity > 0) throw new Error('Insufficient liquidity')
    const avgPrice = sum / qty
    return avgPrice
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
    if (![1, 1000].includes(chainId))
      throw new Error('Quotes not supported for this chain')
    if (!['b', 's'].includes(side)) throw new Error('Invalid side')

    if (baseQuantity) baseQuantity = Number(baseQuantity)
    if (quoteQuantity) quoteQuantity = Number(quoteQuantity)
    if (baseQuantity && baseQuantity <= 0)
      throw new Error('Quantity must be positive')
    if (quoteQuantity && quoteQuantity <= 0)
      throw new Error('Quantity must be positive')

    const marketInfo = await this.getMarketInfo(market, chainId)
    const liquidity = await this.getSnapshotLiquidity(chainId, market)
    if (liquidity.length === 0) throw new Error('No liquidity for pair')

    let softQuoteQuantity: any
    let hardQuoteQuantity: any
    let softBaseQuantity: any
    let hardBaseQuantity: any
    let softPrice: any
    let hardPrice: any
    let ladderPrice: any

    if (baseQuantity) {
      if (baseQuantity < marketInfo.baseFee)
        throw new Error('Amount is inadequate to pay fee')

      if (side !== 'b' && side !== 's') {
        throw new Error('Side must be "s" or "b"')
      }

      if (side === 'b') {
        const asks = liquidity
          .filter((l: string) => l[0] === 's')
          .map((l: string) => l.slice(1, 3)) as any[]
        ladderPrice = API.getQuoteFromLadder(asks, baseQuantity)
      } else {
        const bids = liquidity
          .filter((l: string) => l[0] === 'b')
          .map((l: string) => l.slice(1, 3))
          .reverse() as any[]
        ladderPrice = API.getQuoteFromLadder(bids, baseQuantity)
      }

      hardBaseQuantity = +baseQuantity.toFixed(marketInfo.baseAsset.decimals)

      if (side === 'b') {
        hardQuoteQuantity = +(
          baseQuantity * ladderPrice +
          marketInfo.quoteFee
        ).toFixed(marketInfo.baseAsset.decimals)
        hardPrice = formatPrice(hardQuoteQuantity / hardBaseQuantity)
        softPrice = formatPrice(hardPrice * 1.001)
      } else {
        hardQuoteQuantity = (
          (baseQuantity - marketInfo.baseFee) *
          ladderPrice
        ).toFixed(marketInfo.baseAsset.decimals)
        hardPrice = formatPrice(hardQuoteQuantity / hardBaseQuantity)
        softPrice = formatPrice(hardPrice * 0.999)
      }

      softBaseQuantity = baseQuantity.toFixed(marketInfo.baseAsset.decimals)
      softQuoteQuantity = (baseQuantity * softPrice).toFixed(
        marketInfo.quoteAsset.decimals
      )
    } else if (quoteQuantity) {
      if (quoteQuantity < marketInfo.quoteFee)
        throw new Error('Amount is inadequate to pay fee')

      hardQuoteQuantity = quoteQuantity.toFixed(marketInfo.quoteAsset.decimals)

      if (side === 'b') {
        const asks: any[] = liquidity
          .filter((l: any) => l[0] === 's')
          .map((l: any) => [l[1], Number(l[1]) * Number(l[2])])
        ladderPrice = API.getQuoteFromLadder(asks, quoteQuantity)

        hardBaseQuantity = (
          (quoteQuantity - marketInfo.quoteFee) /
          ladderPrice
        ).toFixed(marketInfo.baseAsset.decimals)
        hardPrice = formatPrice(hardQuoteQuantity / hardBaseQuantity)
        softPrice = formatPrice(hardPrice * 1.0005)
      } else {
        const bids = liquidity
          .filter((l: any) => l[0] === 'b')
          .map((l: any) => [l[1], Number(l[1]) * Number(l[2])])
        ladderPrice = API.getQuoteFromLadder(bids, quoteQuantity)

        hardBaseQuantity = (
          quoteQuantity / ladderPrice +
          marketInfo.baseFee
        ).toFixed(marketInfo.baseAsset.decimals)
        hardPrice = formatPrice(hardQuoteQuantity / Number(hardBaseQuantity))
        softPrice = formatPrice(hardPrice * 0.9995)
      }

      softQuoteQuantity = quoteQuantity.toFixed(marketInfo.quoteAsset.decimals)
      softBaseQuantity = (quoteQuantity / softPrice).toFixed(
        marketInfo.baseAsset.decimals
      )
    }

    if (Number.isNaN(softPrice) || Number.isNaN(hardPrice))
      throw new Error('Internal Error. No price generated.')

    return {
      softPrice,
      hardPrice,
      softQuoteQuantity,
      hardQuoteQuantity,
      softBaseQuantity,
      hardBaseQuantity,
    }
  }

  clearDeadConnections = () => {
    const numberUsers = Object.keys(this.USER_CONNECTIONS).length
    const numberMMs = Object.keys(this.MAKER_CONNECTIONS).length
    console.log(`Active WS connections: USER_CONNECTIONS: ${numberUsers}, MAKER_CONNECTIONS: ${numberMMs}`)
      ; (this.wss.clients as Set<WSocket>).forEach((ws) => {
        if (!ws.isAlive) {
          const userconnkey = `${ws.chainid}:${ws.userid}`
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
    const result = this.VALID_CHAINS.map(async (chainId) => {
      const markets = await this.redis.SMEMBERS(`activemarkets:${chainId}`)
      if (!markets || markets.length === 0) return
      const results: Promise<any>[] = markets.map(async (marketId) => {
        const liquidity = await this.getSnapshotLiquidity(chainId, marketId)
        if (liquidity) {
          this.broadcastMessage(
            chainId,
            marketId,
            JSON.stringify({ op: 'liquidity2', args: [chainId, marketId, liquidity] })
          )
        }
      })

      // Broadcast last prices
      const lastprices = (await this.getLastPrices(chainId)).map((l) =>
        l.splice(0, 3)
      )
      this.broadcastMessage(
        chainId,
        'all',
        JSON.stringify({ op: 'lastprice', args: [lastprices] })
      )

      // eslint-disable-next-line consistent-return
      return Promise.all(results)
    })

    return Promise.all(result)
  }

  updateLiquidity = async (
    chainId: number,
    market: ZZMarket,
    liquidity: any[],
    clientId: string
  ) => {
    const NINE_SECONDS = ((Date.now() / 1000) | 0) + 9
    const marketInfo = await this.getMarketInfo(market, chainId)

    const redisKeyPassive = `passivews:${chainId}:${clientId}`
    const msg = await this.redis.get(redisKeyPassive)
    if (msg) {
      const remainingTime = await this.redis.ttl(redisKeyPassive)
      throw new Error(`Your address did not respond to order ${msg
        } yet. Remaining timeout: ${remainingTime}.`
      )
    }

    const [baseToken, quoteToken] = market.split('-')
    const basePrice = await this.getUsdPrice(chainId, baseToken)
    const quotePrice = await this.getUsdPrice(chainId, quoteToken)
    const midPrice = (basePrice && quotePrice)
      ? basePrice / quotePrice
      : 0

    // $100 min size
    const minSize = (basePrice) ? (100 / basePrice) : marketInfo.baseFee

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
      } else if (amount < minSize) {
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
        await this.redis.HSET(redisKeyLiquidity, clientId, JSON.stringify(redisMembers))
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
  
  populateV1TokenIds = async () => {
    for (let i = 0; ;) {
      const result: any = (await fetch(
        `https://api.zksync.io/api/v0.2/tokens?from=${i}&limit=100&direction=newer`
      ).then((r: any) => r.json())) as AnyObject
      const { list } = result.result
      if (list.length === 0) {
        break
      } else {
        list.forEach((l: any) => {
          this.V1_TOKEN_IDS[l.id] = l.symbol
        })
        i += 100
      }
    }
  }

  getV1Markets = async (chainId: number) => {
    const v1Prices = await this.getLastPrices(chainId)
    const v1markets = v1Prices.map((l) => l[0])
    return v1markets
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
}
