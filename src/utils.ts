import * as starknet from 'starknet'
import { ethers } from 'ethers'
import { randomBytes } from 'crypto'
import fetch from 'isomorphic-fetch'
import fs from 'fs'

import type { AnyObject, ZZMarketInfo } from './types'

const ERC20_ABI = JSON.parse(fs.readFileSync('abi/ERC20.abi', 'utf8'))

const ZKSYNC_BASE_URL: AnyObject = {
  mainnet: 'https://api.zksync.io/api/v0.2/',
  goerli: 'https://goerli-api.zksync.io/api/v0.2/',
}

export function formatPrice(input: any) {
  const inputNumber = Number(input)
  if (inputNumber > 99999) {
    return inputNumber.toFixed(0)
  }
  if (inputNumber > 9999) {
    return inputNumber.toFixed(1)
  }
  if (inputNumber > 999) {
    return inputNumber.toFixed(2)
  }
  if (inputNumber > 99) {
    return inputNumber.toFixed(3)
  }
  if (inputNumber > 9) {
    return inputNumber.toFixed(4)
  }
  if (inputNumber > 1) {
    return inputNumber.toFixed(5)
  }
  return inputNumber.toPrecision(6)
}

export function stringToFelt(text: string) {
  const bufferText = Buffer.from(text, 'utf8')
  const hexString = `0x${bufferText.toString('hex')}`
  return starknet.number.toFelt(hexString)
}

export function getNetwork(chainId: number) {
  switch (chainId) {
    case 1:
      return 'mainnet'
    case 1002:
    case 1001:
      return 'goerli'
    case 42161:
      return 'arbitrum'
    default:
      throw new Error('No valid chainId')
  }
}

export function getRPCURL(chainId: number) {
  switch (chainId) {
    case 42161:
      return 'https://arb1.arbitrum.io/rpc'
    case 421613:
      return 'https://goerli-rollup.arbitrum.io/rpc'
    default:
      throw new Error('No valid chainId')
  }
}

export const evmEIP712Types = {
  Order: [
    { name: 'user', type: 'address' },
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'feeRecipientAddress', type: 'address' },
    { name: 'relayerAddress', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'makerVolumeFee', type: 'uint256' },
    { name: 'takerVolumeFee', type: 'uint256' },
    { name: 'gasFee', type: 'uint256' },
    { name: 'expirationTimeSeconds', type: 'uint256' },
    { name: 'salt', type: 'uint256' },
  ],
}

/**
 * Get the full token name from L1 ERC20 contract
 * @param provider
 * @param contractAddress
 * @param abi
 * @returns tokenInfos
 */
export async function getERC20Info(
  provider: any,
  contractAddress: string,
  abi: any
) {
  const tokenInfos: any = {}
  const contract = new ethers.Contract(contractAddress, abi, provider)
  tokenInfos.decimals = await contract.decimals()
  tokenInfos.name = await contract.name()
  tokenInfos.symbol = await contract.symbol()
  tokenInfos.address = contractAddress
  return tokenInfos
}

export async function getTokenInfosZkSync(
  chainId: number,
  provider: any
): Promise<AnyObject> {
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
            const contract = new ethers.Contract(address, ERC20_ABI, provider)
            tokenInfo.name = await contract.name()
          } catch (e: any) {
            console.warn(e.message)
            tokenInfo.name = tokenInfo.address
          }
          updatedTokenInfo[symbol] = tokenInfo
        }
      }
    )
    await Promise.all(results1)
    index = tokenInfoResults[tokenInfoResults.length - 1].id
  } while (tokenInfoResults.length > 99)

  return updatedTokenInfo
}

export async function getTokenInfosEVM(
  chainId: number,
  provider: any
): Promise<AnyObject> {
  // some networks (testnets) are not supported
  let coingeckoNetworkKey: string
  switch (chainId) {
    case 42161:
      coingeckoNetworkKey = 'arbitrum-one'
      break
    default:
      return {}
  }

  const updatedTokenInfo: AnyObject = {
    ETH: {
      id: ethers.constants.AddressZero,
      address: ethers.constants.AddressZero,
      symbol: 'ETH',
      decimals: 18,
      enabledForFees: true,
      usdPrice: '1910.20',
      name: 'Ethereum',
    },
  }

  const tokens: AnyObject[] = await fetch(
    'https://api.coingecko.com/api/v3/coins/list?include_platform=true'
  ).then((r: any) => r.json())

  const updatedTokenInfoResult: Promise<any>[] = tokens.map(
    async (tokenData: AnyObject) => {
      const address = tokenData.platforms[coingeckoNetworkKey]
      if (!address) return

      const contract = new ethers.Contract(address, ERC20_ABI, provider)
      const decimals = await contract.decimals()

      updatedTokenInfo[tokenData.symbol] = {
        id: address,
        address,
        symbol: tokenData.symbol,
        decimals,
        enabledForFees: true,
        usdPrice: '1',
        name: tokenData.name,
      }
    }
  )

  await Promise.all(updatedTokenInfoResult)
  return updatedTokenInfo
}

