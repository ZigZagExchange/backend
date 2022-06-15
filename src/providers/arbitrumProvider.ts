import { ethers } from 'ethers'
import fs from 'fs'

// eslint-disable-next-line import/no-cycle
import type { ZZOrder } from '../types'
import Provider from './provider'

export default class ArbitrumProvider extends Provider {
  exchangeAddress = '0xaed91038da9121808a95d9de04530c58f0c1a7e8'
  feeAddress = 'test'
  makerFee = 0.05
  takerFee = 0.001
  feeToken = 'ETH'

  EXCHANGE: any = {}
  ETHERS_PROVIDER: any = {}

  constructor() {
    super()
    const  exchnageABI = JSON.parse(
      fs.readFileSync('abi/EVM_Exchange.abi', 'utf8')
    )
    this.ETHERS_PROVIDER = new ethers.providers.InfuraProvider("mainnet", process.env.INFURA_PROJECT_ID,)
    this.EXCHANGE = new ethers.Contract(
        this.exchangeAddress,
        exchnageABI,
        this.ETHERS_PROVIDER
      )    
  }

  validateSignature = async (zktx: ZZOrder): Promise<boolean> => {
    // send order
    const orderArray = Object.values(zktx)
    return this.EXCHANGE.isValidSignature (
        orderArray.splice(0, -1),
        orderArray.at(-1)
    )
  }
}
