/* eslint-disable camelcase */
/* eslint-disable @typescript-eslint/no-unused-vars */
import fetch from 'isomorphic-fetch'
import { ethers } from 'ethers'
import * as zksync from 'zksync'
import fs from 'fs'
import { redis, publisher } from './redisClient'
import db from './db'
import {
  formatPrice,
  getNetwork,
  getRPCURL,
  getFeeEstimationOrder,
  getFeeEstimationMarket,
} from './utils'
import type {
  ZZMarketInfo,
  AnyObject,
  ZZMarket,
  ZZMarketSummary,
} from './types'

const NUMBER_OF_SNAPSHOT_POSITIONS = 200

const VALID_CHAINS: number[] = process.env.VALID_CHAINS
  ? JSON.parse(process.env.VALID_CHAINS)
  : [1, 1002, 1001, 42161, 421613]
const VALID_CHAINS_ZKSYNC: number[] = VALID_CHAINS.filter((chainId) =>
  [1, 1002].includes(chainId)
)
const VALID_EVM_CHAINS: number[] = VALID_CHAINS.filter((chainId) =>
  [42161, 421613].includes(chainId)
)
const ZKSYNC_BASE_URL: AnyObject = {}
const SYNC_PROVIDER: AnyObject = {}
const ETHERS_PROVIDERS: AnyObject = {}
const EXCHANGE_CONTRACTS: AnyObject = {}
const WALLET: AnyObject = {}
let EVMConfig: AnyObject = {}
let ERC20_ABI: any

async function getMarketInfo(market: ZZMarket, chainId: number) {
  if (!VALID_CHAINS.includes(chainId) || !market) return null

  const redisKeyMarketInfo = `marketinfo:${chainId}`
  const cache = await redis.HGET(redisKeyMarketInfo, market)
  if (cache) return JSON.parse(cache) as ZZMarketInfo

  return null
}

async function updatePriceHighLow() {
  console.time('updatePriceHighLow')

  const midnight = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()
  const selecUTC = await db.query(
    "SELECT chainid, market, MIN(price) AS min_price, MAX(price) AS max_price FROM fills WHERE insert_timestamp > $1 AND fill_status='f' AND chainid IS NOT NULL GROUP BY (chainid, market)",
    [midnight]
  )
  selecUTC.rows.forEach(async (row) => {
    const redisKeyLow = `price:utc:${row.chainid}:low`
    const redisKeyHigh = `price:utc:${row.chainid}:high`
    redis.HSET(redisKeyLow, row.market, row.min_price)
    redis.HSET(redisKeyHigh, row.market, row.max_price)
  })

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
  console.timeEnd('updatePriceHighLow')
}

async function updateVolumes() {
  console.time('updateVolumes')

  const midnight = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()
  const queryUTC = {
    text: "SELECT chainid, market, SUM(amount) AS base_volume, SUM(amount * price) AS quote_volume FROM fills WHERE fill_status IN ('f', 'pf') AND insert_timestamp > $1 AND chainid IS NOT NULL GROUP BY (chainid, market)",
    values: [midnight],
  }
  const selectUTC = await db.query(queryUTC)
  selectUTC.rows.forEach(async (row) => {
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
      const redisKeyBase = `volume:utc:${row.chainid}:base`
      const redisKeyQuote = `volume:utc:${row.chainid}:quote`
      redis.HSET(redisKeyBase, row.market, baseVolume)
      redis.HSET(redisKeyQuote, row.market, quoteVolume)
    } catch (err) {
      console.error(err)
      console.log('Could not update volumes')
    }
  })

  const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString()
  const query = {
    text: "SELECT chainid, market, SUM(amount) AS base_volume, SUM(amount * price) AS quote_volume FROM fills WHERE fill_status IN ('f', 'pf') AND insert_timestamp > $1 AND chainid IS NOT NULL GROUP BY (chainid, market)",
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
      const nonZeroMarkets = select.rows
        .filter((row) => row.chainid === chainId)
        .map((row) => row.market)

      const baseVolumeMarkets = await redis.HKEYS(`volume:${chainId}:base`)
      const quoteVolumeMarkets = await redis.HKEYS(`volume:${chainId}:quote`)

      const keysToDelBase = baseVolumeMarkets.filter(
        (m) => !nonZeroMarkets.includes(m)
      )
      const keysToDelQuote = quoteVolumeMarkets.filter(
        (m) => !nonZeroMarkets.includes(m)
      )

      keysToDelBase.forEach((key) => {
        redis.HDEL(`volume:${chainId}:base`, key)
      })
      keysToDelQuote.forEach((key) => {
        redis.HDEL(`volume:${chainId}:quote`, key)
      })
    })
  } catch (err) {
    console.error(err)
    console.log('Could not remove zero volumes')
  }
  console.timeEnd('updateVolumes')
}

async function updatePendingOrders() {
  console.time('updatePendingOrders')

  const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString()
  let orderUpdates: string[][] = []
  const query = {
    text: "UPDATE offers SET order_status='c', update_timestamp=NOW() WHERE (order_status IN ('m', 'b', 'pm') AND update_timestamp < $1) OR (order_status='o' AND unfilled <= 0) RETURNING chainid, id, order_status;",
    values: [oneMinAgo],
  }
  const update = await db.query(query)
  if (update.rowCount > 0) {
    orderUpdates = orderUpdates.concat(
      update.rows.map((row) => [row.chainid, row.id, row.order_status])
    )
  }

  // Update fills
  const fillsQuery = {
    text: "UPDATE fills SET fill_status='e', feeamount=0 WHERE fill_status IN ('m', 'b', 'pm') AND insert_timestamp < $1",
    values: [oneMinAgo],
  }
  await db.query(fillsQuery)

  const expiredQuery = {
    text: "UPDATE offers SET order_status='e', zktx=NULL, update_timestamp=NOW() WHERE order_status IN ('o', 'pm', 'pf') AND expires < EXTRACT(EPOCH FROM NOW()) RETURNING chainid, id, order_status",
    values: [],
  }
  const updateExpires = await db.query(expiredQuery)
  if (updateExpires.rowCount > 0) {
    orderUpdates = orderUpdates.concat(
      updateExpires.rows.map((row) => [row.chainid, row.id, row.order_status])
    )
  }

  if (orderUpdates.length > 0) {
    VALID_CHAINS.forEach((chainId: number) => {
      const updatesForThisChain = orderUpdates.filter(
        (row) => Number(row[0]) === chainId
      )
      publisher.PUBLISH(
        `broadcastmsg:all:${chainId}:all`,
        JSON.stringify({ op: 'orderstatus', args: [updatesForThisChain] })
      )
    })
  }
  console.timeEnd('updatePendingOrders')
}

