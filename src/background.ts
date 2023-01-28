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
  getFeeEstimationMarket,
  getReadableTxError,
  sortMarketPair,
} from './utils'
import type {
  ZZMarketInfo,
  AnyObject,
  ZZMarket,
  ZZMarketSummary,
  ZZPastOrder,
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

const updatePendingOrdersDelay = 5

async function getMarketInfo(market: ZZMarket, chainId: number) {
  if (!VALID_CHAINS.includes(chainId) || !market) return null

  const redisKeyMarketInfo = `marketinfo:${chainId}`
  const cache = await redis.HGET(redisKeyMarketInfo, market)
  if (cache) return JSON.parse(cache) as ZZMarketInfo

  return null
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

  const expiredTimestamp =
    ((Date.now() / 1000) | 0) + Math.floor(updatePendingOrdersDelay)
  const expiredQuery = {
    text: "UPDATE offers SET order_status='e', zktx=NULL, update_timestamp=NOW() WHERE order_status IN ('o', 'pm', 'pf') AND expires < $1 RETURNING chainid, id, order_status",
    values: [expiredTimestamp],
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

      // Store best bids, asks, and mid price per market
      const bestAskPrice = asks[0]?.[1] ? asks[0][1] : '0'
      const bestBidPrice = bids[0]?.[1] ? bids[0][1] : '0'
      const mid = (bestAskPrice + bestBidBrice) / 2;
      const bestLiquidity = asks.concat(bids)
      redis.HSET(`bestask:${chainId}`, marketId, bestAskPrice)
      redis.HSET(`bestbid:${chainId}`, marketId, bestBidPrice)
      redis.SET(
        `bestliquidity:${chainId}:${marketId}`,
        JSON.stringify(bestLiquidity),
        { EX: 45 }
      )
      if (!Number.isNaN(mid) && mid > 0) {
        redis.HSET(`lastprices:${chainId}`, marketId, formatPrice(mid))
      }

      // Clear old liquidity every 10 seconds
      redis.DEL(redisKeyLiquidity)
    })
    await Promise.all(results1)
  })
  await Promise.all(results0)
  console.timeEnd('removeOldLiquidity')
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
      const { makerOrder, takerOrder, feeToken } = match

      if (!makerOrder?.signature || !takerOrder?.signature) return

      console.timeEnd('sendMatchedOrders: pre processing')
      console.time('sendMatchedOrders: sending')
      let transaction: any
      try {
        transaction = await EXCHANGE_CONTRACTS[chainId].matchOrders(
          [
            makerOrder.user,
            makerOrder.sellToken,
            makerOrder.buyToken,
            makerOrder.sellAmount,
            makerOrder.buyAmount,
            makerOrder.expirationTimeSeconds,
          ],
          [
            takerOrder.user,
            takerOrder.sellToken,
            takerOrder.buyToken,
            takerOrder.sellAmount,
            takerOrder.buyAmount,
            takerOrder.expirationTimeSeconds,
          ],
          makerOrder.signature,
          takerOrder.signature
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
          0, // temp 0, use events later
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
      let readableTxError: string
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
        readableTxError = getReadableTxError(reason)
        console.log(reason)
        const rejectedOrderIds = []
        if (reason.includes('right')) {
          rejectedOrderIds.push(match.takerId)
        } else if (reason.includes('left')) {
          rejectedOrderIds.push(match.makerId)
        } else if (reason.includes('not profitable spread')) {
          // ignore. nothing needs to be rejected
        } else {
          // default: both got rejected
          rejectedOrderIds.push(match.makerId)
          rejectedOrderIds.push(match.takerId)
        }
        orderUpdateBroadcastMinted = await db.query(
          `UPDATE offers SET order_status='r', zktx=NULL, update_timestamp=NOW(), unfilled=0 WHERE id = ANY($1::int[]) RETURNING id, order_status, unfilled`,
          [rejectedOrderIds]
        )
      }
      const orderUpdatesBroadcastMinted = orderUpdateBroadcastMinted.rows.map(
        (row: any) => [
          chainId,
          row.id,
          row.order_status,
          null, // tx hash
          readableTxError || row.unfilled,
        ]
      )
      const fillUpdatesBroadcastMinted = fillupdateBroadcastMinted.rows.map(
        (row) => [
          chainId,
          row.id,
          row.fill_status,
          row.txhash,
          readableTxError || 0, // remaing for fills is always 0; but current msg format sends error reson if it failed here
          0, // temp 0, use events later
          feeToken,
          new Date().toISOString(), // timestamp
        ]
      )

      console.timeEnd('sendMatchedOrders: post processing broadcast')
      console.time('sendMatchedOrders: post processing filled')
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
        if (marketInfo.exchangeAddress !== evmConfig.exchangeAddress) {
          console.log(
            `Updating marketinfo: ${marketInfo.exchangeAddress} -> ${evmConfig.exchangeAddress}`
          )
          updated = true
        }
        if (marketInfo.contractVersion !== evmConfig.domain.version) {
          console.log(
            `Updating contractVersion: ${marketInfo.contractVersion} -> ${evmConfig.domain.version}`
          )
          updated = true
        }
      }
      if (!updated) return

      // update all marketInfo
      const marketInfos = await redis.HGETALL(`marketinfo:${chainId}`)
      const markets = Object.keys(marketInfos)
      const results1: Promise<any>[] = markets.map(async (market: ZZMarket) => {
        if (!marketInfos[market]) return

        const marketInfo = JSON.parse(marketInfos[market])
        marketInfo.exchangeAddress = evmConfig.exchangeAddress
        marketInfo.contractVersion = evmConfig.domain.version
        marketInfo.baseFee = 0
        marketInfo.quoteFee = 0
        redis.HSET(`marketinfo:${chainId}`, market, JSON.stringify(marketInfo))
      })
      await Promise.all(results1)
    }
  )
  await Promise.all(results0)
  console.timeEnd('Update EVM marketinfo')
}

