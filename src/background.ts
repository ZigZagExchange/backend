import fetch from 'isomorphic-fetch'
import { ethers } from 'ethers'
import * as zksync from 'zksync'
import fs from 'fs'
import path from 'path'
import { redis, publisher } from './redisClient'
import db from './db'
import { formatPrice, getNetwork } from './utils'
import type {
  ZZMarketInfo,
  AnyObject,
  ZZMarket,
  ZZMarketSummary
} from './types'

const NUMBER_OF_SNAPSHOT_POSITIONS = 200

const VALID_CHAINS: number[] = process.env.VALID_CHAINS ? JSON.parse(process.env.VALID_CHAINS) : [1, 1000, 1001]
const VALID_CHAINS_ZKSYNC: number[] = VALID_CHAINS.filter(chainId => [1, 1000].includes(chainId))
const ZKSYNC_BASE_URL: any = {}
const SYNC_PROVIDER: any = {}
const ETHERS_PROVIDER: any = {}
let ERC20_ABI: any

async function getMarketInfo(market: ZZMarket, chainId: number) {
  if (!VALID_CHAINS.includes(chainId) || !market) return null

  const redisKeyMarketInfo = `marketinfo:${chainId}`
  const cache = await redis.HGET(redisKeyMarketInfo, market)
  if (cache) return JSON.parse(cache) as ZZMarketInfo

  return null
}

async function updatePriceHighLow() {
  console.time("updatePriceHighLow")

  const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString()
  const select = await db.query(
    "SELECT chainid, market, MIN(price) AS min_price, MAX(price) AS max_price FROM fills WHERE insert_timestamp > $1 AND fill_status='f' AND chainid IS NOT NULL GROUP BY (chainid, market)",
    [oneDayAgo]
  )
  select.rows.forEach(async (row) => {
    const redisKeyLow = `price:${row.chainid}:low`
    const redisKeyHigh = `price:${row.chainid}:high`
    redis.HSET(redisKeyLow, row.market, row.min_price)
    redis.HSET(redisKeyHigh, row.market, row.max_price)
  })

  // delete inactive markets
  VALID_CHAINS.forEach(async (chainId) => {
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
    const priceKeysLow = await redis.HKEYS(`price:${chainId}:low`)
    const delKeysLow = priceKeysLow.filter((k) => !markets.includes(k))
    delKeysLow.forEach(async (key) => {
      redis.HDEL(`price:${chainId}:low`, key)
    })
    const priceKeysHigh = await redis.HKEYS(`price:${chainId}:high`)
    const delKeysHigh = priceKeysHigh.filter((k) => !markets.includes(k))
    delKeysHigh.forEach(async (key) => {
      redis.HDEL(`price:${chainId}:high`, key)
    })
  })
  console.timeEnd("updatePriceHighLow")
}

async function updateVolumes() {
  console.time("updateVolumes")

  const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString()
  const query = {
    text: "SELECT chainid, market, SUM(amount) AS base_volume, SUM(amount * price) AS quote_volume FROM fills WHERE fill_status IN ('m', 'f', 'b') AND insert_timestamp > $1 AND chainid IS NOT NULL GROUP BY (chainid, market)",
    values: [oneDayAgo],
  }
  const select = await db.query(query)
  select.rows.forEach(async (row) => {
    try {
      let quoteVolume = row.quote_volume.toPrecision(6)
      let baseVolume = row.base_volume.toPrecision(6)
      // Prevent exponential notation
      if (quoteVolume.includes('e')) {
        quoteVolume = row.quote_volume.toFixed(0)
      }
      if (baseVolume.includes('e')) {
        baseVolume = row.base_volume.toFixed(0)
      }
      const redisKeyBase = `volume:${row.chainid}:base`
      const redisKeyQuote = `volume:${row.chainid}:quote`
      redis.HSET(redisKeyBase, row.market, baseVolume)
      redis.HSET(redisKeyQuote, row.market, quoteVolume)
    } catch (err) {
      console.error(err)
      console.log('Could not update volumes')
    }
  })

  try {
    // remove zero volumes
    VALID_CHAINS.forEach(async (chainId) => {
      const nonZeroMarkets = select.rows.filter(row => row.chainid === chainId)
        .map(row => row.market)

      const baseVolumeMarkets = await redis.HKEYS(`volume:${chainId}:base`)
      const quoteVolumeMarkets = await redis.HKEYS(`volume:${chainId}:quote`)

      const keysToDelBase = baseVolumeMarkets.filter(m => !nonZeroMarkets.includes(m))
      const keysToDelQuote = quoteVolumeMarkets.filter(m => !nonZeroMarkets.includes(m))

      keysToDelBase.forEach(key => {
        redis.HDEL(`volume:${chainId}:base`, key)
      })
      keysToDelQuote.forEach(key => {
        redis.HDEL(`volume:${chainId}:quote`, key)
      })
    })
  } catch (err) {
    console.error(err)
    console.log('Could not remove zero volumes')
  }
  console.timeEnd("updateVolumes")
}