async function updateLastPrices() {
  console.time('updateLastPrices')

  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const redisKeyPriceInfo = `lastpriceinfo:${chainId}`

    const redisPrices = await redis.HGETALL(`lastprices:${chainId}`)
    const redisPricesQuote = await redis.HGETALL(`volume:${chainId}:quote`)
    const redisVolumesBase = await redis.HGETALL(`volume:${chainId}:base`)
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)

    const results1: Promise<any>[] = markets.map(async (marketId) => {
      const marketInfo = await getMarketInfo(marketId, chainId).catch(
        () => null
      )
      if (!marketInfo) return
      const lastPriceInfo: any = {}
      const yesterday = new Date(Date.now() - 86400 * 1000)
        .toISOString()
        .slice(0, 10)
      const yesterdayPrice = Number(
        await redis.get(`dailyprice:${chainId}:${marketId}:${yesterday}`)
      )
      lastPriceInfo.price = +redisPrices[marketId]
      lastPriceInfo.priceChange = yesterdayPrice
        ? Number(formatPrice(lastPriceInfo.price - yesterdayPrice))
        : 0

      lastPriceInfo.quoteVolume = redisPricesQuote[marketId] || 0
      lastPriceInfo.baseVolume = redisVolumesBase[marketId] || 0

      redis.HSET(redisKeyPriceInfo, marketId, JSON.stringify(lastPriceInfo))
    })
    await Promise.all(results1)
  })
  await Promise.all(results0)
  console.timeEnd('updateLastPrices')
}

async function updateMarketSummarys() {
  console.time('updateMarketSummarys')

  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const redisKeyMarketSummary = `marketsummary:${chainId}`
    const redisKeyMarketSummaryUTC = `marketsummary:utc:${chainId}`

    // fetch needed data
    const redisVolumesQuote = await redis.HGETALL(`volume:${chainId}:quote`)
    const redisVolumesBase = await redis.HGETALL(`volume:${chainId}:base`)
    const redisPrices = await redis.HGETALL(`lastprices:${chainId}`)
    const redisPricesLow = await redis.HGETALL(`price:${chainId}:low`)
    const redisPricesHigh = await redis.HGETALL(`price:${chainId}:high`)
    const redisBestAsk = await redis.HGETALL(`bestask:${chainId}`)
    const redisBestBid = await redis.HGETALL(`bestbid:${chainId}`)
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
    const redisVolumesQuoteUTC = await redis.HGETALL(
      `volume:utc:${chainId}:quote`
    )
    const redisVolumesBaseUTC = await redis.HGETALL(
      `volume:utc:${chainId}:base`
    )
    const redisPricesLowUTC = await redis.HGETALL(`price:utc:${chainId}:low`)
    const redisPricesHighUTC = await redis.HGETALL(`price:utc:${chainId}:high`)

    const results1: Promise<any>[] = markets.map(async (marketId: ZZMarket) => {
      const marketInfo = await getMarketInfo(marketId, chainId).catch(
        () => null
      )
      if (!marketInfo) return
      const yesterday = new Date(Date.now() - 86400 * 1000).toISOString()
      const yesterdayPrice = Number(
        await redis.get(
          `dailyprice:${chainId}:${marketId}:${yesterday.slice(0, 10)}`
        )
      )
      const today = new Date(Date.now()).toISOString()
      const todayPrice = Number(
        await redis.get(
          `dailyprice:${chainId}:${marketId}:${today.slice(0, 10)}`
        )
      )

      const lastPrice = +redisPrices[marketId]

      let priceChange = 0
      let priceChangeUTC = 0
      let priceChangePercent_24h = 0
      let priceChangePercent_24hUTC = 0
      if (yesterdayPrice) {
        priceChange = Number(formatPrice(lastPrice - yesterdayPrice))
        priceChangePercent_24h = Number(formatPrice(priceChange / lastPrice))
      } else {
        priceChange = 0
        priceChangePercent_24h = 0
      }

      if (todayPrice) {
        priceChangeUTC = Number(formatPrice(lastPrice - todayPrice))
        priceChangePercent_24hUTC = Number(
          formatPrice(priceChangeUTC / lastPrice)
        )
      } else {
        priceChangeUTC = 0
        priceChangePercent_24hUTC = 0
      }

      // get low/high price
      const lowestPrice_24h = Number(redisPricesLow[marketId])
      const highestPrice_24h = Number(redisPricesHigh[marketId])
      const lowestPrice_24hUTC = Number(redisPricesLowUTC[marketId])
      const highestPrice_24hUTC = Number(redisPricesHighUTC[marketId])

      // get volume
      const quoteVolume = Number(redisVolumesQuote[marketId] || 0)
      const baseVolume = Number(redisVolumesBase[marketId] || 0)
      const quoteVolumeUTC = Number(redisVolumesQuoteUTC[marketId] || 0)
      const baseVolumeUTC = Number(redisVolumesBaseUTC[marketId] || 0)

      // get best ask/bid
      const lowestAsk = Number(formatPrice(redisBestAsk[marketId]))
      const highestBid = Number(formatPrice(redisBestBid[marketId]))

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
        priceChangePercent_24h,
        highestPrice_24h,
        lowestPrice_24h,
      }
      const marketSummaryUTC: ZZMarketSummary = {
        market: marketId,
        baseSymbol: marketInfo.baseAsset.symbol,
        quoteSymbol: marketInfo.quoteAsset.symbol,
        lastPrice,
        lowestAsk,
        highestBid,
        baseVolume: baseVolumeUTC,
        quoteVolume: quoteVolumeUTC,
        priceChange: priceChangeUTC,
        priceChangePercent_24h: priceChangePercent_24hUTC,
        highestPrice_24h: highestPrice_24hUTC,
        lowestPrice_24h: lowestPrice_24hUTC,
      }
      redis.HSET(
        redisKeyMarketSummaryUTC,
        marketId,
        JSON.stringify(marketSummaryUTC)
      )
      redis.HSET(redisKeyMarketSummary, marketId, JSON.stringify(marketSummary))
    })
    await Promise.all(results1)
  })
  await Promise.all(results0)

  console.timeEnd('updateMarketSummarys')
}