export async function getTokenInfos(
  chainId: number,
  provider: any
): Promise<AnyObject> {
  switch (chainId) {
    case 1:
    case 1002:
      return getTokenInfosZkSync(chainId, provider)
    case 42161:
    case 421613:
      return getTokenInfosEVM(chainId, provider)
    default:
      return {}
  }
}

export function getNewToken() {
  return randomBytes(64).toString('hex')
}

export function getFeeEstimationMarket(chainId: number) {
  switch (chainId) {
    case 42161:
      return 'USDC-USDT'
    case 421613:
      return 'DAI-USDC'
    default:
      throw new Error('No valid chainId')
  }
}

export async function getFeeEstimationOrder(
  chainId: number,
  marketInfo: ZZMarketInfo,
  wallet: AnyObject,
  side: string
) {
  const baseAmount = 1
  const quoteAmount = 1

  const baseAmountBN = ethers.utils.parseUnits(
    Number(baseAmount).toFixed(marketInfo.baseAsset.decimals),
    marketInfo.baseAsset.decimals
  )
  const quoteAmountBN = ethers.utils.parseUnits(
    Number(quoteAmount).toFixed(marketInfo.quoteAsset.decimals),
    marketInfo.quoteAsset.decimals
  )

  let sellToken: string
  let buyToken: string
  let sellAmountBN: ethers.BigNumber
  let buyAmountBN: ethers.BigNumber
  let gasFeeBN: ethers.BigNumber
  if (side === 's') {
    sellToken = marketInfo.baseAsset.address
    buyToken = marketInfo.quoteAsset.address
    sellAmountBN = baseAmountBN
    buyAmountBN = quoteAmountBN.mul(99999).div(100000)
    gasFeeBN = ethers.utils.parseUnits('1', marketInfo.baseAsset.decimals)
  } else {
    sellToken = marketInfo.quoteAsset.address
    buyToken = marketInfo.baseAsset.address
    sellAmountBN = quoteAmountBN
    buyAmountBN = baseAmountBN.mul(99999).div(100000)
    gasFeeBN = ethers.utils.parseUnits('1', marketInfo.quoteAsset.decimals)
  }

  const makerVolumeFeeBN = sellAmountBN
    .mul(marketInfo.makerVolumeFee * 10000)
    .div(9999)
  const takerVolumeFeeBN = sellAmountBN
    .mul(marketInfo.takerVolumeFee * 10000)
    .div(9999)

  const userAccount = await wallet.getAddress()
  const expirationTimeSeconds = Math.floor(Date.now() / 1000 + 5 * 2)
  let domain: AnyObject = {}
  let Order: AnyObject = {}
  let types: AnyObject = {}
  if (Number(marketInfo.contractVersion) === 5) {
    Order = {
      user: userAccount,
      sellToken,
      buyToken,
      feeRecipientAddress: marketInfo.feeAddress,
      relayerAddress: marketInfo.relayerAddress,
      sellAmount: sellAmountBN.toString(),
      buyAmount: buyAmountBN.toString(),
      makerVolumeFee: makerVolumeFeeBN.toString(),
      takerVolumeFee: takerVolumeFeeBN.toString(),
      gasFee: gasFeeBN.toString(),
      expirationTimeSeconds: expirationTimeSeconds.toFixed(0),
      salt: (Math.random() * 123456789).toFixed(0),
    }

    domain = {
      name: 'ZigZag',
      version: '5',
      chainId,
    }

    types = {
      Order: [
        { name: 'user', type: 'address' },
        { name: 'sellToken', type: 'address' },
        { name: 'buyToken', type: 'address' },
        { name: 'feeRecipientAddress', type: 'address' },
        { name: 'relayerAddress', type: 'address' },
        { name: 'sellAmount', type: 'uint256' },
        { name: 'buyAmount', type: 'uint256' },
        { name: 'makerVolumeFee', type: 'uint256' },
        { name: 'takerVolumeFee', type: 'uint256' },
        { name: 'gasFee', type: 'uint256' },
        { name: 'expirationTimeSeconds', type: 'uint256' },
        { name: 'salt', type: 'uint256' },
      ],
    }
  }

  // eslint-disable-next-line no-underscore-dangle
  const signature = await wallet._signTypedData(domain, types, Order)
  Order.signature = signature
  return Order
}