async function updatePendingOrders() {
  console.time("updatePendingOrders")

  // TODO back to one min, temp 300, starknet is too slow
  const oneMinAgo = new Date(Date.now() - 300 * 1000).toISOString()
  let orderUpdates: string[][] = []
  const query = {
    text: "UPDATE offers SET order_status='c', update_timestamp=NOW() WHERE (order_status IN ('m', 'b', 'pm') AND update_timestamp < $1) OR (order_status='o' AND unfilled = 0) RETURNING chainid, id, order_status;",
    values: [oneMinAgo],
  }
  const update = await db.query(query)
  if (update.rowCount > 0) {
    orderUpdates = orderUpdates.concat(update.rows.map((row) => [
      row.chainid,
      row.id,
      row.order_status,
    ]))
  }

  // Update fills
  const fillsQuery = {
    text: "UPDATE fills SET fill_status='e', feeamount=0 WHERE fill_status IN ('m', 'b', 'pm') AND insert_timestamp < $1",
    values: [oneMinAgo],
  }
  await db.query(fillsQuery)

  const expiredQuery = {
    text: "UPDATE offers SET order_status='e', zktx=NULL, update_timestamp=NOW() WHERE order_status = 'o' AND expires < EXTRACT(EPOCH FROM NOW()) RETURNING chainid, id, order_status",
    values: [],
  }
  const updateExpires = await db.query(expiredQuery)
  if (updateExpires.rowCount > 0) {
    orderUpdates = orderUpdates.concat(updateExpires.rows.map((row) => [
      row.chainid,
      row.id,
      row.order_status,
    ]))
  }

  if (orderUpdates.length > 0) {
    VALID_CHAINS.forEach((chainId: number) => {
      const updatesForThisChain = orderUpdates.filter(row => Number(row[0]) === chainId)
      publisher.PUBLISH(
        `broadcastmsg:all:${chainId}:all`,
        JSON.stringify({ op: 'orderstatus', args: [updatesForThisChain] })
      )
    })
  }
  console.timeEnd("updatePendingOrders")
}

async function updateLastPrices() {
  console.time("updateLastPrices")

  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const redisKeyPriceInfo = `lastpriceinfo:${chainId}`

    const redisPrices = await redis.HGETALL(`lastprices:${chainId}`)
    const redisPricesQuote = await redis.HGETALL(`volume:${chainId}:quote`)
    const redisVolumesBase = await redis.HGETALL(`volume:${chainId}:base`)
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)

    const results1: Promise<any>[] = markets.map(async (marketId) => {
      const marketInfo = await getMarketInfo(marketId, chainId).catch(() => null)
      if (!marketInfo) return
      const lastPriceInfo: any = {}
      const yesterday = new Date(Date.now() - 86400 * 1000)
        .toISOString()
        .slice(0, 10)
      const yesterdayPrice = Number(
        await redis.get(`dailyprice:${chainId}:${marketId}:${yesterday}`)
      )
      lastPriceInfo.price = +redisPrices[marketId]
      lastPriceInfo.priceChange = Number(
        formatPrice(lastPriceInfo.price - yesterdayPrice)
      )
      lastPriceInfo.quoteVolume = redisPricesQuote[marketId] || 0
      lastPriceInfo.baseVolume = redisVolumesBase[marketId] || 0

      redis.HSET(
        redisKeyPriceInfo,
        marketId,
        JSON.stringify(lastPriceInfo)
      )
    })
    await Promise.all(results1)
  })
  await Promise.all(results0)
  console.timeEnd("updateLastPrices")
}