async function updateUsdPrice() {
  console.time('Updating usd price.')

  // use mainnet as price source TODO we should rework the price source to work with multible networks
  const network = getNetwork(1)
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
        const fetchResult = (await fetch(
          `${ZKSYNC_BASE_URL[network]}tokens/${token}/priceIn/usd`
        ).then((r: any) => r.json())) as AnyObject
        let usdPrice =
          fetchResult?.result?.price > 0
            ? formatPrice(fetchResult?.result?.price)
            : 1
        if (usdPrice === 0 && token === 'ZZ') {
          usdPrice = '3.30'
        } else if (usdPrice === 0) {
          usdPrice = '1.00'
        }

        updatedTokenPrice[token] = usdPrice
        tokenInfo.usdPrice = usdPrice
      } catch (err: any) {
        console.log(
          `Could not update price for ${token}, Error: ${err.message}`
        )
      }
      redis.HSET(
        `tokeninfo:${chainId}`,
        tokenInfo.symbol,
        JSON.stringify(tokenInfo)
      )
      redis.HSET(
        `tokeninfo:${chainId}`,
        tokenInfo.address,
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
      redis.HSET(`marketinfo:${chainId}`, market, JSON.stringify(marketInfo))
      publisher.PUBLISH(
        `broadcastmsg:all:${chainId}:${market}`,
        JSON.stringify({ op: 'marketinfo', args: [marketInfo] })
      )
    })
    await Promise.all(results2)
  })
  await Promise.all(results0)
  console.timeEnd('Updating usd price.')
}

async function updateFeesZkSync() {
  console.time('Update fees zkSync')

  const results0: Promise<any>[] = VALID_CHAINS_ZKSYNC.map(
    async (chainId: number) => {
      const newFees: any = {}
      const network = getNetwork(chainId)
      // get redis cache
      const tokenInfos: any = await redis.HGETALL(`tokeninfo:${chainId}`)
      const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
      // get every token form activemarkets once
      let tokenSymbols = markets.join('-').split('-')
      tokenSymbols = tokenSymbols.filter(
        (x, i) => i === tokenSymbols.indexOf(x)
      )
      // update fee for each
      const results1: Promise<any>[] = tokenSymbols.map(
        async (tokenSymbol: string) => {
          let fee = 0
          const tokenInfoString = tokenInfos[tokenSymbol]
          if (!tokenInfoString) return

          const tokenInfo = JSON.parse(tokenInfoString)
          if (!tokenInfo) return
          // enabledForFees -> get fee dircectly form zkSync
          if (tokenInfo.enabledForFees) {
            try {
              const feeReturn = await SYNC_PROVIDER[network].getTransactionFee(
                'Swap',
                '0x88d23a44d07f86b2342b4b06bd88b1ea313b6976',
                tokenSymbol
              )
              fee = Number(
                SYNC_PROVIDER[network].tokenSet.formatToken(
                  tokenSymbol,
                  feeReturn.totalFee
                )
              )
            } catch (e: any) {
              console.log(
                `Can't get fee for ${tokenSymbol}, error: ${e.message}`
              )
            }
          }
          // not enabledForFees -> use token price and USDC fee
          if (!fee) {
            try {
              const usdPrice: number = tokenInfo.usdPrice
                ? Number(tokenInfo.usdPrice)
                : 0
              const usdReferenceString = await redis.HGET(
                `tokenfee:${chainId}`,
                'USDC'
              )
              const usdReference: number = usdReferenceString
                ? Number(usdReferenceString)
                : 0
              if (usdPrice > 0) {
                fee = usdReference / usdPrice
              }
            } catch (e) {
              console.log(
                `Can't get fee per reference for ${tokenSymbol}, error: ${e}`
              )
            }
          }

          // save new fee
          newFees[tokenSymbol] = fee
          if (fee) {
            redis.HSET(`tokenfee:${chainId}`, tokenSymbol, fee)
          }
        }
      )
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
          marketInfo.baseFee =
            Number(newFees[marketInfo.baseAsset.symbol]) * 1.05
          updated = true
        }
        if (newQuoteFee && marketInfo.quoteFee !== newQuoteFee) {
          marketInfo.quoteFee =
            Number(newFees[marketInfo.quoteAsset.symbol]) * 1.05
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
    }
  )
  await Promise.all(results0)
  console.timeEnd('Update fees zkSync')
}

