import * as starknet from 'starknet'
import {
  OX_ERC20_ASSET_PROXY_ID
} from 'src/constants'




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
    case 1000: return "rinkeby"
    case 1001: return "goerli"
    default: throw new Error('No valid chainId')
  }
}
