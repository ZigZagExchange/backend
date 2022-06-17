import { ethers } from 'ethers'
import fs from 'fs'
import EVMConfig from '../EVMConfig.json'

import type { ZZOrder } from '../types'
// eslint-disable-next-line import/no-cycle
import Provider from './provider'

export default class ArbitrumProvider extends Provider {
  EXCHANGE: any = {}
  CONFIG: any = {}

  constructor(chainId: number) {
    super()
    const exchnageABI = JSON.parse(
      fs.readFileSync('abi/EVM_Exchange.abi', 'utf8')
    )

    const infuraProvider =
      chainId === 42161
        ? super.INFURA_PROVIDER.rinkeby
        : super.INFURA_PROVIDER.rinkeby

    const chainString = chainId === 42161 ? 'arbitrum' : 'arbitrumTest'

    this.CONFIG = EVMConfig[chainString]
    this.EXCHANGE = new ethers.Contract(
      this.CONFIG.exchangeAddress,
      exchnageABI,
      infuraProvider
    )

    const wallet = new ethers.Wallet(
      process.env.OPERATOR_KEY as string,
      infuraProvider
    )

    this.EXCHANGE.connect(wallet)
  }

  validateSignature = async (zktx: ZZOrder): Promise<boolean> => {
    const orderArray = Object.values(zktx)
    return this.EXCHANGE.isValidSignature(
      orderArray.splice(0, -1),
      orderArray.at(-1)
    )
  }

  sendMatch = async (makerOrder: ZZOrder, takerOrder: ZZOrder) => {
    const makerOrderArray = Object.values(makerOrder)
    const takerOrderArray = Object.values(takerOrder)
    await this.EXCHANGE.matchOrders(
      takerOrderArray.splice(0, -1),
      makerOrderArray.splice(0, -1),
      takerOrderArray.at(-1),
      makerOrderArray.at(-1)
    )
  }
}