async function updateFeesEVM() {
  console.time('Update fees EVM')
  try {
    const results0: Promise<any>[] = VALID_EVM_CHAINS.map(
      async (chainId: number) => {
        let feeData: any = {}
        let feeAmountWETH = 0.002 // fallback fee
        let gasUsedEstimation: ethers.BigNumber = ethers.BigNumber.from(
          EVMConfig[chainId].gasUsed
        )
        try {
          feeData = await ETHERS_PROVIDERS[chainId].getFeeData()
          const market = getFeeEstimationMarket(chainId)
          const marketInfo = await redis.HGET(`marketinfo:${chainId}`, market)
          if (!marketInfo)
            throw new Error(`updateFeesEVM: No marketInfo for ${market}`)
          const buyOrder = await getFeeEstimationOrder(
            chainId,
            JSON.parse(marketInfo) as ZZMarketInfo,
            WALLET[chainId],
            'b'
          )
          const sellOrder = await getFeeEstimationOrder(
            chainId,
            JSON.parse(marketInfo) as ZZMarketInfo,
            WALLET[chainId],
            's'
          )
          const makerSignatureModified =
            buyOrder.signature.slice(0, 2) +
            buyOrder.signature.slice(-2) +
            buyOrder.signature.slice(2, -2)
          const takerSignatureModified =
            sellOrder.signature.slice(0, 2) +
            sellOrder.signature.slice(-2) +
            sellOrder.signature.slice(2, -2)

          gasUsedEstimation = await EXCHANGE_CONTRACTS[
            chainId
          ].estimateGas.matchOrders(
            [
              buyOrder.user,
              buyOrder.sellToken,
              buyOrder.buyToken,
              buyOrder.feeRecipientAddress,
              buyOrder.relayerAddress,
              buyOrder.sellAmount,
              buyOrder.buyAmount,
              buyOrder.makerVolumeFee,
              buyOrder.takerVolumeFee,
              buyOrder.gasFee,
              buyOrder.expirationTimeSeconds,
              buyOrder.salt,
            ],
            [
              sellOrder.user,
              sellOrder.sellToken,
              sellOrder.buyToken,
              sellOrder.feeRecipientAddress,
              sellOrder.relayerAddress,
              sellOrder.sellAmount,
              sellOrder.buyAmount,
              sellOrder.makerVolumeFee,
              sellOrder.takerVolumeFee,
              sellOrder.gasFee,
              sellOrder.expirationTimeSeconds,
              sellOrder.salt,
            ],
            makerSignatureModified,
            takerSignatureModified
          )

          // TEMP OVERRIDE
          console.log(gasUsedEstimation.toString());
          gasUsedEstimation = ethers.BigNumber.from(1500000);
        } catch (e: any) {
          console.log(
            `No fee data for chainId: ${chainId}, error: ${e.message}`
          )
        }

        if (feeData.maxFeePerGas) {
          const feeInWei = feeData.maxFeePerGas.mul(gasUsedEstimation)
          feeAmountWETH = Number(ethers.utils.formatEther(feeInWei))
        } else if (feeData.gasPrice) {
          const feeInWei = feeData.gasPrice.mul(gasUsedEstimation)
          feeAmountWETH = Number(ethers.utils.formatEther(feeInWei))
        } else {
          console.error(
            `No fee data for chainId: ${chainId}, unsing default ${feeAmountWETH} WETH.`
          )
        }

        // check if fee changed enough to trigger update
        const oldFee = Number(await redis.HGET(`tokenfee:${chainId}`, 'WETH'))
        const delta = Math.abs(feeAmountWETH - oldFee) / oldFee
        if (delta < 0.05) {
          console.log(
            `updateFeesEVM: ${chainId}: new fee ${feeAmountWETH} close to old fee ${oldFee}`
          )
          return
        }

        const newFees: any = []
        const tokenInfos = await redis.HGETALL(`tokeninfo:${chainId}`)
        const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
        // get every token form activemarkets once
        let tokenSymbols = markets
          .join('-')
          .split('-')
          .filter((t) => t.length < 20) // filter addresses
        tokenSymbols = tokenSymbols.filter(
          (x, i) => i === tokenSymbols.indexOf(x)
        )
        const wethInfo = JSON.parse(tokenInfos.WETH)
        const feeAmountUSD = Number(wethInfo.usdPrice) * feeAmountWETH * 1.05 // margin for fee change
        const results1: Promise<any>[] = tokenSymbols.map(
          async (tokenSymbol: string) => {
            if (!tokenInfos[tokenSymbol]) return
            const tokenInfo = JSON.parse(tokenInfos[tokenSymbol])
            if (!tokenInfo?.usdPrice) return
            const fee = feeAmountUSD / Number(tokenInfo.usdPrice)
            redis.HSET(
              `tokenfee:${chainId}`,
              tokenInfo.address,
              fee.toFixed(tokenInfo.decimals)
            )
            redis.HSET(
              `tokenfee:${chainId}`,
              tokenInfo.symbol,
              fee.toFixed(tokenInfo.decimals)
            )
            newFees[tokenSymbol] = fee.toFixed(tokenInfo.decimals)
          }
        )
        await Promise.all(results1)

        // update marketinfos & broadcastmsg
        const marketInfos = await redis.HGETALL(`marketinfo:${chainId}`)
        const results2: Promise<any>[] = markets.map(
          async (market: ZZMarket) => {
            if (!marketInfos[market]) return
            const marketInfo = JSON.parse(marketInfos[market])
            marketInfo.baseFee = newFees[marketInfo.baseAsset.symbol]
            marketInfo.quoteFee = newFees[marketInfo.quoteAsset.symbol]
            publisher.PUBLISH(
              `broadcastmsg:all:${chainId}:${market}`,
              JSON.stringify({ op: 'marketinfo', args: [marketInfo] })
            )
            // eslint-disable-next-line no-promise-executor-return
            await new Promise((resolve) => setTimeout(resolve, 250))
            redis.HSET(
              `marketinfo:${chainId}`,
              market,
              JSON.stringify(marketInfo)
            )
          }
        )
        await Promise.all(results2)
      }
    )
    await Promise.all(results0)
  } catch (err: any) {
    console.log(`Failed to update EVM fees: ${err}`)
  }

  console.timeEnd('Update fees EVM')
}

// Removes old liquidity
// Updates lastprice redis map
// Sets best bids and asks in a JSON for broadcasting
async function removeOldLiquidity() {
  console.time('removeOldLiquidity')

  const results0: Promise<any>[] = VALID_CHAINS_ZKSYNC.map(async (chainId) => {
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
          uniqueBuy[price] = uniqueBuy[price]
            ? uniqueBuy[price] + amount
            : amount
        } else {
          uniqueAsk[price] = uniqueAsk[price]
            ? uniqueAsk[price] + amount
            : amount
        }
      }

      // sort ask and bid keys
      const askSet = [...new Set(Object.keys(uniqueAsk))]
      const bidSet = [...new Set(Object.keys(uniqueBuy))]
      const lenghtAsks =
        askSet.length < NUMBER_OF_SNAPSHOT_POSITIONS
          ? askSet.length
          : NUMBER_OF_SNAPSHOT_POSITIONS
      const lengthBids =
        bidSet.length < NUMBER_OF_SNAPSHOT_POSITIONS
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
        askPrice += +askSet[i] * uniqueAsk[askSet[i]]
        askAmount += uniqueAsk[askSet[i]]
        asks[i] = ['s', Number(askSet[i]), Number(uniqueAsk[askSet[i]])]
      }
      for (let i = 1; i <= lengthBids; i++) {
        bidPrice +=
          +bidSet[bidSet.length - i] * uniqueBuy[bidSet[bidSet.length - i]]
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
        redis.HSET(`lastprices:${chainId}`, marketId, formatPrice(mid))
      }

      // Store best bids and asks per market
      const bestAskPrice = asks[0]?.[1] ? asks[0][1] : '0'
      const bestBidPrice = bids[0]?.[1] ? bids[0][1] : '0'
      const bestLiquidity = asks.concat(bids)
      redis.HSET(`bestask:${chainId}`, marketId, bestAskPrice)
      redis.HSET(`bestbid:${chainId}`, marketId, bestBidPrice)
      redis.SET(
        `bestliquidity:${chainId}:${marketId}`,
        JSON.stringify(bestLiquidity),
        { EX: 45 }
      )

      // Clear old liquidity every 10 seconds
      redis.DEL(redisKeyLiquidity)
    })
    await Promise.all(results1)
  })
  await Promise.all(results0)
  console.timeEnd('removeOldLiquidity')
}

async function runDbMigration() {
  console.log('running db migration')
  const migration = fs.readFileSync('schema.sql', 'utf8')
  await db.query(migration).catch(console.error)
}

/**
 * Used to initialy fetch tokens infos on startup & updated on each recycle
 * @param chainId
 */
