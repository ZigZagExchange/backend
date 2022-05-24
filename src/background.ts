import * as ENV from './env'
import fetch from 'isomorphic-fetch'
import * as zksync from 'zksync'
import { redis, publisher } from './redisClient'
import db from './db'
import { formatPrice, getNetwork } from './utils'
import type {
  ZZMarketInfo,
  AnyObject,
  ZZMarket,
  ZZMarketSummary
} from './types'

const VALID_CHAINS: number[] = [1, 1000, 1001]
const VALID_CHAINS_ZKSYNC: number[] = [1, 1000]
const ZKSYNC_BASE_URL: any = {}
const SYNC_PROVIDER: any = {}

async function getMarketInfo (market: ZZMarket, chainId: number) {
  if (
    !VALID_CHAINS.includes(chainId) ||
    !market
  ) {
    return null
  }

  const redisKeyMarketInfo = `marketinfo:${chainId}`
  const cache = await redis.HGET(
    redisKeyMarketInfo,
    market
  )

  if (cache) {
    return JSON.parse(cache) as ZZMarketInfo
  }
  return null
}

async function updatePriceHighLow () {
  // only one dyno needs to update this
  const redisPriceHighLowKey = 'update:PriceHighLow'
  const lock = await redis.get(redisPriceHighLowKey)
  if (lock) {
    return
  }
  await redis.SET(redisPriceHighLowKey, '1', { EX: 300 })

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
}

async function updateVolumes () {
  const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString()
  const query = {
    text: "SELECT chainid, market, SUM(amount) AS base_volume FROM fills WHERE fill_status IN ('m', 'f', 'b') AND insert_timestamp > $1 AND chainid IS NOT NULL GROUP BY (chainid, market)",
    values: [oneDayAgo],
  }
  const select = await db.query(query)
  select.rows.forEach(async (row) => {
    try {
      const price = Number(
        await redis.HGET(`lastprices:${row.chainid}`, row.market)
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
  return true
}

async function updatePendingOrders () {
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
  return true
}

async function updateLastPrices () {
  const redisLastPricesKey = 'update:lastprices'
  const lock = await redis.get(redisLastPricesKey)
  if (lock) return
  await redis.SET(redisLastPricesKey, '1', { EX: 14 })

  console.time("Updating last prices.")
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
}

async function getBestAskBid (chainId: number, market: ZZMarket) {
  const redisKeyLiquidity = `liquidity:${chainId}:${market}`
  const liquidityList = await redis.ZRANGEBYSCORE(
    redisKeyLiquidity,
    '0',
    '1000000'
  )
  const liquidity: string[] = []
  for (let i = 0; i < liquidityList.length; i++) {
    const liquidityPosition = JSON.parse(liquidityList[i])
    liquidity.push(liquidityPosition)
  }

  // sort for bids and asks
  const bids: number[][] = liquidity
    .filter((l) => l[0] === 'b')
    .map((l) => [Number(l[1]), Number(l[2])])
    .reverse()
  const asks: number[][] = liquidity
    .filter((l) => l[0] === 's')
    .map((l) => [Number(l[1]), Number(l[2])])

  return {
    bids: [bids[0]],
    asks: [asks[0]],
  }
}

async function updateMarketSummarys () {
  const redisLiquidityKey = 'update:liquidity'
  const lock = await redis.get(redisLiquidityKey)
  if (lock) return
  await redis.SET(redisLiquidityKey, '1', { EX: 4 })

  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const redisKeyMarketSummary = `marketsummary:${chainId}`

    // fetch needed data
    const redisVolumesQuote = await redis.HGETALL(`volume:${chainId}:quote`)
    const redisVolumesBase = await redis.HGETALL(`volume:${chainId}:base`)
    const redisPrices = await redis.HGETALL(`lastprices:${chainId}`)
    const redisPricesLow = await redis.HGETALL(`price:${chainId}:low`)
    const redisPricesHigh = await redis.HGETALL(`price:${chainId}:high`)
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
      const liquidity = await getBestAskBid(chainId, marketId)
      const lowestAsk = Number(formatPrice(liquidity.asks[0]?.[0]))
      const highestBid = Number(formatPrice(liquidity.bids[0]?.[0]))

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
}

async function updateUsdPrice () {
  // only one dyno needs to update this
  const redisUSDPriceKey = 'update:usdprice'
  const lock = await redis.get(redisUSDPriceKey)
  if (lock) {
    return
  }
  await redis.SET(redisUSDPriceKey, '1', { EX: 9 })

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

async function updateFeesZkSync () {
  // only one dyno needs to update this
  const redisZkSyncFeeKey = 'update:zkSyncFee'
  const lock = await redis.get(redisZkSyncFeeKey)
  if (lock) {
    return
  }
  await redis.SET(redisZkSyncFeeKey, '1', { EX: 15 })

  console.time("Update fees")
  const results0: Promise<any>[] = VALID_CHAINS_ZKSYNC.map(async (chainId: number) => {
    const newFees: any = {}
    const network = await getNetwork(chainId)
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

async function removeOldLiquidity () {
  const now = (Date.now() / 1000 | 0 + 5)
  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
    const results1: Promise<any>[] = markets.map(async (marketId) => {
      const redisKeyLiquidity = `liquidity:${chainId}:${marketId}`

      const liquidityList = await redis.ZRANGEBYSCORE(
        redisKeyLiquidity,
        '0',
        '1000000'
      )
      for (let i = 0; i < liquidityList.length; i++) {
        const liquidityString = liquidityList[i]
        const liquidity = JSON.parse(liquidityString)
        const expiration = Number(liquidity[3])
        if (Number.isNaN(expiration) || expiration < now) {
          redis.ZREM(redisKeyLiquidity, liquidityString)
        }
      }
    })
    await Promise.all(results1)
  })
  await Promise.all(results0)
}


async function start() {
  await redis.connect();
  await publisher.connect();

  console.log("background.ts: Starting Update Functions");
  ZKSYNC_BASE_URL.mainnet = "https://api.zksync.io/api/v0.2/"
  ZKSYNC_BASE_URL.rinkeby = "https://rinkeby-api.zksync.io/api/v0.2/"
  SYNC_PROVIDER.mainnet = await zksync.getDefaultRestProvider("mainnet")
  SYNC_PROVIDER.rinkeby = await zksync.getDefaultRestProvider("rinkeby")

  setInterval(updatePriceHighLow, 300000)
  setInterval(updateVolumes, 120000)
  setInterval(updatePendingOrders, 60000)
  setInterval(updateLastPrices, 15000)
  setInterval(updateMarketSummarys, 15000)
  setInterval(updateUsdPrice, 10000)
  setInterval(updateFeesZkSync, 18000)
  setInterval(removeOldLiquidity, 5000)
}

start()