async function updateMarketSummarys() {
  console.time("updateMarketSummarys")

  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const redisKeyMarketSummary = `marketsummary:${chainId}`

    // fetch needed data
    const redisVolumesQuote = await redis.HGETALL(`volume:${chainId}:quote`)
    const redisVolumesBase = await redis.HGETALL(`volume:${chainId}:base`)
    const redisPrices = await redis.HGETALL(`lastprices:${chainId}`)
    const redisPricesLow = await redis.HGETALL(`price:${chainId}:low`)
    const redisPricesHigh = await redis.HGETALL(`price:${chainId}:high`)
    const redisBestAsk = await redis.HGETALL(`bestask:${chainId}`)
    const redisBestBid = await redis.HGETALL(`bestbid:${chainId}`)
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)

    const results1: Promise<any>[] = markets.map(async (marketId: ZZMarket) => {
      const marketInfo = await getMarketInfo(marketId, chainId).catch(() => null)
      if (!marketInfo) return
      const yesterday = new Date(Date.now() - 86400 * 1000).toISOString()
      const yesterdayPrice = Number(
        await redis.get(
          `dailyprice:${chainId}:${marketId}:${yesterday.slice(0, 10)}`
        )
      )
      const lastPrice = +redisPrices[marketId]
      const priceChange = Number(formatPrice(lastPrice - yesterdayPrice))
      // eslint-disable-next-line camelcase
      const priceChangePercent_24h = Number(formatPrice(priceChange / lastPrice))

      // get low/high price
      // eslint-disable-next-line camelcase
      const lowestPrice_24h = Number(redisPricesLow[marketId])
      // eslint-disable-next-line camelcase
      const highestPrice_24h = Number(redisPricesHigh[marketId])

      // get volume
      const quoteVolume = Number(redisVolumesQuote[marketId] || 0)
      const baseVolume = Number(redisVolumesBase[marketId] || 0)

      // get best ask/bid
      const lowestAsk = Number(redisBestAsk[marketId])
      const highestBid = Number(redisBestBid[marketId])

      const marketSummary: ZZMarketSummary = {
        market: marketId,
        baseSymbol: marketInfo.baseAsset.symbol,
        quoteSymbol: marketInfo.quoteAsset.symbol,
        lastPrice,
        lowestAsk,
        highestBid,
        baseVolume,
        quoteVolume,
        priceChange,
        // eslint-disable-next-line camelcase
        priceChangePercent_24h,
        // eslint-disable-next-line camelcase
        highestPrice_24h,
        // eslint-disable-next-line camelcase
        lowestPrice_24h,
      }
      redis.HSET(
        redisKeyMarketSummary,
        marketId,
        JSON.stringify(marketSummary)
      )
    })
    await Promise.all(results1)
  })
  await Promise.all(results0)

  console.timeEnd("updateMarketSummarys")
}

async function updateUsdPrice() {
  console.time("Updating usd price.")

  // use mainnet as price source TODO we should rework the price source to work with multible networks
  const network = await getNetwork(1)
  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const updatedTokenPrice: any = {}
    // fetch redis 
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
    const tokenInfos = await redis.HGETALL(`tokeninfo:${chainId}`)
    // get active tokens once
    let tokenSymbols = markets.join('-').split('-')
    tokenSymbols = tokenSymbols.filter((x, i) => i === tokenSymbols.indexOf(x))
    const results1: Promise<any>[] = tokenSymbols.map(async (token: string) => {
      const tokenInfoString = tokenInfos[token]
      if (!tokenInfoString) return
      const tokenInfo = JSON.parse(tokenInfoString)

      try {
        const fetchResult = await fetch(`${ZKSYNC_BASE_URL[network]}tokens/${token}/priceIn/usd`)
          .then((r: any) => r.json()) as AnyObject
        const usdPrice = (fetchResult?.result?.price) ? formatPrice(fetchResult?.result?.price) : 0
        updatedTokenPrice[token] = usdPrice
        tokenInfo.usdPrice = usdPrice
      } catch (err: any) {
        console.log(`Could not update price for ${token}, Error: ${err.message}`)
      }
      redis.HSET(
        `tokeninfo:${chainId}`,
        token,
        JSON.stringify(tokenInfo)
      )
    })
    await Promise.all(results1)

    const marketInfos = await redis.HGETALL(`marketinfo:${chainId}`)
    const results2: Promise<any>[] = markets.map(async (market: ZZMarket) => {
      if (!marketInfos[market]) return
      const marketInfo = JSON.parse(marketInfos[market])
      marketInfo.baseAsset.usdPrice = Number(
        formatPrice(updatedTokenPrice[marketInfo.baseAsset.symbol])
      )
      marketInfo.quoteAsset.usdPrice = Number(
        formatPrice(updatedTokenPrice[marketInfo.quoteAsset.symbol])
      )
      redis.HSET(
        `marketinfo:${chainId}`,
        market,
        JSON.stringify(marketInfo)
      )
      publisher.PUBLISH(
        `broadcastmsg:all:${chainId}:${market}`,
        JSON.stringify({ op: 'marketinfo', args: [marketInfo] })
      )
    })
    await Promise.all(results2)
  })
  await Promise.all(results0)
  console.timeEnd("Updating usd price.")
}