async function updateTokenInfoZkSync(chainId: number) {
  const updatedTokenInfo: AnyObject = {
    ETH: {
      id: 0,
      address: ethers.constants.AddressZero,
      symbol: 'ETH',
      decimals: 18,
      enabledForFees: true,
      usdPrice: '1910.20',
      name: 'Ethereum',
    },
  }

  // fetch new tokenInfo from zkSync
  let index = 0
  let tokenInfoResults: AnyObject[]
  const network = getNetwork(chainId)
  do {
    const fetchResult = await fetch(
      `${ZKSYNC_BASE_URL[network]}tokens?from=${index}&limit=100&direction=newer`
    ).then((r: any) => r.json())
    tokenInfoResults = fetchResult.result.list
    const results1: Promise<any>[] = tokenInfoResults.map(
      async (tokenInfo: AnyObject) => {
        const { symbol, address } = tokenInfo
        if (!symbol || !address || address === ethers.constants.AddressZero)
          return
        if (!symbol.includes('ERC20')) {
          tokenInfo.usdPrice = 0
          try {
            const contract = new ethers.Contract(
              address,
              ERC20_ABI,
              ETHERS_PROVIDERS[chainId]
            )
            tokenInfo.name = await contract.name()
          } catch (e: any) {
            console.warn(e.message)
            tokenInfo.name = tokenInfo.address
          }
          redis.HSET(`tokeninfo:${chainId}`, symbol, JSON.stringify(tokenInfo))
          updatedTokenInfo[symbol] = tokenInfo
        }
      }
    )
    await Promise.all(results1)
    index = tokenInfoResults[tokenInfoResults.length - 1].id
  } while (tokenInfoResults.length > 99)

  // update existing marketInfo with the new tokenInfos
  const marketInfos = await redis.HGETALL(`marketinfo:${chainId}`)
  const resultsUpdateMarketInfos: Promise<any>[] = Object.keys(marketInfos).map(
    async (alias: string) => {
      const marketInfo = JSON.parse(marketInfos[alias])
      const [baseSymbol, quoteSymbol] = alias.split('-')
      if (!updatedTokenInfo[baseSymbol] || !updatedTokenInfo[quoteSymbol])
        return

      marketInfo.baseAsset = updatedTokenInfo[baseSymbol]
      marketInfo.quoteAsset = updatedTokenInfo[quoteSymbol]
      redis.HSET(`marketinfo:${chainId}`, alias, JSON.stringify(marketInfo))
    }
  )
  await Promise.all(resultsUpdateMarketInfos)
}

async function sendUpdates(
  chainId: number,
  market: ZZMarket,
  makerId: string,
  takerId: string,
  op: string,
  args: any
) {
  publisher.PUBLISH(
    `broadcastmsg:all:${chainId}:${market}`,
    JSON.stringify({ op, args })
  )
  publisher.PUBLISH(
    `broadcastmsg:user:${chainId}:${makerId}`,
    JSON.stringify({ op, args })
  )
  publisher.PUBLISH(
    `broadcastmsg:user:${chainId}:${takerId}`,
    JSON.stringify({ op, args })
  )
}

/**
 * Used to send send matched orders
 */
async function sendMatchedOrders() {
  const results: Promise<any>[] = VALID_EVM_CHAINS.map(
    async (chainId: number) => {
      const matchChainString = await redis.RPOP(`matchedorders:${chainId}`)
      if (!matchChainString) return
      console.time('sendMatchedOrders: pre processing')

      console.log(
        `sendMatchedOrders: chainId ==> ${chainId}, matchChainString ==> ${matchChainString}`
      )
      const match = JSON.parse(matchChainString)
      const marketInfo = await getMarketInfo(match.market, match.chainId)
      const { makerOrder, takerOrder, gasFee: feeAmount, feeToken } = match

      if (!makerOrder?.signature || !takerOrder?.signature) return
      const makerSignatureModified =
        makerOrder.signature.slice(0, 2) +
        makerOrder.signature.slice(-2) +
        makerOrder.signature.slice(2, -2)
      const takerSignatureModified =
        takerOrder.signature.slice(0, 2) +
        takerOrder.signature.slice(-2) +
        takerOrder.signature.slice(2, -2)

      console.timeEnd('sendMatchedOrders: pre processing')
      console.time('sendMatchedOrders: sending')
      let transaction: any
      try {
        transaction = await EXCHANGE_CONTRACTS[chainId].matchOrders(
          [
            makerOrder.user,
            makerOrder.sellToken,
            makerOrder.buyToken,
            makerOrder.feeRecipientAddress,
            makerOrder.relayerAddress,
            makerOrder.sellAmount,
            makerOrder.buyAmount,
            makerOrder.makerVolumeFee,
            makerOrder.takerVolumeFee,
            makerOrder.gasFee,
            makerOrder.expirationTimeSeconds,
            makerOrder.salt,
          ],
          [
            takerOrder.user,
            takerOrder.sellToken,
            takerOrder.buyToken,
            takerOrder.feeRecipientAddress,
            takerOrder.relayerAddress,
            takerOrder.sellAmount,
            takerOrder.buyAmount,
            takerOrder.makerVolumeFee,
            takerOrder.takerVolumeFee,
            takerOrder.gasFee,
            takerOrder.expirationTimeSeconds,
            takerOrder.salt,
          ],
          makerSignatureModified,
          takerSignatureModified
        )
      } catch (e: any) {
        console.error(`Failed EVM transaction: ${e.message}`)
        transaction = {
          hash: null,
          reason: e.message,
        }
      }

      console.timeEnd('sendMatchedOrders: sending')
      console.time('sendMatchedOrders: post processing broadcast')
      /* txStatus: s - success, b - broadcasted (pending), r - rejected */
      let txStatus: string
      if (transaction.hash) {
        // update user
        // on arbitrum if the node returns a tx hash, it means it was accepted
        // on other EVM chains, the result of the transaction needs to be awaited
        if ([42161, 421613].includes(chainId)) {
          txStatus = 's'
        } else {
          txStatus = 'b'
          sendUpdates(
            chainId,
            match.market,
            match.makerId,
            match.takerId,
            'fillstatus',
            [
              [
                [
                  chainId,
                  match.fillId,
                  txStatus,
                  transaction.hash,
                  0, // remaining
                  0,
                  0,
                  new Date().toISOString(), // timestamp
                ],
              ],
            ]
          )
        }
      } else {
        txStatus = 'r'
      }

      // This is for non-arbitrum EVM chains to confirm the tx status
      if (![42161, 421613].includes(chainId)) {
        const receipt = await ETHERS_PROVIDERS[chainId].waitForTransaction(
          transaction.hash
        )
        txStatus = receipt.status === 1 ? 's' : 'r'
      }

      const fillupdateBroadcastMinted = await db.query(
        'UPDATE fills SET fill_status=$1, txhash=$2, feeamount=$3, feetoken=$4 WHERE id=$5 RETURNING id, fill_status, txhash, price',
        [
          txStatus === 's' ? 'f' : 'r', // filled only has f or r
          transaction.hash,
          transaction.hash ? feeAmount : 0,
          transaction.hash ? feeToken : null,
          match.fillId,
        ]
      )

      // Update lastprice
      if (txStatus === 's') {
        const today = new Date().toISOString().slice(0, 10)
        redis.SET(
          `dailyprice:${chainId}:${match.market}:${today}`,
          fillupdateBroadcastMinted.rows[0].price,
          { EX: 604800 }
        )
        redis.HSET(
          `lastprices:${chainId}`,
          match.market,
          fillupdateBroadcastMinted.rows[0].price
        )
      }

      let orderUpdateBroadcastMinted: AnyObject
      if (txStatus === 's') {
        orderUpdateBroadcastMinted = await db.query(
          "UPDATE offers SET order_status = (CASE WHEN unfilled <= $1 THEN 'f' ELSE 'pf' END), update_timestamp=NOW() WHERE id IN ($2, $3) RETURNING id, order_status, unfilled",
          [
            marketInfo?.baseFee ? marketInfo.baseFee : 0,
            match.takerId,
            match.makerId,
          ]
        )
      } else {
        const startIndex = transaction.reason.indexOf('execution reverted')
        const endIndex = transaction.reason.indexOf('code')
        const reason = transaction.reason.slice(startIndex, endIndex)
        console.log(reason)
        const cancelOrderIds = []
        if (reason.includes('right')) {
          cancelOrderIds.push(match.takerId)
        } else if (reason.includes('left')) {
          cancelOrderIds.push(match.makerId)
        } else if (reason.includes('not profitable spread')) {
          // ignore. nothing needs to be canceled
        } else {
          // default: cancel both
          cancelOrderIds.push(match.makerId)
          cancelOrderIds.push(match.takerId)
        }
        orderUpdateBroadcastMinted = await db.query(
          `UPDATE offers SET order_status='c', zktx=NULL, update_timestamp=NOW(), unfilled=0 WHERE id = ANY($1::int[]) RETURNING id, order_status, unfilled`,
          [cancelOrderIds]
        )
      }
      const orderUpdatesBroadcastMinted = orderUpdateBroadcastMinted.rows.map(
        (row: any) => [
          chainId,
          row.id,
          row.order_status,
          null, // tx hash
          transaction.reason ? transaction.reason : row.unfilled,
        ]
      )
      const fillUpdatesBroadcastMinted = fillupdateBroadcastMinted.rows.map(
        (row) => [
          chainId,
          row.id,
          row.fill_status,
          row.txhash,
          0, // remaing for fills is always 0
          feeAmount,
          feeToken,
          new Date().toISOString(), // timestamp
        ]
      )

      console.timeEnd('sendMatchedOrders: post processing broadcast')
      console.time('sendMatchedOrders: post processing filled')
      // wait for tx to be processed before sending the result
      if (transaction.hash) {
        try {
          await ETHERS_PROVIDERS[chainId].waitForTransaction(transaction.hash)
        } catch (e: any) {
          console.error(
            `Failed to wait for tx ${transaction.hash} because ${e.message}`
          )
        }
      }

      if (orderUpdatesBroadcastMinted.length) {
        sendUpdates(
          chainId,
          match.market,
          match.makerId,
          match.takerId,
          'orderstatus',
          [orderUpdatesBroadcastMinted]
        )
      }
      if (fillUpdatesBroadcastMinted.length) {
        sendUpdates(
          chainId,
          match.market,
          match.makerId,
          match.takerId,
          'fillstatus',
          [fillUpdatesBroadcastMinted]
        )
      }
      console.timeEnd('sendMatchedOrders: post processing filled')
    }
  )

  await Promise.all(results)
  setTimeout(sendMatchedOrders, 200)
}

