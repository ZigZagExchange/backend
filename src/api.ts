// SPDX-License-Identifier: BUSL-1.1
import fetch from 'isomorphic-fetch'
import { EventEmitter } from 'events'
import { zksyncOrderSchema, ZZMessageSchema } from 'src/schemas'
import { WebSocket } from 'ws'
import fs from 'fs'
import * as zksync from 'zksync'
import { ethers } from 'ethers'
import * as starknet from 'starknet'
import type { Pool } from 'pg'
import type { RedisClientType } from 'redis'
import * as services from 'src/services'
import type {
  PriceRatio,
  ZZ_Message,
  sCOrder,
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
import { formatPrice } from 'src/utils'

export default class API extends EventEmitter {
  USER_CONNECTIONS: AnyObject = {}
  MAKER_CONNECTIONS: AnyObject = {}
  V1_TOKEN_IDS: AnyObject = {}
  SYNC_PROVIDER: AnyObject = {}
  ETHERS_PROVIDER: AnyObject = {}
  ZKSYNC_BASE_URL: AnyObject = {}
  MARKET_MAKER_TIMEOUT = 300
  SET_MM_PASSIVE_TIME = 20
  VALID_CHAINS: number[] = [1, 1000, 1001]
  VALID_CHAINS_ZKSYNC: number[] = [1, 1000]
  ERC20_ABI: any
  DEFAULT_CHAIN = process.env.DEFAULT_CHAIN_ID
    ? Number(process.env.DEFAULT_CHAIN_ID)
    : 1
  starknetContract: any

  watchers: NodeJS.Timer[] = []
  started = false
  wss: ZZSocketServer
  redis: RedisClientType
  http: ZZHttpServer
  db: Pool

  constructor(
    wss: ZZSocketServer,
    db: Pool,
    http: ZZHttpServer,
    redis: RedisClientType
  ) {
    super()
    this.db = db
    this.redis = redis
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

    await this.redis.connect()

    this.watchers = [
      setInterval(this.updatePriceHighLow, 300000),
      setInterval(this.updateVolumes, 120000),
      setInterval(this.clearDeadConnections, 60000),
      setInterval(this.updatePendingOrders, 60000),
      setInterval(this.updateUsdPrice, 12500),
      setInterval(this.updateFeesZkSync, 30010),
      // setInterval(this.updatePassiveMM, 10000),
      setInterval(this.broadcastLiquidity, 4000),
    ]

    // update updatePriceHighLow once
    setTimeout(this.updatePriceHighLow, 10000)

    // reset redis mm timeouts
    this.VALID_CHAINS.map(async (chainid) => {
      const redisPatternBussy = `bussymarketmaker:${chainid}:*`
      const keysBussy = await this.redis.keys(redisPatternBussy)
      keysBussy.forEach(async (key: string) => {
        this.redis.del(key)
      })
      const redisPatternPassiv = `passivews:${chainid}:*`
      const keysPassiv = await this.redis.keys(redisPatternPassiv)
      keysPassiv.forEach(async (key: string) => {
        this.redis.del(key)
      })
    })

    // reset liquidityKeys
    this.VALID_CHAINS.map(async (chainid) => {
      const liquidityKeys = await this.redis.KEYS(`liquidity:${chainid}:*`)
      liquidityKeys.forEach(async (key) => {
        await this.redis.DEL(key)
      })
    })

    this.ERC20_ABI = JSON.parse(
      fs.readFileSync(
        'abi/ERC20.abi',
        'utf8'
      )
    )

    this.starknetContract = JSON.parse(
      fs.readFileSync(
        'abi/starknet_v1.abi',
        'utf8'
      )
    )

    this.ZKSYNC_BASE_URL.mainnet = "https://api.zksync.io/api/v0.2/"
    this.ZKSYNC_BASE_URL.rinkeby = "https://rinkeby-api.zksync.io/api/v0.2/"
    this.SYNC_PROVIDER.mainnet = await zksync.getDefaultRestProvider("mainnet")
    this.SYNC_PROVIDER.rinkeby = await zksync.getDefaultRestProvider("rinkeby")

    this.ETHERS_PROVIDER.mainnet =
      new ethers.providers.InfuraProvider("mainnet", process.env.INFURA_PROJECT_ID,)
    this.ETHERS_PROVIDER.rinkeby =
      new ethers.providers.InfuraProvider("rinkeby", process.env.INFURA_PROJECT_ID,)

    await this.updateTokenInfo()

    this.started = true

    this.http.listen(port, () => {
      console.log(`Server listening on port ${port}.`)
    })
  }

  stop = async () => {
    if (!this.started) return
    await this.redis.disconnect()
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
   * Used to initialy fetch tokens infos on startup & updated on each recycle
   * @param chainId 
   */
  updateTokenInfo = async (
    chainId = this.DEFAULT_CHAIN
  ) => {
    let index = 0
    let tokenInfos
    const network = await this.getNetwork(chainId)
    do {
      const fetchResult = await fetch(`${this.ZKSYNC_BASE_URL[network]}tokens?from=${index}&limit=100&direction=newer`).then((r: any) => r.json())
      tokenInfos = fetchResult.result.list
      const results1: Promise<any>[] = tokenInfos.map(async (tokenInfo: any) => {
        const tokenSymbol = tokenInfo.symbol
        if (!tokenSymbol.includes("ERC20")) {
          tokenInfo.usdPrice = 0
          tokenInfo.name = await this.getTokenName(
            chainId,
            tokenInfo.address,
            tokenSymbol
          )
          this.redis.HSET(
            `tokeninfo:${chainId}`,
            tokenSymbol,
            JSON.stringify(tokenInfo)
          )
        }
      })
      await Promise.all(results1)
      index = tokenInfos[tokenInfos.length - 1].id
    } while (tokenInfos.length > 99)
  }

  /**
   * Get the full token name from L1 ERC20 contract
   * @param contractAddress 
   * @param tokenSymbol 
   * @returns full token name
   */
  getTokenName = async (
    chainId: number,
    contractAddress: string,
    tokenSymbol: string
  ) => {
    if (tokenSymbol === "ETH") {
      return "Ethereum"
    }
    const network = await this.getNetwork(chainId)
    let name
    try {
      const contract = new ethers.Contract(
        contractAddress,
        this.ERC20_ABI,
        this.ETHERS_PROVIDER[network]
      )
      name = await contract.name()
    } catch (e) {
      console.error(e)
      name = tokenSymbol
    }
    return name
  }

  /**
   * Update the fee for each token on regular basis
   */
  updateFeesZkSync = async () => {
    console.time("Update fees")
    const results0: Promise<any>[] = this.VALID_CHAINS_ZKSYNC.map(async (chainId: number) => {
      const newFees: any = {}
      const network = await this.getNetwork(chainId)
      // get redis cache
      const tokenInfos: any = await this.redis.HGETALL(`tokeninfo:${chainId}`)
      const markets = await this.redis.SMEMBERS(`activemarkets:${chainId}`)
      // get every token form activemarkets once
      let tokenSymbols = markets.join('-').split('-')
      tokenSymbols = tokenSymbols.filter((x, i) => i === tokenSymbols.indexOf(x))
      // update fee for each
      const results1: Promise<any>[] = tokenSymbols.map(async (tokenSymbol: string) => {
        let fee = 0
        const tokenInfoString = tokenInfos[tokenSymbol]
        if (!tokenInfoString) return

        const tokenInfo = JSON.parse(tokenInfoString)
        if (!tokenInfo) return
        // enabledForFees -> get fee dircectly form zkSync
        if (tokenInfo.enabledForFees) {
          try {
            const feeReturn = await this.SYNC_PROVIDER[network].getTransactionFee(
              "Swap",
              '0x88d23a44d07f86b2342b4b06bd88b1ea313b6976',
              tokenSymbol
            )
            fee = Number(
              this.SYNC_PROVIDER[network].tokenSet
                .formatToken(
                  tokenSymbol,
                  feeReturn.totalFee
                )
            )
          } catch (e: any) {
            console.log(`Can't get fee for ${tokenSymbol}, error: ${e.message}`)
          }
        }
        // not enabledForFees -> use token price and USDC fee
        if (!fee) {
          try {
            const usdPrice: number = (tokenInfo.usdPrice) ? Number(tokenInfo.usdPrice) : 0
            const usdReferenceString = await this.redis.HGET(`tokenfee:${chainId}`, "USDC")
            const usdReference: number = (usdReferenceString) ? Number(usdReferenceString) : 0
            if (usdPrice > 0) {
              fee = (usdReference / usdPrice)
            }
          } catch (e) {
            console.log(`Can't get fee per reference for ${tokenSymbol}, error: ${e}`)
          }
        }

        // save new fee
        newFees[tokenSymbol] = fee
        if (fee) {
          this.redis.HSET(
            `tokenfee:${chainId}`,
            tokenSymbol,
            fee
          )
        }
      })
      await Promise.all(results1)

      // check if fee's have changed
      const marketInfos = await this.redis.HGETALL(`marketinfo:${chainId}`)
      const results2: Promise<any>[] = markets.map(async (market: ZZMarket) => {
        if (!marketInfos[market]) return
        const marketInfo = JSON.parse(marketInfos[market])
        const newBaseFee = newFees[marketInfo.baseAsset.symbol]
        const newQuoteFee = newFees[marketInfo.quoteAsset.symbol]
        let updated = false
        if (newBaseFee && marketInfo.baseFee !== newBaseFee) {
          marketInfo.baseFee = (Number(newFees[marketInfo.baseAsset.symbol]) * 1.05)
          updated = true
        }
        if (newQuoteFee && marketInfo.quoteFee !== newQuoteFee) {
          marketInfo.quoteFee = (Number(newFees[marketInfo.quoteAsset.symbol]) * 1.05)
          updated = true
        }
        if (updated) {
          this.redis.HSET(
            `marketinfo:${chainId}`,
            market,
            JSON.stringify(marketInfo)
          )
          const marketInfoMsg = { op: 'marketinfo', args: [marketInfo] }
          this.broadcastMessage(chainId, market, marketInfoMsg)
        }
      })
      await Promise.all(results2)
    })
    await Promise.all(results0)
    console.timeEnd("Update fees")
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

    const redis_key = `marketinfo:${chainId}`
    const cache = await this.redis.HGET(
      redis_key,
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
      const network = await this.getNetwork(chainId)
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

    const redisKey = `marketinfo:${chainId}`
    await this.redis.HSET(
      redisKey,
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
    chainid: number,
    orderid: number,
    newstatus: string,
    txhash: string
  ) => {
    chainid = Number(chainid)
    orderid = Number(orderid)

    if (chainid === 1001) throw new Error('Not for Starknet orders')

    let update
    let fillId
    let market
    let userId
    let fillPrice
    let side
    let maker_user_id
    try {
      const valuesOffers = [newstatus, txhash, chainid, orderid]
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
      const marketInfo = await this.getMarketInfo(market, chainid)
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
      const valuesFills = [newstatus, feeAmount, feeToken, orderid, chainid]
      const update2 = await this.db.query(
        "UPDATE fills SET fill_status=$1,feeamount=$2,feetoken=$3 WHERE taker_offer_id=$4 AND chainid=$5 AND fill_status IN ('b', 'm') RETURNING id, market, price, amount, maker_user_id, insert_timestamp",
        valuesFills
      )
      if (update2.rows.length > 0) {
        fillId = update2.rows[0].id
        fillPrice = update2.rows[0].price
        maker_user_id = update2.rows[0].maker_user_id
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
      const redis_key_today_price = `dailyprice:${chainid}:${market}:${today}`
      this.redis.HSET(`lastprices:${chainid}`, `${market}`, `${fillPrice}`)
      this.redis.SET(`${redis_key_today_price}`, `${fillPrice}`, { EX: 604800 })
    }
    return {
      success,
      fillId,
      market,
      fillPrice,
      maker_user_id,
      feeAmount,
      feeToken,
      timestamp,
      userId,
    }
  }

  updateMatchedOrder = async (
    chainid: number,
    orderid: number,
    newstatus: string,
    txhash: string
  ) => {
    chainid = Number(chainid)
    orderid = Number(orderid)
    let update
    let fillId
    let market
    const values = [newstatus, txhash, chainid, orderid]
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
    chainid: number,
    market: ZZMarket,
    zktx: ZkTx
  ) => {
    chainid = Number(chainid)

    const inputValidation = zksyncOrderSchema.validate(zktx)
    if (inputValidation.error) throw inputValidation.error
    if (chainid !== 1 && chainid !== 1000) throw new Error("Only for zkSync")
    if ((zktx.validUntil * 1000) < Date.now()) throw new Error("Wrong expiry, check PC clock")

    // TODO: Activate nonce check here
    // if(NONCES[zktx.accountId] && NONCES[zktx.accountId][chainid] && NONCES[zktx.accountId][chainid] > zktx.nonce) {
    //    throw new Error("badnonce");
    // }

    // Prevent DOS attacks. Rate limit one order every 3 seconds.
    const redis_rate_limit_key = `ratelimit:zksync:${chainid}:${zktx.accountId}`
    const ratelimit = await this.redis.get(redis_rate_limit_key)
    if (ratelimit) throw new Error('Only one order per 3 seconds allowed')
    else {
      await this.redis.SET(
        redis_rate_limit_key,
        '1',
        { EX: 3 }
      )
    }

    const marketInfo = await this.getMarketInfo(market, chainid)
    let side
    let base_quantity
    let quote_quantity
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
      base_quantity = zktx.amount / 10 ** marketInfo.baseAsset.decimals
      quote_quantity = base_quantity * price
    } else if (
      zktx.tokenSell === marketInfo.quoteAssetId &&
      zktx.tokenBuy === marketInfo.baseAssetId
    ) {
      side = 'b'
      price =
        zktx.ratio[0] /
        10 ** marketInfo.quoteAsset.decimals /
        (zktx.ratio[1] / 10 ** marketInfo.baseAsset.decimals)
      quote_quantity = zktx.amount / 10 ** marketInfo.quoteAsset.decimals
      base_quantity =
        ((quote_quantity / price) as any).toFixed(
          marketInfo.baseAsset.decimals
        ) / 1
    } else {
      throw new Error('Buy/sell tokens do not match market')
    }

    if (side === 's' && base_quantity < marketInfo.baseFee) {
      throw new Error('Order size inadequate to pay fee')
    }
    if (side === 'b' && quote_quantity < marketInfo.quoteFee) {
      throw new Error('Order size inadequate to pay fee')
    }
    const order_type = 'limit'
    const expires = zktx.validUntil
    const userid = zktx.accountId
    const queryargs = [
      chainid,
      userid,
      zktx.nonce,
      market,
      side,
      price,
      base_quantity,
      quote_quantity,
      order_type,
      'o',
      expires,
      JSON.stringify(zktx),
      base_quantity,
    ]
    // save order to DB
    const query =
      'INSERT INTO offers(chainid, userid, nonce, market, side, price, base_quantity, quote_quantity, order_type, order_status, expires, zktx, insert_timestamp, unfilled) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13) RETURNING id'
    const insert = await this.db.query(query, queryargs)
    const orderId = insert.rows[0].id
    const orderreceipt = [
      chainid,
      orderId,
      market,
      side,
      price,
      base_quantity,
      quote_quantity,
      expires,
      userid.toString(),
      'o',
      null,
      base_quantity,
    ]

    // broadcast new order
    this.broadcastMessage(chainid, market, {
      op: 'orders',
      args: [[orderreceipt]],
    })
    try {
      const userconnkey = `${chainid}:${userid}`
      this.USER_CONNECTIONS[userconnkey].send(
        JSON.stringify({ op: 'userorderack', args: orderreceipt })
      )
    } catch (e) {
      // user connection doesn't exist. just pass along
    }

    return { op: 'userorderack', args: orderreceipt }
  }
/*
  processorderstarknet = async (
    chainId: number,
    market: string,
    txMsg: ZZ_Message
  ) => {
    const inputValidation = ZZMessageSchema.validate(txMsg)
    if (inputValidation.error) throw inputValidation.error
    if (chainId !== 1001) throw new Error("Only for StarkNet")

    const marketInfo = await this.getMarketInfo(market, chainId)
    const sCTx: sCOrder = txMsg.order

    const userAddress = txMsg.sender
    if (Number(sCTx.side) !== 1 && Number(sCTx.side) !== 0) throw new Error('Invalid side')
    const side = Number(sCTx.side) === 0 ? 'b' : 's'
    const base_quantity = Number(sCTx.base_quantity) / 10 ** marketInfo.baseAsset.decimals
    const price = (Number(sCTx.priceRatio[0]) / Number(sCTx.priceRatio[1]))

    const quote_quantity = price * base_quantity
    const expiration = Number(sCTx.expiration)
    // const order_type = 'limit' - set in match_limit_order

    const query = 'SELECT * FROM match_limit_order($1, $2, $3, $4, $5, $6, $7, $8)'
    const values = [
      chainId,
      userAddress,
      market,
      side,
      price,
      base_quantity,
      quote_quantity,
      expiration,
      JSON.stringify(txMsg),
    ]
    console.log(values)

    const matchquery = await this.db.query(query, values)
    const fill_ids = matchquery.rows
      .slice(0, matchquery.rows.length - 1)
      .map((r) => r.id)
    const offer_id = matchquery.rows[matchquery.rows.length - 1].id

    const fills = await this.db.query(
      'SELECT fills.*, maker_offer.unfilled AS maker_unfilled, maker_offer.zktx AS maker_zktx, maker_offer.side AS maker_side FROM fills JOIN offers AS maker_offer ON fills.maker_offer_id=maker_offer.id WHERE fills.id = ANY ($1)',
      [fill_ids]
    )
    console.log('fills', fills.rows)
    const offerquery = await this.db.query('SELECT * FROM offers WHERE id = $1', [
      offer_id,
    ])
    const offer = offerquery.rows[0]
    console.log('offer', offer)

    const orderupdates: any[] = []
    const marketFills: any[] = []
    fills.rows.forEach((row) => {
      if (row.maker_unfilled > 0)
        orderupdates.push([
          chainId,
          row.maker_offer_id,
          'pm',
          row.amount,
          row.maker_unfilled,
        ])
      else orderupdates.push([chainId, row.maker_offer_id, 'm'])
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
    })
    const order = [
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
    this.broadcastMessage(chainId, market, { op: 'orders', args: [[order]] })
    if (orderupdates.length > 0)
      this.broadcastMessage(chainId, market, {
        op: 'orderstatus',
        args: [orderupdates],
      })
    if (marketFills.length > 0)
      this.broadcastMessage(chainId, market, { op: 'fills', args: [marketFills] })
  }

  relayStarknetMatch = async (
    chainId: number,
    market: ZZMarket,
    buyer: ZZ_Message,
    seller: ZZ_Message,
    fillQty: number,
    fillPrice: number,
    fillId: number,
    makerOfferId: number,
    takerOfferId: number
  ) => {
    const marketInfo = await this.getMarketInfo(market, chainId)
    const baseAssetDecimals = marketInfo.baseAsset.decimals
    const getFraction = (decimals: number) => {
      let denominator = 1
      for(; (decimals * denominator) % 1 !== 0; denominator++);
      return {numerator: decimals * denominator, denominator }
    }
    const fillPriceRatioNumber = getFraction(fillPrice)
    const fillPriceRatio: PriceRatio = {
      numerator: fillPriceRatioNumber.numerator.toFixed(0),
      denominator: fillPriceRatioNumber.denominator.toFixed(0)
    }
    const fillQtyParsed = (fillQty * 10 ** baseAssetDecimals).toFixed(0)
    const calldata = [buyer, seller, fillPriceRatio, fillQtyParsed]
    try {
      const transactionDetails = {
        type: 'INVOKE_FUNCTION',
        contract_address: process.env.STARKNET_CONTRACT_ADDRESS as string,
        entry_point_selector: starknet.stark.getSelectorFromName('fill_order'),
        calldata: JSON.stringify(calldata)
      } 
      const relayResult = await starknet.defaultProvider.addTransaction(
        transactionDetails
      )

      // TODO we want to add fees here

      console.log('Starknet tx success')
      const fillupdate = await this.db.query(
        "UPDATE fills SET fill_status='f', txhash=$1 WHERE id=$2 RETURNING id, fill_status, txhash",
        [relayResult.transaction_hash, fillId]
      )
      const orderupdate = await this.db.query(
        "UPDATE offers SET order_status=(CASE WHEN order_status='pm' THEN 'pf' ELSE 'f' END), update_timestamp=NOW() WHERE id IN ($1, $2) RETURNING id, order_status",
        [makerOfferId, takerOfferId]
      )
      const orderUpdates = orderupdate.rows.map((row) => [
        chainId,
        row.id,
        row.order_status,
      ])
      const fillUpdates = fillupdate.rows.map((row) => [
        chainId,
        row.id,
        row.fill_status,
        row.txhash,
      ])

      this.broadcastMessage(chainId, market, {
        op: 'orderstatus',
        args: [orderUpdates],
      })
      this.broadcastMessage(chainId, market, {
        op: 'fillstatus',
        args: [fillUpdates]
      })
    } catch (e: any) {
      console.error(e)
      console.error('Starknet tx failed')
      const orderupdate = await this.db.query(
        "UPDATE offers SET order_status='r', update_timestamp=NOW() WHERE id IN ($1, $2) RETURNING id, order_status",
        [makerOfferId, takerOfferId]
      )
      const orderUpdates = orderupdate.rows.map((row) => [
        chainId,
        row.id,
        row.order_status,
      ])
      this.broadcastMessage(chainId, market, {
        op: 'orderstatus',
        args: [orderUpdates],
      })
    }
  }
*/
  cancelallorders = async (userid: string | number): Promise<string[]> => {
    const values = [userid]
    const select = await this.db.query(
      "SELECT id FROM offers WHERE userid=$1 AND order_status='o'",
      values
    )
    const ids = select.rows.map((s) => s.id)

    await this.db.query(
      "UPDATE offers SET order_status='c',zktx=NULL, update_timestamp=NOW() WHERE userid=$1 AND order_status='o'",
      values
    )

    return ids
  }

  cancelorder = async (chainid: number, orderId: string, ws?: WSocket) => {
    const values = [orderId, chainid]
    const select = await this.db.query(
      'SELECT userid, order_status FROM offers WHERE id=$1 AND chainid=$2',
      values
    )

    if (select.rows.length === 0) {
      throw new Error('Order not found')
    }

    const userconnkey = `${chainid}:${select.rows[0].userid}`

    if (select.rows[0].order_status !== 'o') {
      // somehow user was not updated, do that now   
      if (ws) {
        try {
          ws.send(
            JSON.stringify({ op: 'orderstatus', args: [[[chainid, orderId, select.rows[0].order_status]]], })
          )
        } catch (err: any) {
          throw new Error('Order is no longer open')
        }
      }
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
    let market
    if (update.rows.length > 0) {
      market = update.rows[0].market
    }

    return { success: true, market }
  }

  matchorder = async (
    chainid: number,
    orderId: string,
    fillOrder: ZZFillOrder,
    ws: WSocket
  ) => {
    const values = [orderId, chainid]
    const select = await this.db.query(
      "SELECT userid, price, base_quantity, quote_quantity, market, zktx, side FROM offers WHERE id=$1 AND chainid=$2 AND order_status='o'",
      values
    )
    if (select.rows.length === 0) {
      ws.send(
        JSON.stringify(
          {
            op: 'error',
            args: [
              'fillrequest',
              fillOrder.accountId.toString(),
              `Order ${orderId} is not open`]
          }
        )
      )
      return
    }

    const selectresult = select.rows[0]

    // Determine fill price
    const marketInfo = await this.getMarketInfo(selectresult.market, chainid)
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
    const redis_members: any = {
      score: fillPrice,
      value: JSON.stringify({
        "zktx": JSON.parse(selectresult.zktx),
        "market": selectresult.market,
        "baseQuantity": selectresult.base_quantity,
        "quoteQuantity": selectresult.quote_quantity,
        "userId": selectresult.userid,
        "fillOrder": fillOrder,
        "wsUUID": ws.uuid
      })
    }

    const redisKey = `matchingorders:${chainid}:${orderId}`
    const existingMembers = await this.redis.ZCOUNT(redisKey, 0, 99999999)
    this.redis.ZADD(redisKey, redis_members)
    if (existingMembers === 0) {
      this.redis.EXPIRE(redisKey, 10)
      setTimeout(
        this.senduserordermatch,
        250,
        chainid,
        orderId,
        selectresult.side)
    }
  }

  senduserordermatch = async (
    chainid: number,
    orderId: string,
    side: string
  ) => {
    const redisKeyMatchingOrder = `matchingorders:${chainid}:${orderId}`
    const existingMembers = await this.redis.ZCOUNT(redisKeyMatchingOrder, -Infinity, Infinity)
    if (existingMembers === 0) {
      return
    }

    let redis_members
    if (side === 'b') {
      redis_members = await this.redis.ZPOPMIN(redisKeyMatchingOrder)
    } else {
      redis_members = await this.redis.ZPOPMAX(redisKeyMatchingOrder)
    }
    if (!redis_members) {
      return
    }

    const fillPrice = redis_members.score
    const value = JSON.parse(redis_members.value)
    const { fillOrder } = value
    const makerAccountId = fillOrder.accountId.toString()
    const makerConnId = `${chainid}:${value.wsUUID}`
    const ws = this.MAKER_CONNECTIONS[makerConnId]

    let fill
    const redisKeyBussy = `bussymarketmaker:${chainid}:${makerAccountId}`
    try {
      const redisBusyMM = (await this.redis.get(redisKeyBussy)) as string
      if (redisBusyMM) {
        const processingOrderId: number = (JSON.parse(redisBusyMM) as any).orderId
        const remainingTime = await this.redis.ttl(redisKeyBussy)
        ws.send(
          JSON.stringify({
            op: 'error',
            args: [
              'fillrequest',
              makerAccountId,
              `Your address did not respond to order (${processingOrderId
              }) yet. Remaining timeout: ${remainingTime}.`
            ],
          })
        )
        throw new Error('fillrequest - market maker is timed out.')
      }

      
      let priceWithoutFee: string
      try {
        const marketInfo = await this.getMarketInfo(value.market, chainid)
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

      let values = [orderId, chainid]
      const update1 = await this.db.query(
        "UPDATE offers SET order_status='m' WHERE id=$1 AND chainid=$2 AND order_status='o' RETURNING id",
        values
      )
      if (update1.rows.length === 0)
        // this *should* not happen, so no need to send to ws
        throw new Error(`Order ${orderId} is not open`)

      values = [
        chainid,
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
      const fill_id = update2.rows[0].id
      fill = [
        chainid,
        fill_id,
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

      if (ws) {
        ws.send(
          JSON.stringify({
            op: 'userordermatch',
            args: [chainid, orderId, value.zktx, fillOrder],
          })
        )
      }

      // update user
      this.sendMessageToUser(
        chainid,
        value.userId,
        { op: 'orderstatus', args: [[[chainid, orderId, 'm']]], }
      )

      this.redis.SET(
        redisKeyBussy,
        JSON.stringify({ "orderId": orderId, "ws_uuid": ws.uuid }),
        { EX: this.MARKET_MAKER_TIMEOUT }
      )
    } catch (err: any) {
      if (err.message.includes('is not open')) {
        console.log(`Failed to match order because ${err.message}. Abort`)
      } else {
        console.log(`Failed to match order because ${err.message}, sending next best`)
        // try next best one
        this.senduserordermatch(
          chainid,
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
        const otherMakerConnId = `${chainid}:${otherValue.wsUUID}`
        const otherWs = this.MAKER_CONNECTIONS[otherMakerConnId]
        if (otherWs) {
          otherWs.send(
            JSON.stringify(
              {
                op: 'error',
                args: [
                  'fillrequest',
                  otherMakerAccountId,
                  "The Order was filled by better offer"
                ]
              }
            )
          )
        }
      })
    } catch (err: any) {
      console.log(`senduserordermatch: Error while updating other mms: ${err.message}`)
    }

    this.broadcastMessage(chainid, value.market, {
      op: 'orderstatus',
      args: [[[chainid, orderId, 'm']]],
    })

    this.broadcastMessage(chainid, value.market, {
      op: 'fills',
      args: [[fill]],
    })
  }

  broadcastMessage = async (
    chainid: number | null = null,
    market: ZZMarket | null = null,
    msg: WSMessage | null = null
  ) => {
    ; (this.wss.clients as Set<WSocket>).forEach((ws: WSocket) => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (chainid && ws.chainid !== chainid) return
      if (market && !ws.marketSubscriptions.includes(market)) return
      ws.send(JSON.stringify(msg))
    })
  }

  sendMessageToUser = async (
    chainId: number,
    userId: number,
    msg: WSMessage
  ) => {
    const userConnKey = `${chainId}:${userId}`
    const userWs = this.USER_CONNECTIONS[userConnKey]
    if (userWs) {
      userWs.send(JSON.stringify(msg))
    }
  }

  /**
   * Returns the liquidity for a given market.
   * @param {number} chainid The reqested chain (1->zkSync, 1000->zkSync_rinkeby)
   * @param {ZZMarket} market The reqested market
   * @param {number} depth Depth of returned liquidity (depth/2 buckets per return)
   * @param {number} level Level of returned liquidity (1->best ask/bid, 2->0.05% steps, 3->all)
   * @return {number} The resulting liquidity -> {"timestamp": _, "bids": _, "asks": _}
   */
  getLiquidityPerSide = async (
    chainid: number,
    market: ZZMarket,
    depth = 0,
    level = 3
  ) => {
    const timestamp = Date.now()
    const liquidity = await this.getLiquidity(chainid, market)
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

    if (level === 1) {
      // Level 1 – Only best bid and ask.
      return {
        timestamp,
        bids: [bids[0]],
        asks: [asks[0]],
      }
    }
    if (level === 2) {
      // Level 2 – Arranged by best bids and asks.
      let marketInfo: any = {}
      try {
        marketInfo = await this.getMarketInfo(market, chainid)
      } catch (e: any) {
        console.log(e.message)
        return {
          timestamp,
          bids: [],
          asks: [],
        }
      }
      // get mid price
      const redis_key_prices = `lastprices:${chainid}`
      const midPrice = Number(await this.redis.HGET(redis_key_prices, market))
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

  getLiquidity = async (chainid: number, market: ZZMarket) => {
    const redis_key_liquidity = `liquidity:${chainid}:${market}`
    let liquidity = await this.redis.ZRANGEBYSCORE(
      redis_key_liquidity,
      '0',
      '1000000'
    )

    if (liquidity.length === 0) return []

    liquidity = liquidity.map((json) => JSON.parse(json))

    const now = (Date.now() / 1000) | 0
    const expired_values = liquidity
      .filter((l) => Number(l[3]) < now || !l[3])
      .map((l) => JSON.stringify(l))
    expired_values.forEach((v) => this.redis.ZREM(redis_key_liquidity, v))

    const active_liquidity = liquidity.filter((l) => Number(l[3]) > now)
    return active_liquidity
  }

  getopenorders = async (chainid: number, market: string) => {
    chainid = Number(chainid)
    const query = {
      text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,unfilled,txhash FROM offers WHERE market=$1 AND chainid=$2 AND order_status IN ('o', 'pm', 'pf')",
      values: [market, chainid],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    return select.rows
  }

  getorder = async (chainid: number, orderid: string) => {
    chainid = Number(chainid)
    const query = {
      text: 'SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,unfilled,txhash FROM offers WHERE chainid=$1 AND id=$2',
      values: [chainid, orderid],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    if (select.rows.length === 0) throw new Error('Order not found')
    const order = select.rows[0]
    return order
  }

  getuserfills = async (chainid: number, userid: string) => {
    chainid = Number(chainid)
    const query = {
      text: 'SELECT chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id,feeamount,feetoken,insert_timestamp FROM fills WHERE chainid=$1 AND (maker_user_id=$2 OR taker_user_id=$2) ORDER BY id DESC LIMIT 25',
      values: [chainid, userid],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    return select.rows
  }

  getuserorders = async (chainid: number, userid: string) => {
    const query = {
      text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status FROM offers WHERE chainid=$1 AND userid=$2 AND order_status IN ('o','pm','pf') ORDER BY id DESC LIMIT 25",
      values: [chainid, userid],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    return select.rows
  }

  /**
   * Returns fills for a given market.
   * @param {number} chainid reqested chain (1->zkSync, 1000->zkSync_rinkeby)
   * @param {ZZMarket} market reqested market
   * @param {number} limit number of trades returnd (MAX 25)
   * @param {number} orderId orderId to start at
   * @param {number} type side of returned fills 's', 'b', 'buy' or 'sell'
   * @param {number} startTime time for first fill
   * @param {number} endTime time for last fill
   * @param {number} accountId accountId to search for (maker or taker)
   * @param {string} direction used to set ASC or DESC ('older' or 'newer')
   * @return {number} array of fills [[chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id,feeamount,feetoken,insert_timestamp],...]
   */
  getfills = async (
    chainid: number,
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
        values: [chainid],
        rowMode: 'array',
      }
      const select = await this.db.query(query)
      return select.rows
    } catch (e: any) {
      console.log(`Error in getFills: ${text}, Error: ${e.message}`)
      return []
    }
  }

  updateVolumes = async () => {
    const one_day_ago = new Date(Date.now() - 86400 * 1000).toISOString()
    const query = {
      text: "SELECT chainid, market, SUM(amount) AS base_volume FROM fills WHERE fill_status IN ('m', 'f', 'b') AND insert_timestamp > $1 AND chainid IS NOT NULL GROUP BY (chainid, market)",
      values: [one_day_ago],
    }
    const select = await this.db.query(query)
    select.rows.forEach(async (row) => {
      try {
        const price = Number(
          await this.redis.HGET(`lastprices:${row.chainid}`, row.market)
        )
        let quoteVolume = (row.base_volume * price).toPrecision(6)
        let baseVolume = row.base_volume.toPrecision(6)
        // Prevent exponential notation
        if (quoteVolume.includes('e')) {
          quoteVolume = (row.base_volume * price).toFixed(0)
        }
        if (baseVolume.includes('e')) {
          baseVolume = row.base_volume.toFixed(0)
        }
        const redis_key_base = `volume:${row.chainid}:base`
        const redis_key_quote = `volume:${row.chainid}:quote`
        this.redis.HSET(redis_key_base, row.market, baseVolume)
        this.redis.HSET(redis_key_quote, row.market, quoteVolume)
      } catch (err) {
        console.error(err)
        console.log('Could not update volumes')
      }
    })

    try {
      // remove zero volumes
      this.VALID_CHAINS.forEach(async (chainId) => {
        const nonZeroMarkets = select.rows.filter(row => row.chainid === chainId)
          .map(row => row.market)

        const baseVolumeMarkets = await this.redis.HKEYS(`volume:${chainId}:base`)
        const quoteVolumeMarkets = await this.redis.HKEYS(`volume:${chainId}:quote`)

        const keysToDelBase = baseVolumeMarkets.filter(m => !nonZeroMarkets.includes(m))
        const keysToDelQuote = quoteVolumeMarkets.filter(m => !nonZeroMarkets.includes(m))

        keysToDelBase.forEach(key => {
          this.redis.HDEL(`volume:${chainId}:base`, key)
        })
        keysToDelQuote.forEach(key => {
          this.redis.HDEL(`volume:${chainId}:quote`, key)
        })
      })
    } catch (err) {
      console.error(err)
      console.log('Could not remove zero volumes')
    }
    return true
  }

  updatePendingOrders = async () => {
    const one_min_ago = new Date(Date.now() - 60 * 1000).toISOString()
    const query = {
      text: "UPDATE offers SET order_status='c', update_timestamp=NOW() WHERE (order_status IN ('m', 'b', 'pm') AND insert_timestamp < $1) OR (order_status='o' AND unfilled = 0) RETURNING chainid, id, order_status;",
      values: [one_min_ago],
    }
    const update = await this.db.query(query)
    if (update.rowCount > 0) {
      const orderUpdates = update.rows.map((row) => [
        row.chainid,
        row.id,
        row.order_status,
      ])
      this.broadcastMessage(null, null, {
        op: 'orderstatus',
        args: [orderUpdates],
      })
    }

    // Update fills
    const fillsQuery = {
      text: "UPDATE fills SET fill_status='e', feeamount=0 WHERE fill_status IN ('m', 'b', 'pm') AND insert_timestamp < $1",
      values: [one_min_ago],
    }
    await this.db.query(fillsQuery)

    const expiredQuery = {
      text: "UPDATE offers SET order_status='e', zktx=NULL, update_timestamp=NOW() WHERE order_status = 'o' AND expires < EXTRACT(EPOCH FROM NOW()) RETURNING chainid, id, order_status",
      values: [],
    }
    const updateExpires = await this.db.query(expiredQuery)
    if (updateExpires.rowCount > 0) {
      const orderUpdates = updateExpires.rows.map((row) => [
        row.chainid,
        row.id,
        row.order_status,
      ])
      this.broadcastMessage(null, null, {
        op: 'orderstatus',
        args: [orderUpdates],
      })
    }
    return true
  }

  getLastPrices = async (
    chainid: number,
    markets: ZZMarket[] = []
  ) => {
    const lastprices: any[] = []
    const redis_key_prices = `lastprices:${chainid}`
    const redisKeyVolumesQuote = `volume:${chainid}:quote`
    const redisKeyVolumesBase = `volume:${chainid}:base`
    const redis_prices = await this.redis.HGETALL(redis_key_prices)
    const redisPricesQuote = await this.redis.HGETALL(redisKeyVolumesQuote)
    const redisVolumesBase = await this.redis.HGETALL(redisKeyVolumesBase)
    if (markets.length === 0) {
      markets = await this.redis.SMEMBERS(`activemarkets:${chainid}`)
    }

    const results: Promise<any>[] = markets.map(async (marketId) => {
      let marketInfo: any = null
      try {
        marketInfo = await this.getMarketInfo(marketId, chainid)
      } catch (e: any) {
        return
      }
      if (!marketInfo) {
        return
      }
      const yesterday = new Date(Date.now() - 86400 * 1000)
        .toISOString()
        .slice(0, 10)
      const yesterdayPrice = Number(
        await this.redis.get(`dailyprice:${chainid}:${marketId}:${yesterday}`)
      )
      const price = +redis_prices[marketId]
      const priceChange = Number(formatPrice(price - yesterdayPrice))
      const quoteVolume = redisPricesQuote[marketId] || 0
      const baseVolume = redisVolumesBase[marketId] || 0
      lastprices.push([marketId, price, priceChange, quoteVolume, baseVolume])
    })
    await Promise.all(results)
    return lastprices
  }

  getMarketSummarys = async (chainid: number, marketReq = '') => {
    const redisKeyMarketSummary = `marketsummary:${chainid}`
    let markets
    if (marketReq === '') {
      const cache = await this.redis.GET(redisKeyMarketSummary)
      if (cache) {
        return JSON.parse(cache)
      }
      markets = await this.redis.SMEMBERS(`activemarkets:${chainid}`)
    } else {
      markets = [marketReq]
    }
    const marketSummarys: any = {}
    const redisKeyPrices = `lastprices:${chainid}`
    const redisPrices = await this.redis.HGETALL(redisKeyPrices)

    const redisKeyVolumesQuote = `volume:${chainid}:quote`
    const redisKeyVolumesBase = `volume:${chainid}:base`
    const redisVolumesQuote = await this.redis.HGETALL(redisKeyVolumesQuote)
    const redisVolumesBase = await this.redis.HGETALL(redisKeyVolumesBase)

    const redisKeyLow = `price:${chainid}:low`
    const redisKeyHigh = `price:${chainid}:high`
    const redisPricesLow = await this.redis.HGETALL(redisKeyLow)
    const redisPricesHigh = await this.redis.HGETALL(redisKeyHigh)

    const results: Promise<any>[] = markets.map(async (market: ZZMarket) => {
      let marketInfo: any = null
      try {
        marketInfo = await this.getMarketInfo(market, chainid)
      } catch (e: any) {
        return
      }
      if (!marketInfo) return
      const yesterday = new Date(Date.now() - 86400 * 1000).toISOString()
      const yesterdayPrice = Number(
        await this.redis.get(
          `dailyprice:${chainid}:${market}:${yesterday.slice(0, 10)}`
        )
      )
      const lastPrice = +redisPrices[market]
      const priceChange = Number(formatPrice(lastPrice - yesterdayPrice))
      const priceChangePercent_24h = Number(formatPrice(priceChange / lastPrice))

      // get low/high price
      const lowestPrice_24h = Number(redisPricesLow[market])
      const highestPrice_24h = Number(redisPricesHigh[market])

      // get volume
      const quoteVolume = Number(redisVolumesQuote[market] || 0)
      const baseVolume = Number(redisVolumesBase[market] || 0)

      // get best ask/bid
      const liquidity = await this.getLiquidityPerSide(chainid, market, 0, 1)
      const lowestAsk = Number(formatPrice(liquidity.asks[0]?.[0]))
      const highestBid = Number(formatPrice(liquidity.bids[0]?.[0]))

      const marketSummary: ZZMarketSummary = {
        market,
        baseSymbol: marketInfo.baseAsset.symbol,
        quoteSymbol: marketInfo.quoteAsset.symbol,
        lastPrice,
        lowestAsk,
        highestBid,
        baseVolume,
        quoteVolume,
        priceChange,
        priceChangePercent_24h,
        highestPrice_24h,
        lowestPrice_24h,
      }
      marketSummarys[market] = marketSummary
    })
    await Promise.all(results)
    if (marketReq === '') {
      this.redis.SET(
        redisKeyMarketSummary,
        JSON.stringify(marketSummarys),
        { EX: 10 }
      )
    }
    return marketSummarys
  }

  updatePriceHighLow = async () => {
    const one_day_ago = new Date(Date.now() - 86400 * 1000).toISOString()
    const select = await this.db.query(
      "SELECT chainid, market, MIN(price) AS min_price, MAX(price) AS max_price FROM fills WHERE insert_timestamp > $1 AND fill_status='f' AND chainid IS NOT NULL GROUP BY (chainid, market)",
      [one_day_ago]
    )
    select.rows.forEach(async (row) => {
      const redisKeyLow = `price:${row.chainid}:low`
      const redisKeyHigh = `price:${row.chainid}:high`
      this.redis.HSET(redisKeyLow, row.market, row.min_price)
      this.redis.HSET(redisKeyHigh, row.market, row.max_price)
    })

    // delete inactive markets
    this.VALID_CHAINS.forEach(async (chainid) => {
      const markets = await this.redis.SMEMBERS(`activemarkets:${chainid}`)
      const priceKeysLow = await this.redis.HKEYS(`price:${chainid}:low`)
      const delKeysLow = priceKeysLow.filter((k) => !markets.includes(k))
      delKeysLow.forEach(async (key) => {
        this.redis.HDEL(`price:${chainid}:low`, key)
      })
      const priceKeysHigh = await this.redis.HKEYS(`price:${chainid}:high`)
      const delKeysHigh = priceKeysHigh.filter((k) => !markets.includes(k))
      delKeysHigh.forEach(async (key) => {
        this.redis.HDEL(`price:${chainid}:high`, key)
      })
    })
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
    chainid: number,
    market: ZZMarket,
    side: ZZMarketSide,
    baseQuantity: number,
    quoteQuantity: number
  ) => {
    if (baseQuantity && quoteQuantity)
      throw new Error('Only one of baseQuantity or quoteQuantity should be set')
    if (![1, 1000].includes(chainid))
      throw new Error('Quotes not supported for this chain')
    if (!['b', 's'].includes(side)) throw new Error('Invalid side')

    if (baseQuantity) baseQuantity = Number(baseQuantity)
    if (quoteQuantity) quoteQuantity = Number(quoteQuantity)
    if (baseQuantity && baseQuantity <= 0)
      throw new Error('Quantity must be positive')
    if (quoteQuantity && quoteQuantity <= 0)
      throw new Error('Quantity must be positive')

    const marketInfo = await this.getMarketInfo(market, chainid)
    const liquidity = await this.getLiquidity(chainid, market)
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

    console.log(`${this.wss.clients.size} dead connections cleared.`)
  }

  broadcastLiquidity = async () => {
    const result = this.VALID_CHAINS.map(async (chainid) => {
      const markets = await this.redis.SMEMBERS(`activemarkets:${chainid}`)
      if (!markets || markets.length === 0) return
      const results: Promise<any>[] = markets.map(async (market_id) => {
        const liquidity = await this.getLiquidity(chainid, market_id)
        if (liquidity.length === 0) {
          await this.redis.SREM(`activemarkets:${chainid}`, market_id)
          await this.redis.HDEL(`lastprices:${chainid}`, market_id)
          return
        }
        this.broadcastMessage(chainid, market_id, {
          op: 'liquidity2',
          args: [chainid, market_id, liquidity],
        })

        // Update last price while you're at it
        const asks = liquidity.filter((l) => l[0] === 's')
        const bids = liquidity.filter((l) => l[0] === 'b')
        if (asks.length === 0 || bids.length === 0) return
        let askPrice = 0
        let askVolume = 0
        let bidPrice = 0
        let bidVolume = 0
        asks.forEach(ask => {
          askPrice += (+ask[1] * +ask[2])
          askVolume += +ask[2]
        })
        bids.forEach(bid => {
          bidPrice += (+bid[1] * +bid[2])
          bidVolume += +bid[2]
        })
        const mid = (askPrice / askVolume + bidPrice / bidVolume) / 2
        this.redis.HSET(
          `lastprices:${chainid}`,
          market_id,
          formatPrice(mid)
        )
      })
      // Broadcast last prices
      const lastprices = (await this.getLastPrices(chainid)).map((l) =>
        l.splice(0, 3)
      )
      this.broadcastMessage(chainid, null, {
        op: 'lastprice',
        args: [lastprices],
      })

      // eslint-disable-next-line consistent-return
      return Promise.all(results)
    })

    return Promise.all(result)
  }

  updateLiquidity = async (
    chainid: number,
    market: ZZMarket,
    liquidity: any[],
    client_id: string
  ) => {
    const FIFTEEN_SECONDS = ((Date.now() / 1000) | 0) + 15
    const marketInfo = await this.getMarketInfo(market, chainid)

    const redisKeyPassive = `passivews:${chainid}:${client_id}`
    const msg = await this.redis.get(redisKeyPassive)
    if (msg) {
      const remainingTime = await this.redis.ttl(redisKeyPassive)
      if (msg.includes('Your price is too far from the mid Price')) {
        throw new Error(`${msg}. Remaining timeout: ${remainingTime}.`)
      }
      throw new Error(`Your address did not respond to order ${msg
        } yet. Remaining timeout: ${remainingTime}.`
      )
    }

    // validation
    liquidity = liquidity.filter(
      (l: any[]) =>
        ['b', 's'].includes(l[0]) &&
        !Number.isNaN(Number(l[1])) &&
        Number(l[1]) > 0 &&
        !Number.isNaN(Number(l[2])) &&
        Number(l[2]) > marketInfo.baseFee
    )

    const [baseToken, quoteToken] = market.split('-')
    const midPriceBase = await this.getUsdPrice(chainid, baseToken)
    const midPriceQuote = await this.getUsdPrice(chainid, quoteToken)
    const midPrice = (midPriceBase && midPriceQuote)
      ? midPriceBase / midPriceQuote
      : 0
    // Add expirations to liquidity if needed
    Object.keys(liquidity).forEach((i: any) => {
      const expires = liquidity[i][3]
      if (!expires || expires > FIFTEEN_SECONDS) {
        liquidity[i][3] = FIFTEEN_SECONDS
      }
      liquidity[i][4] = client_id

      if (
        midPrice &&
        (Number(liquidity[i][1]) < midPrice * 0.25 || Number(liquidity[i][1]) > midPrice * 1.75)
      ) {
        this.redis.SET(
          redisKeyPassive,
          'Your price is too far from the mid Price',
          { EX: 900 }
        )
        throw new Error('Your price is too far from the mid Price. Remaining timeout: 900')
      }
    })

    const redis_key_liquidity = `liquidity:${chainid}:${market}`

    // Delete old liquidity by same client
    if (client_id) {
      let old_liquidity = await this.redis.ZRANGEBYSCORE(
        redis_key_liquidity,
        '0',
        '1000000'
      )
      old_liquidity = old_liquidity.map((json: string) => JSON.parse(json))
      const old_values = old_liquidity
        .filter((l: any) => l[4] && l[4] === client_id)
        .map((l: string) => JSON.stringify(l))
      old_values.forEach((v: string) => this.redis.ZREM(redis_key_liquidity, v))
    }

    // Set new liquidity
    const redis_members = liquidity.map((l) => ({
      score: l[1],
      value: JSON.stringify(l),
    }))
    try {
      if (liquidity.length > 0) {
        await this.redis.ZADD(redis_key_liquidity, redis_members)
      }
      await this.redis.SADD(`activemarkets:${chainid}`, market)
    } catch (e) {
      console.error(e)
      console.log(liquidity)
    }
  }

  updatePassiveMM = async () => {
    const orders = this.VALID_CHAINS.map(async (chainid: number) => {
      const redisPattern = `bussymarketmaker:${chainid}:*`
      const keys = await this.redis.keys(redisPattern)
      const results = keys.map(async (key: any) => {
        const remainingTime = await this.redis.ttl(key)
        // key is waiting for more than set SET_MM_PASSIVE_TIME
        if (
          remainingTime > 0 &&
          remainingTime < this.MARKET_MAKER_TIMEOUT - this.SET_MM_PASSIVE_TIME
        ) {
          const marketmaker = JSON.parse(`${await this.redis.get(key)}`)
          if (marketmaker) {
            const redisKey = `passivews:${chainid}:${marketmaker.ws_uuid}`
            const passivews = await this.redis.get(redisKey)
            if (!passivews) {
              this.redis.SET(
                redisKey,
                JSON.stringify(marketmaker.orderId),
                { EX: remainingTime }
              )
            }
          }
        }
      })

      return Promise.all(results)
    })

    return Promise.all(orders)
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

  getV1Markets = async (chainid: number) => {
    const v1Prices = await this.getLastPrices(chainid)
    const v1markets = v1Prices.map((l) => l[0])
    return v1markets
  }

  dailyVolumes = async (chainid: number) => {
    const redis_key = `volume:history:${chainid}`
    const cache = await this.redis.get(redis_key)
    if (cache) return JSON.parse(cache)
    const query = {
      text: "SELECT chainid, market, DATE(insert_timestamp) AS trade_date, SUM(base_quantity) AS base_volume, SUM(quote_quantity) AS quote_volume FROM offers WHERE order_status IN ('m', 'f', 'b') AND chainid = $1 GROUP BY (chainid, market, trade_date)",
      values: [chainid],
      rowMode: 'array',
    }
    const select = await this.db.query(query)
    const volumes = select.rows
    await this.redis.SET(redis_key, JSON.stringify(volumes))
    await this.redis.expire(redis_key, 1200)
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

  updateUsdPrice = async () => {
    console.time("Updating usd price.")
    // use mainnet as price source TODO we should rework the price source to work with multible networks
    const network = await this.getNetwork(1)
    const results0: Promise<any>[] = this.VALID_CHAINS.map(async (chainId) => {
      const updatedTokenPrice: any = {}
      // fetch redis 
      const markets = await this.redis.SMEMBERS(`activemarkets:${chainId}`)
      const tokenInfos = await this.redis.HGETALL(`tokeninfo:${chainId}`)
      // get active tokens once
      let tokenSymbols = markets.join('-').split('-')
      tokenSymbols = tokenSymbols.filter((x, i) => i === tokenSymbols.indexOf(x))
      const results1: Promise<any>[] = tokenSymbols.map(async (token: string) => {
        const tokenInfoString = tokenInfos[token]
        if (!tokenInfoString) return
        const tokenInfo = JSON.parse(tokenInfoString)

        try {
          const fetchResult = await fetch(`${this.ZKSYNC_BASE_URL[network]}tokens/${token}/priceIn/usd`)
            .then((r: any) => r.json()) as AnyObject
          const usdPrice = (fetchResult?.result?.price) ? formatPrice(fetchResult?.result?.price) : 0
          updatedTokenPrice[token] = usdPrice
          tokenInfo.usdPrice = usdPrice
        } catch (err: any) {
          console.log(`Could not update price for ${token}, Error: ${err.message}`)
        }
        this.redis.HSET(
          `tokeninfo:${chainId}`,
          token,
          JSON.stringify(tokenInfo)
        )
      })
      await Promise.all(results1)

      const marketInfos = await this.redis.HGETALL(`marketinfo:${chainId}`)
      const results2: Promise<any>[] = markets.map(async (market: ZZMarket) => {
        if (!marketInfos[market]) return
        const marketInfo = JSON.parse(marketInfos[market])
        marketInfo.baseAsset.usdPrice = Number(
          formatPrice(updatedTokenPrice[marketInfo.baseAsset.symbol])
        )
        marketInfo.quoteAsset.usdPrice = Number(
          formatPrice(updatedTokenPrice[marketInfo.quoteAsset.symbol])
        )
        this.redis.HSET(
          `marketinfo:${chainId}`,
          market,
          JSON.stringify(marketInfo)
        )
        const marketInfoMsg = { op: 'marketinfo', args: [marketInfo] }
        this.broadcastMessage(chainId, market, marketInfoMsg)
      })
      await Promise.all(results2)
    })
    await Promise.all(results0)
    console.timeEnd("Updating usd price.")
  }

  getNetwork = async (
    chainId: number
  ): Promise<string> => {
    if (!this.VALID_CHAINS.includes(chainId)) throw new Error('No valid chainId')
    if ([1].includes(chainId)) {
      return "mainnet"
    }
    if ([1000].includes(chainId)) {
      return "rinkeby"
    }
    return ""
  }
}
