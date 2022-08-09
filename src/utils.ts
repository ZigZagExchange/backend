import * as starknet from 'starknet'
import { ethers } from 'ethers'
import { randomBytes } from 'crypto'

export function formatPrice (input: any) {
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


export function stringToFelt (text: string) {
  const bufferText = Buffer.from(text, 'utf8')
  const hexString = `0x${bufferText.toString('hex')}`
  return starknet.number.toFelt(hexString)
}

export function getNetwork (chainId: number) {
  switch(chainId) {
    case 1: return "mainnet"
    case 1000: case 1001: return "goerli"
    case 42161: return "arbitrum"
    default: throw new Error('No valid chainId')
  }
}

export const evmEIP712Types = {
  "Order": [
    { "name": 'user', "type": 'address' },
    { "name": 'sellToken', "type": 'address' },
    { "name": 'buyToken', "type": 'address' },
    { "name": 'feeRecipientAddress', "type": 'address' },
    { "name": 'relayerAddress', "type": 'address' },
    { "name": 'sellAmount', "type": 'uint256' },
    { "name": 'buyAmount', "type": 'uint256' },
    { "name": 'makerVolumeFee', "type": 'uint256' },
    { "name": 'takerVolumeFee', "type": 'uint256' },
    { "name": 'gasFee', "type": 'uint256' },
    { "name": 'expirationTimeSeconds', "type": 'uint256' },
    { "name": 'salt', "type": 'uint256' }
  ]
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
  const contract = new ethers.Contract(
    contractAddress,
    abi,
    provider
  )
  tokenInfos.decimals = await contract.decimals()
  tokenInfos.name = await contract.name()
  tokenInfos.symbol = await contract.symbol()
  tokenInfos.address = contractAddress
  return tokenInfos
}

export function getNewToken() {
  return randomBytes(64).toString('hex')
}