/* update mm info after chainging the settings in EVMConfig */
async function updateEVMMarketInfo() {
  console.time('Update EVM marketinfo')

  const results0: Promise<any>[] = VALID_EVM_CHAINS.map(
    async (chainId: number) => {
      const evmConfig = EVMConfig[chainId]

      // check if settings changed
      const testPairString = await redis.HGET(
        `marketinfo:${chainId}`,
        'WETH-USDC'
      )
      let updated = false
      if (testPairString) {
        const marketInfo = JSON.parse(testPairString)
        if (
          marketInfo.exchangeAddress !== evmConfig.exchangeAddress ||
          marketInfo.feeAddress !== evmConfig.feeAddress ||
          marketInfo.relayerAddress !== evmConfig.relayerAddress ||
          marketInfo.makerVolumeFee !== evmConfig.minMakerVolumeFee ||
          marketInfo.takerVolumeFee !== evmConfig.minTakerVolumeFee ||
          Number(marketInfo.contractVersion) !==
            Number(evmConfig.domain.version)
        )
          updated = true
      }
      if (!updated) return

      // update all marketInfo
      const marketInfos = await redis.HGETALL(`marketinfo:${chainId}`)
      const markets = Object.keys(marketInfos)
      const results1: Promise<any>[] = markets.map(async (market: ZZMarket) => {
        if (!marketInfos[market]) return

        const marketInfo = JSON.parse(marketInfos[market])
        marketInfo.exchangeAddress = evmConfig.exchangeAddress
        marketInfo.feeAddress = evmConfig.feeAddress
        marketInfo.relayerAddress = evmConfig.relayerAddress
        marketInfo.makerVolumeFee = evmConfig.minMakerVolumeFee
        marketInfo.takerVolumeFee = evmConfig.minTakerVolumeFee
        marketInfo.contractVersion = Number(evmConfig.domain.version)
        redis.HSET(`marketinfo:${chainId}`, market, JSON.stringify(marketInfo))
      })
      await Promise.all(results1)
    }
  )
  await Promise.all(results0)
  console.timeEnd('Update EVM marketinfo')
}