async function updateFeesZkSync() {
  console.time("Update fees")

  const results0: Promise<any>[] = VALID_CHAINS_ZKSYNC.map(async (chainId: number) => {
    const newFees: any = {}
    const network = getNetwork(chainId)
    // get redis cache
    const tokenInfos: any = await redis.HGETALL(`tokeninfo:${chainId}`)
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
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
          const feeReturn = await SYNC_PROVIDER[network].getTransactionFee(
            "Swap",
            '0x88d23a44d07f86b2342b4b06bd88b1ea313b6976',
            tokenSymbol
          )
          fee = Number(
            SYNC_PROVIDER[network].tokenSet
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
          const usdReferenceString = await redis.HGET(`tokenfee:${chainId}`, "USDC")
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
        redis.HSET(
          `tokenfee:${chainId}`,
          tokenSymbol,
          fee
        )
      }
    })
    await Promise.all(results1)

    // check if fee's have changed
    const marketInfos = await redis.HGETALL(`marketinfo:${chainId}`)
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
        redis.HSET(
          `marketinfo:${chainId}`,
          market,
          JSON.stringify(marketInfo)
        )
        publisher.PUBLISH(
          `broadcastmsg:all:${chainId}:${market}`,
          JSON.stringify({ op: 'marketinfo', args: [marketInfo] })
        )
      }
    })
    await Promise.all(results2)
  })
  await Promise.all(results0)
  console.timeEnd("Update fees")
}

// Removes old liquidity
// Updates lastprice redis map
// Sets best bids and asks in a JSON for broadcasting
async function removeOldLiquidity() {
  console.time("removeOldLiquidity")

  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
    const results1: Promise<any>[] = markets.map(async (marketId) => {
      const redisKeyLiquidity = `liquidity2:${chainId}:${marketId}`
      const liquidityList = await redis.HGETALL(redisKeyLiquidity)
      const liquidity = []
      // eslint-disable-next-line no-restricted-syntax, guard-for-in
      for (const clientId in liquidityList) {
        const liquidityPosition = JSON.parse(liquidityList[clientId])
        liquidity.push(...liquidityPosition)
      }

      // remove from activemarkets if no liquidity exists
      if (liquidity.length === 0) {
        redis.SREM(`activemarkets:${chainId}`, marketId)
        return
      }

      const uniqueAsk: any = {}
      const uniqueBuy: any = {}
      for (let i = 0; i < liquidity.length; i++) {
        const entry = liquidity[i]
        const price = Number(entry[1])
        const amount = Number(entry[2])

        // merge positions in object
        if (entry[0] === 'b') {
          uniqueBuy[price] = (uniqueBuy[price]) ? uniqueBuy[price] + amount : amount
        } else {
          uniqueAsk[price] = (uniqueAsk[price]) ? uniqueAsk[price] + amount : amount
        }
      }

      // sort ask and bid keys
      const askSet = [...new Set(Object.keys(uniqueAsk))]
      const bidSet = [...new Set(Object.keys(uniqueBuy))]
      const lenghtAsks = (askSet.length < NUMBER_OF_SNAPSHOT_POSITIONS)
        ? askSet.length
        : NUMBER_OF_SNAPSHOT_POSITIONS
      const lengthBids = (bidSet.length < NUMBER_OF_SNAPSHOT_POSITIONS)
        ? bidSet.length
        : NUMBER_OF_SNAPSHOT_POSITIONS
      const asks = new Array(lenghtAsks)
      const bids = new Array(lengthBids)

      // Update last price
      let askPrice = 0
      let askAmount = 0
      let bidPrice = 0
      let bidAmount = 0
      for (let i = 0; i < lenghtAsks; i++) {
        askPrice += (+askSet[i]) * uniqueAsk[askSet[i]]
        askAmount += uniqueAsk[askSet[i]]
        asks[i] = [
          's',
          Number(askSet[i]),
          Number(uniqueAsk[askSet[i]]),
        ]
      }
      for (let i = 1; i <= lengthBids; i++) {
        bidPrice += (+bidSet[bidSet.length - i]) * uniqueBuy[bidSet[bidSet.length - i]]
        bidAmount += uniqueBuy[bidSet[bidSet.length - i]]
        bids[i - 1] = [
          'b',
          Number(bidSet[bidSet.length - i]),
          Number(uniqueBuy[bidSet[bidSet.length - i]]),
        ]
      }
      const mid = (askPrice / askAmount + bidPrice / bidAmount) / 2

      // only update is valid mid price
      if (!Number.isNaN(mid) && mid > 0) {
        redis.HSET(
          `lastprices:${chainId}`,
          marketId,
          formatPrice(mid)
        )
      }

      // Store best bids and asks per market
      const bestAsk = asks[0]
      const bestBid = bids[0]
      const bestLiquidity = asks.concat(bids)
      redis.HSET(`bestask:${chainId}`, marketId, bestAsk)
      redis.HSET(`bestbid:${chainId}`, marketId, bestBid)
      redis.SET(
        `bestliquidity:${chainId}:${marketId}`,
        JSON.stringify(bestLiquidity),
        { EX: 15 }
      )

      // Clear old liquidity every 10 seconds
      redis.DEL(redisKeyLiquidity);
      
    })
    await Promise.all(results1)
  })
  await Promise.all(results0)
  console.timeEnd("removeOldLiquidity")
}