async function cacheRecentTrades() {
  console.time('cacheRecentTrades')
  const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
    const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
    const results1: Promise<any>[] = markets.map(async (marketId) => {
      const text =
        "SELECT chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id,feeamount,feetoken,insert_timestamp FROM fills WHERE chainid=$1 AND fill_status='f' AND market=$2 ORDER BY id DESC LIMIT 20"
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

async function deleteOldOrders() {
  console.time('deleteOldOrders')
  await db.query(
    "DELETE FROM offers WHERE order_status NOT IN ('o', 'pm', 'pf', 'b', 'm') AND update_timestamp < (NOW() - INTERVAL '10 MINUTES')"
  )
  console.timeEnd('deleteOldOrders')
}

/* ################ V3 functions  ################ */

const TOKENS: { [key: string]: number } = {}
async function formatTokenAmount(
  chainId: number,
  tokenAddress: string,
  amount: ethers.BigNumber
): Promise<number> {
  if (!tokenAddress) return 0

  if (!TOKENS[tokenAddress]) {
    console.log(`No decmials for ${tokenAddress}, fetching...`)
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        ETHERS_PROVIDERS[chainId]
      )
      TOKENS[tokenAddress] = await tokenContract.decimals()
    } catch (e: any) {
      console.error('Cant get token decimals')
      console.error(e)
    }
  }
  if (!TOKENS[tokenAddress]) return 0

  return Number(ethers.utils.formatUnits(amount, TOKENS[tokenAddress]))
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

async function updateNumberOfTrades() {
  console.time('updateNumberOfTrades')

  const midnight = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()
  const queryUTC = {
    text: "SELECT chainid, market, count(*) as trades FROM fills WHERE fill_status IN ('f', 'pf') AND insert_timestamp > $1 AND chainid IS NOT NULL GROUP BY (chainid, market)",
    values: [midnight],
  }
  const selectUTC = await db.query(queryUTC)
  selectUTC.rows.forEach(async (row) => {
    try {
      redis.HSET(`tradecount:utc:${row.chainid}`, row.market, row.trades || 0)
    } catch (err) {
      console.error(err)
      console.log('Could not update tradecount')
    }
  })

  const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString()
  const query = {
    text: "SELECT chainid, market, count(*) as trades FROM fills WHERE fill_status IN ('f', 'pf') AND insert_timestamp > $1 AND chainid IS NOT NULL GROUP BY (chainid, market)",
    values: [oneDayAgo],
  }
  const select = await db.query(query)
  select.rows.forEach(async (row) => {
    try {
      redis.HSET(`tradecount:${row.chainid}`, row.market, row.trades || 0)
    } catch (err) {
      console.error(err)
      console.log('Could not update tradecount')
    }
  })

  console.timeEnd('updateNumberOfTrades')
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
    const redisNumberOfTrades = await redis.HGETALL(`tradecount:${chainId}`)
    const redisNumberOfTradesUTC = await redis.HGETALL(
      `tradecount:utc:${chainId}`
    )

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

      const numberOfTrades_24h = Number(redisNumberOfTrades[marketId] || 0)
      const numberOfTrades_24hUTC = Number(
        redisNumberOfTradesUTC[marketId] || 0
      )

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
        numberOfTrades_24h,
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
        numberOfTrades_24h: numberOfTrades_24hUTC,
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

async function runDbMigration() {
  console.log('running db migration')
  const migration = fs.readFileSync('schema.sql', 'utf8')
  await db.query(migration).catch(console.error)
}

async function cacheTradeData() {
  const BUCKET_COUNT = 250 // used to set the precission of the data
  console.time('cacheTradeData')
  try {
    const endTime = (Date.now() / 1000) | 0
    const intervals = [
      {
        days: 1,
        seconds: 86400,
      },
      {
        days: 7,
        seconds: 604800,
      },
      {
        days: 31,
        seconds: 2678400,
      },
    ]

    const SQLTime =
      Date.now() -
      intervals.reduce((max, i) => Math.max(max, i.seconds), 0) * 1000
    const SQLFetchStart = new Date(SQLTime).toISOString()
    const text =
      "SELECT chainid,market,price,amount,insert_timestamp FROM fills WHERE fill_status='f' AND insert_timestamp > $1;"
    const query = {
      text,
      values: [SQLFetchStart],
    }
    const select = await db.query(query)

    const results0: Promise<any>[] = VALID_CHAINS.map(async (chainId) => {
      const tradesThisChain = select.rows.filter((o) => o.chainid === chainId)
      const markets = await redis.SMEMBERS(`activemarkets:${chainId}`)
      markets.forEach((marketId) => {
        const parsedTrades = tradesThisChain
          .filter((o) => o.market === marketId)
          .map((o) => ({
            time: (Number(o.insert_timestamp) / 1000) | 0,
            price: o.price,
            amount: o.amount,
          }))

        intervals.forEach((interval: { days: number; seconds: number }) => {
          const redisTradeDataKey = `tradedata:${chainId}:${interval.days}`

          const startTime = endTime - interval.seconds
          const stepTime = interval.seconds / BUCKET_COUNT

          const tradeData: [
            number, // unix
            number, // average
            number, // open
            number, // high
            number, // low
            number, // close
            number // volume
          ][] = []
          if (parsedTrades.length === 0) {
            redis.HSET(redisTradeDataKey, marketId, JSON.stringify(tradeData))
            return
          }
          for (let i = 0; i < BUCKET_COUNT; i++) {
            const bucketStart = startTime + i * stepTime
            const bucketEnd = bucketStart + stepTime

            const bucketTrades = parsedTrades.filter(
              (trade) => trade.time > bucketStart && trade.time < bucketEnd
            )
            if (bucketTrades.length > 0) {
              const bucketVolume = bucketTrades.reduce(
                (sum, trade) => sum + trade.amount,
                0
              )
              const bucketAverage =
                bucketTrades.reduce((sum, trade) => sum + trade.price, 0) /
                bucketTrades.length
              const bucketHigh = bucketTrades.reduce(
                (max, trade) => Math.max(max, trade.price),
                0
              )
              const bucketLow = bucketTrades.reduce(
                (min, trade) => Math.min(min, trade.price),
                Number.MAX_SAFE_INTEGER
              )

              tradeData.push([
                bucketStart | 0,
                bucketAverage,
                bucketTrades[0].price,
                bucketHigh,
                bucketLow,
                bucketTrades[bucketTrades.length - 1].price,
                bucketVolume,
              ])
            } else {
              tradeData.push([bucketStart | 0, 0, 0, 0, 0, 0, 0])
            }
          }
          redis.HSET(redisTradeDataKey, marketId, JSON.stringify(tradeData))
        })
      })
    })
    await Promise.all(results0)
  } catch (e: any) {
    console.error(`Failed to cacheTradeData: ${e}`)
  }

  console.timeEnd('cacheTradeData')
}

async function cacheGameMsg(chainId: number, market: string, msg: string) {
  const cache = async (key: string) => {
    await redis.LPUSH(key, msg)
    await redis.LTRIM(key, 0, 50)
  }
  await Promise.all([
    cache(`swap_event:${chainId}:${market}`),
    cache(`swap_event:${-1}:${market}`),
    cache(`swap_event:${chainId}:all`),
    cache(`swap_event:${-1}:all`),
  ])
}

async function handleSwapEvent(
  chainId: number,
  maker: string,
  taker: string,
  makerSellToken: string,
  takerSellToken: string,
  makerSellAmount: ethers.BigNumber,
  takerSellAmount: ethers.BigNumber,
  makerVolumeFee: ethers.BigNumber,
  takerVolumeFee: ethers.BigNumber,
  blockData: any
) {
  const { hash } = await blockData.getTransaction()
  const { timestamp } = await blockData.getBlock()
  console.log(`New swap on ${chainId}: ${hash}`)
  const [
    takerBuyAmountFormatted,
    takerSellAmountFormatted,
    makerFeeFormatted,
    takerFeeFormatted,
  ] = await Promise.all([
    formatTokenAmount(chainId, makerSellToken, makerSellAmount),
    formatTokenAmount(chainId, takerSellToken, takerSellAmount),
    formatTokenAmount(chainId, takerSellToken, makerVolumeFee),
    formatTokenAmount(chainId, makerSellToken, takerVolumeFee),
  ])

  const market = sortMarketPair(makerSellToken, takerSellToken)
  const text =
    'INSERT INTO past_orders_V3 (txhash, chainid, market, taker_address, maker_address, taker_buy_token, taker_sell_token, taker_buy_amount, taker_sell_amount, maker_fee, taker_fee, txtime) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);'
  const values = [
    hash,
    chainId,
    market,
    taker,
    maker,
    makerSellToken,
    takerSellToken,
    takerBuyAmountFormatted,
    takerSellAmountFormatted,
    makerFeeFormatted,
    takerFeeFormatted,
    new Date(timestamp * 1000),
  ]

  await db.query({ text, values })

  const msg: ZZPastOrder = {
    chainId,
    taker,
    maker,
    makerSellToken,
    takerSellToken,
    takerBuyAmount: takerBuyAmountFormatted,
    takerSellAmount: takerSellAmountFormatted,
    makerFee: makerFeeFormatted,
    takerFee: takerFeeFormatted,
    transactionHash: hash,
    transactionTime: timestamp,
  }
  const msgString = JSON.stringify(msg)
  cacheGameMsg(chainId, market, msgString)
  publisher.PUBLISH(
    `broadcastmsg:swap_event:${chainId}:${market}`,
    JSON.stringify({ op: 'swap_event', args: [msg] })
  )
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
    fs.readFileSync('abi/EVM_Exchange.json', 'utf8')
  )

  // connect infura providers
  const operatorKeysString = process.env.OPERATOR_KEY as any
  if (!operatorKeysString && VALID_EVM_CHAINS.length)
    throw new Error("MISSING ENV VAR 'OPERATOR_KEY'")
  const operatorKeys = JSON.parse(operatorKeysString)
  const results: Promise<any>[] = VALID_CHAINS.map(async (chainId: number) => {
    if (ETHERS_PROVIDERS[chainId]) return
    try {
      ETHERS_PROVIDERS[chainId] = new ethers.providers.JsonRpcProvider(
        getRPCURL(chainId)
      )
      console.log(`Connected JsonRpcProvider for ${chainId}`)
    } catch (e: any) {
      console.warn(
        `Could not connect JsonRpcProvider for ${chainId}, trying Infura...`
      )
      ETHERS_PROVIDERS[chainId] = new ethers.providers.InfuraProvider(
        getNetwork(chainId),
        process.env.INFURA_PROJECT_ID
      )
      console.log(`Connected InfuraProvider for ${chainId}`)
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
        const filter = EXCHANGE_CONTRACTS[chainId].filters.Swap()
        EXCHANGE_CONTRACTS[chainId].on(
          filter,
          (
            maker: string,
            taker: string,
            makerSellToken: string,
            takerSellToken: string,
            makerSellAmount: ethers.BigNumber,
            takerSellAmount: ethers.BigNumber,
            makerVolumeFee: ethers.BigNumber,
            takerVolumeFee: ethers.BigNumber,
            blockData: any
          ) => {
            handleSwapEvent(
              chainId,
              maker,
              taker,
              makerSellToken,
              takerSellToken,
              makerSellAmount,
              takerSellAmount,
              makerVolumeFee,
              takerVolumeFee,
              blockData
            )
          }
        )
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

  console.log('background.ts: Starting Update Functions')
  setInterval(updateBestAskBidEVM, 5000)
  setInterval(updatePendingOrders, updatePendingOrdersDelay * 1000)
  setInterval(cacheRecentTrades, 60000)
  setInterval(removeOldLiquidity, 10000)
  setInterval(updateLastPrices, 15000)
  setInterval(updateMarketSummarys, 15000)
  setInterval(updateUsdPrice, 20000)
  setInterval(updateFeesZkSync, 25000)
  setInterval(updatePriceHighLow, 30000)
  setInterval(updateVolumes, 30000)
  setInterval(updateNumberOfTrades, 30000)
  setInterval(cacheTradeData, 30000)
  setInterval(deleteOldOrders, 30000)

  setTimeout(sendMatchedOrders, 5000)
}

start()