async function seedArbitrumMarkets() {
  console.time('seeding arbitrum markets')
  /*
  const marketSummaryWethUsdc = {
    market: 'WETH-USDC',
    baseSymbol: 'WETH',
    quoteSymbol: 'USDC',
    lastPrice: 1200,
    lowestAsk: 1201,
    highestBid: 1999,
    baseVolume: 0,
    quoteVolume: 0,
    priceChange: 0,
    priceChangePercent_24h: 0,
    highestPrice_24h: 1250,
    lowestPrice_24h: 1150
  }
  const marketSummaryWbtcUsdc = {
    market: 'WBTC-USDC',
    baseSymbol: 'WBTC',
    quoteSymbol: 'USDC',
    lastPrice: 20000,
    lowestAsk: 20100,
    highestBid: 19900,
    baseVolume: 0,
    quoteVolume: 0,
    priceChange: 0,
    priceChangePercent_24h: 0,
    highestPrice_24h: 21000,
    lowestPrice_24h: 19000
  }
  const marketSummaryUsdcUsdt = {
    market: 'USDC-USDT',
    baseSymbol: 'USDC',
    quoteSymbol: 'USDT',
    lastPrice: 1,
    lowestAsk: 1,
    highestBid: 1,
    baseVolume: 0,
    quoteVolume: 0,
    priceChange: 0,
    priceChangePercent_24h: 0,
    highestPrice_24h: 1,
    lowestPrice_24h: 1
  }
  const marketSummaryZzUsdc = {
    market: 'ZZ-USDC',
    baseSymbol: 'ZZ',
    quoteSymbol: 'USDC',
    lastPrice: 3,
    lowestAsk: 3,
    highestBid: 1,
    baseVolume: 0,
    quoteVolume: 0,
    priceChange: 0,
    priceChangePercent_24h: 0,
    highestPrice_24h: 3,
    lowestPrice_24h: 3
  }
  const wethTokenInfo = {
    id: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    symbol: 'WETH',
    decimals: 18,
    enabledForFees: true,
    usdPrice: '1081.75',
    name: 'Wrapped Ether'
  }
  const usdcTokenInfo = {
    id: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    symbol: 'USDC',
    decimals: 6,
    enabledForFees: true,
    usdPrice: '1',
    name: 'USD Coin'
  }
  const wbtcTokenInfo = {
    id: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    symbol: 'WBTC',
    decimals: 8,
    enabledForFees: true,
    usdPrice: '20000',
    name: 'Wrapped Bitcoin'
  }
  const usdtTokenInfo = {
    id: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    symbol: 'USDT',
    decimals: 6,
    enabledForFees: true,
    usdPrice: '1',
    name: 'Tether'
  }
  const zzTokenInfo = {
    id: '0xADA42bb73b42e0472A994218fb3799dFCDA21237',
    address: '0xADA42bb73b42e0472A994218fb3799dFCDA21237',
    symbol: 'ZZ',
    decimals: 18,
    enabledForFees: true,
    usdPrice: '3',
    name: 'ZigZag'
  }
  const lastPriceInfoWethUsdc = {
    price: 1200,
    priceChange: -72.18,
    quoteVolume: '3945712',
    baseVolume: '3584.25'
  }
  const lastPriceInfoWbtcUsdc = {
    price: 20000,
    priceChange: -700,
    quoteVolume: '0',
    baseVolume: '0'
  }
  const lastPriceInfoUsdcUsdt = {
    price: 1,
    priceChange: 0,
    quoteVolume: '0',
    baseVolume: '0'
  }
  const lastPriceInfoZzUsdc = {
    price: 3,
    priceChange: 0,
    quoteVolume: '0',
    baseVolume: '0'
  }
  //await redis.HSET(
  //  'marketsummary:42161',
  //  'WETH-USDC',
  //  JSON.stringify(marketSummaryWethUsdc)
  //)
  //await redis.HSET(
  //  'marketsummary:42161',
  //  'WBTC-USDC',
  //  JSON.stringify(marketSummaryWbtcUsdc)
  //)
  //await redis.HSET(
  //  'marketsummary:42161',
  //  'USDC-USDT',
  //  JSON.stringify(marketSummaryUsdcUsdt)
  //)
  await redis.HSET(
    'marketsummary:42161',
    'ZZ-USDC',
    JSON.stringify(marketSummaryZzUsdc)
  )
  //await redis.SADD('activemarkets:42161', 'WETH-USDC')
  //await redis.SADD('activemarkets:42161', 'WBTC-USDC')
  //await redis.SADD('activemarkets:42161', 'USDT-USDC')
  await redis.SADD('activemarkets:42161', 'ZZ-USDC')
  //await redis.HSET('tokenfee:42161', 'WETH', '0.001')
  //await redis.HSET('tokenfee:42161', 'USDC', '1')
  //await redis.HSET('tokenfee:42161', 'USDT', '1')
  //await redis.HSET('tokenfee:42161', 'WBTC', '0.00005')
  await redis.HSET('tokenfee:42161', 'ZZ', '0.3')
  //await redis.HSET('tokeninfo:42161', 'WETH', JSON.stringify(wethTokenInfo))
  //await redis.HSET('tokeninfo:42161', 'USDC', JSON.stringify(usdcTokenInfo))
  //await redis.HSET('tokeninfo:42161', 'WBTC', JSON.stringify(wbtcTokenInfo))
  //await redis.HSET('tokeninfo:42161', 'USDT', JSON.stringify(usdtTokenInfo))
  await redis.HSET('tokeninfo:42161', 'ZZ', JSON.stringify(zzTokenInfo))
  //await redis.HSET('lastprices:42161', 'WETH-USDC', '1200')
  //await redis.HSET('lastprices:42161', 'WBTC-USDC', '20000')
  //await redis.HSET('lastprices:42161', 'USDC-USDT', '1')
  await redis.HSET('lastprices:42161', 'ZZ-USDC', '3')
  //await redis.HSET(
  //  'lastpriceinfo:42161',
  //  'WETH-USDC',
  //  JSON.stringify(lastPriceInfoWethUsdc)
  //)
  //await redis.HSET(
  //  'lastpriceinfo:42161',
  //  'WBTC-USDC',
  //  JSON.stringify(lastPriceInfoWbtcUsdc)
  //)
  //await redis.HSET(
  //  'lastpriceinfo:42161',
  //  'USDC-USDT',
  //  JSON.stringify(lastPriceInfoUsdcUsdt)
  //)
  await redis.HSET(
    'lastpriceinfo:42161',
    'ZZ-USDC',
    JSON.stringify(lastPriceInfoZzUsdc)
  )
  */
  console.timeEnd('seeding arbitrum markets')
}

async function cacheRecentTrades() {
  console.time('cacheRecentTrades')
  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
    const results1: Promise<any>[] = markets.map(async (marketId) => {
      const text =
        "SELECT chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id,feeamount,feetoken,insert_timestamp FROM fills WHERE chainid=$1 AND fill_status='f' AND market=$2 ORDER BY id DESC LIMIT 30"
      const query = {
        text,
        values: [chainId, marketId],
        rowMode: 'array',
      }
      const select = await db.query(query)
      redis.SET(
        `recenttrades:${chainId}:${marketId}`,
        JSON.stringify(select.rows)
      )
    })
    await Promise.all(results1)
  })
  await Promise.all(results0)

  console.timeEnd('cacheRecentTrades')
}

async function updateBestAskBidEVM() {
  console.time('updateBestAskBidEVM')
  const query = {
    text: "SELECT market, chainid, MAX(price) AS best_bid, MIN(price) AS best_ask FROM offers WHERE chainid = ANY($1::INT[]) AND order_status IN ('o', 'pm', 'pf') AND side = 'b' GROUP BY market, chainid;",
    values: [VALID_EVM_CHAINS],
  }
  const select = await db.query(query)
  const results: Promise<any>[] = select.rows.map(async (row: any) => {
    redis.HSET(`bestask:${row.chainid}`, row.market, row.best_ask)
    redis.HSET(`bestbid:${row.chainid}`, row.market, row.best_bid)
  })
  await Promise.all(results)

  console.timeEnd('updateBestAskBidEVM')
}

