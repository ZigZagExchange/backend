import * as starknet from 'starknet'
import { ethers } from 'ethers'
import { randomBytes } from 'crypto'
import type { AnyObject, ZZMarketInfo, ZZOrder } from './types'

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

export function getEvmEIP712Types(chainId: number) {
  if ([42161, 421613].includes(chainId)) {
    return {
      Order: [
        { name: 'user', type: 'address' },
        { name: 'sellToken', type: 'address' },
        { name: 'buyToken', type: 'address' },
        { name: 'sellAmount', type: 'uint256' },
        { name: 'buyAmount', type: 'uint256' },
        { name: 'expirationTimeSeconds', type: 'uint256' },
      ],
    }
  }
  return null
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

export function getReadableTxError(errorMsg: string): string {
  if (errorMsg.includes('not profitable spread')) return 'Internal error: ps'

  if (errorMsg.includes('taker order not enough balance'))
    return 'taker order not enough balance'

  if (errorMsg.includes('maker order not enough balance'))
    return 'maker order not enough balance'

  if (errorMsg.includes('invalid taker signature'))
    return 'invalid taker signature'

  if (errorMsg.includes('invalid maker signature'))
    return 'invalid maker signature'

  if (errorMsg.includes('mismatched tokens')) return 'mismatched tokens'

  if (errorMsg.includes('taker order status not Fillable'))
    return 'taker order status not Fillable'

  if (errorMsg.includes('maker order status not Fillable'))
    return 'maker order status not Fillable'

  if (errorMsg.includes('taker order not enough balance for fee'))
    return 'taker order not enough balance for fee'

  if (errorMsg.includes('maker order not enough balance for fee'))
    return 'maker order not enough balance for fee'

  if (errorMsg.includes('invalid maker asset amount'))
    return 'invalid maker asset amount'

  if (errorMsg.includes('invalid taker asset amount'))
    return 'invalid taker asset amount'

  if (errorMsg.includes('order is filled')) return 'order is filled'

  if (errorMsg.includes('order expired')) return 'order expired'

  if (errorMsg.includes('order canceled')) return 'order canceled'

  return 'Internal error: A'
}