async function runDbMigration() {
  console.log("running db migration")
  const migration = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8')
  db.query(migration).catch(console.error)
}

/**
 * Get the full token name from L1 ERC20 contract
 * @param contractAddress 
 * @param tokenSymbol 
 * @returns full token name
 */
async function getTokenName(
  chainId: number,
  contractAddress: string,
  tokenSymbol: string
) {
  if (tokenSymbol === "ETH") {
    return "Ethereum"
  }
  const network = getNetwork(chainId)
  let name
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ERC20_ABI,
      SYNC_PROVIDER[network]
    )
    name = await contract.name()
  } catch (e) {
    name = tokenSymbol
  }
  return name
}

/**
   * Used to initialy fetch tokens infos on startup & updated on each recycle
   * @param chainId 
   */
async function updateTokenInfo(chainId: number) {
  let index = 0
  let tokenInfos
  const network = getNetwork(chainId)
  do {
    const fetchResult = await fetch(`${ZKSYNC_BASE_URL[network]}tokens?from=${index}&limit=100&direction=newer`).then((r: any) => r.json())
    tokenInfos = fetchResult.result.list
    const results1: Promise<any>[] = tokenInfos.map(async (tokenInfo: any) => {
      const tokenSymbol = tokenInfo.symbol
      if (!tokenSymbol.includes("ERC20")) {
        tokenInfo.usdPrice = 0
        tokenInfo.name = await getTokenName(
          chainId,
          tokenInfo.address,
          tokenSymbol
        )
        redis.HSET(
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

async function start() {
  await redis.connect()
  await publisher.connect()
  // await runDbMigration()

  // fetch abi's
  ERC20_ABI = JSON.parse(
    fs.readFileSync(
      'abi/ERC20.abi',
      'utf8'
    )
  )

  console.log("background.ts: Run startup")
  ZKSYNC_BASE_URL.mainnet = "https://api.zksync.io/api/v0.2/"
  ZKSYNC_BASE_URL.rinkeby = "https://rinkeby-api.zksync.io/api/v0.2/"
  SYNC_PROVIDER.mainnet = await zksync.getDefaultRestProvider("mainnet")
  SYNC_PROVIDER.rinkeby = await zksync.getDefaultRestProvider("rinkeby")
  ETHERS_PROVIDER.mainnet = new ethers.providers.InfuraProvider("mainnet", process.env.INFURA_PROJECT_ID,)
  ETHERS_PROVIDER.rinkeby = new ethers.providers.InfuraProvider("rinkeby", process.env.INFURA_PROJECT_ID,)

  // reste some values on start-up
  VALID_CHAINS_ZKSYNC.forEach(async (chainId) => {
    const keysBussy = await redis.keys(`bussymarketmaker:${chainId}:*`)
    keysBussy.forEach(async (key: string) => {
      redis.del(key)
    })
  })
  VALID_CHAINS_ZKSYNC.forEach(async (chainId) => updateTokenInfo(chainId))

  console.log("background.ts: Starting Update Functions")
  setInterval(updatePriceHighLow, 300000)
  setInterval(updateVolumes, 150000)
  setInterval(updatePendingOrders, 60000)
  setInterval(updateLastPrices, 15000)
  setInterval(updateMarketSummarys, 20000)
  setInterval(updateUsdPrice, 20000)
  setInterval(updateFeesZkSync, 25000)
  setInterval(removeOldLiquidity, 10000);
}

start()