async function checkEVMChainAllowance() {
  const results0: Promise<any>[] = VALID_EVM_CHAINS.map(async (chainId) => {
    const { exchangeAddress } = EVMConfig[chainId]
    const testAddress = await WALLET[chainId].getAddress()
    const markets = getFeeEstimationMarket(chainId).split('-')
    for (let i = 0; i < markets.length; i++) {
      const tokenSymbol = markets[i]
      const tokenInfoString = await redis.HGET(
        `tokeninfo:${chainId}`,
        tokenSymbol
      )
      if (!tokenInfoString) return

      const { address, decimals } = JSON.parse(tokenInfoString)
      const contract = new ethers.Contract(address, ERC20_ABI, WALLET[chainId])
      const allowanceBN = await contract.allowance(testAddress, exchangeAddress)
      const allowanceNeededBN = ethers.utils.parseUnits('10', decimals)
      if (allowanceBN.lt(allowanceNeededBN)) {
        await contract.approve(exchangeAddress, allowanceNeededBN.toString())
      }
    }
  })
  await Promise.all(results0)
}

async function start() {
  console.log('background.ts: Run checks')
  if (!process.env.INFURA_PROJECT_ID) throw new Error('NO INFURA KEY SET')

  console.log('background.ts: Run startup')

  await redis.connect()
  await publisher.connect()
  await runDbMigration()

  // fetch abi's
  ERC20_ABI = JSON.parse(fs.readFileSync('abi/ERC20.abi', 'utf8'))
  EVMConfig = JSON.parse(fs.readFileSync('EVMConfig.json', 'utf8'))
  const EVMContractABI = JSON.parse(
    fs.readFileSync(
      'evm_contracts/artifacts/contracts/Exchange.sol/Exchange.json',
      'utf8'
    )
  ).abi

  // connect infura providers
  const operatorKeysString = process.env.OPERATOR_KEY as any
  if (!operatorKeysString && VALID_EVM_CHAINS.length)
    throw new Error("MISSING ENV VAR 'OPERATOR_KEY'")
  const operatorKeys = JSON.parse(operatorKeysString)
  const results: Promise<any>[] = VALID_CHAINS.map(async (chainId: number) => {
    if (ETHERS_PROVIDERS[chainId]) return
    try {
      ETHERS_PROVIDERS[chainId] = new ethers.providers.InfuraProvider(
        getNetwork(chainId),
        process.env.INFURA_PROJECT_ID
      )
      console.log(`Connected InfuraProvider for ${chainId}`)
    } catch (e: any) {
      console.warn(
        `Could not connect InfuraProvider for ${chainId}, trying RPC...`
      )
      ETHERS_PROVIDERS[chainId] = new ethers.providers.JsonRpcProvider(
        getRPCURL(chainId)
      )
      console.log(`Connected JsonRpcProvider for ${chainId}`)
    }

    if (VALID_EVM_CHAINS.includes(chainId) && operatorKeys) {
      const address = EVMConfig[chainId].exchangeAddress
      const key = operatorKeys[chainId]
      try {
        if (!address || !key) {
          throw new Error(`MISSING PKEY OR ADDRESS FOR ${chainId}`)
        }

        WALLET[chainId] = new ethers.Wallet(
          key,
          ETHERS_PROVIDERS[chainId]
        ).connect(ETHERS_PROVIDERS[chainId])

        EXCHANGE_CONTRACTS[chainId] = new ethers.Contract(
          address,
          EVMContractABI,
          WALLET[chainId]
        )
        EXCHANGE_CONTRACTS[chainId].connect(WALLET[chainId])
      } catch (e: any) {
        console.log(`Failed to setup ${chainId}. Disabling...`)
        const indexA = VALID_CHAINS.indexOf(chainId)
        VALID_CHAINS.splice(indexA, 1)
        const indexB = VALID_EVM_CHAINS.indexOf(chainId)
        VALID_EVM_CHAINS.splice(indexB, 1)
      }
    }
    if (chainId === 1) {
      try {
        SYNC_PROVIDER.mainnet = await zksync.getDefaultRestProvider('mainnet')
      } catch (e: any) {
        console.log(`Failed to setup ${chainId}. Disabling...`)
        const indexA = VALID_CHAINS.indexOf(1)
        VALID_CHAINS.splice(indexA, 1)
        const indexB = VALID_CHAINS_ZKSYNC.indexOf(1)
        VALID_CHAINS_ZKSYNC.splice(indexB, 1)
      }
    }
    if (chainId === 1002) {
      try {
        SYNC_PROVIDER.goerli = await zksync.getDefaultRestProvider('goerli')
      } catch (e: any) {
        console.log(`Failed to setup ${chainId}. Disabling...`)
        const indexA = VALID_CHAINS.indexOf(1002)
        VALID_CHAINS.splice(indexA, 1)
        const indexB = VALID_CHAINS_ZKSYNC.indexOf(1002)
        VALID_CHAINS_ZKSYNC.splice(indexB, 1)
      }
    }
  })
  Promise.all(results)

  ZKSYNC_BASE_URL.mainnet = 'https://api.zksync.io/api/v0.2/'
  ZKSYNC_BASE_URL.goerli = 'https://goerli-api.zksync.io/api/v0.2/'

  // reste some values on start-up
  const resetResult = VALID_CHAINS_ZKSYNC.map(async (chainId) => {
    const keysBussy = await redis.keys(`bussymarketmaker:${chainId}:*`)
    keysBussy.forEach(async (key: string) => {
      redis.del(key)
    })
  })
  await Promise.all(resetResult)

  /* startup */
  await updateEVMMarketInfo()
  await checkEVMChainAllowance()
  try {
    const updateResult = VALID_CHAINS_ZKSYNC.map(async (chainId) =>
      updateTokenInfoZkSync(chainId)
    )
    await Promise.all(updateResult)
  } catch (e: any) {
    console.error(`Failed to updateTokenInfoZkSync: ${e}`)
  }

  // Seed Arbitrum Markets
  await seedArbitrumMarkets()

  console.log('background.ts: Starting Update Functions')
  setInterval(updateBestAskBidEVM, 5000)
  setInterval(updatePendingOrders, 5000)
  setInterval(cacheRecentTrades, 5500)
  setInterval(removeOldLiquidity, 10000)
  setInterval(updateLastPrices, 15000)
  setInterval(updateFeesEVM, 20000)
  setInterval(updateMarketSummarys, 20000)
  setInterval(updateUsdPrice, 20000)
  setInterval(updateFeesZkSync, 25000)
  setInterval(updatePriceHighLow, 600000)
  setInterval(updateVolumes, 900000)

  setTimeout(sendMatchedOrders, 5000)
}

start()
