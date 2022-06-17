import { ethers } from 'ethers'
import type { ZZMarket, ZZOrder, ZZMarketInfo, AnyObject } from '../types'

import ArbitrumProvider from './arbitrumProvider'

export default class Provider {
  INFURA_PROVIDER: AnyObject = {}
  NETWORK_PROVIDER: AnyObject = {}

  constructor() {
    this.INFURA_PROVIDER = new ethers.providers.InfuraProvider(
      'mainnet',
      process.env.INFURA_PROJECT_ID
    )

    this.NETWORK_PROVIDER[42161] = new ArbitrumProvider(42161)
  }

  relayMatch = async (
    chainId: number,
    market: ZZMarket,
    buyer: ZZOrder,
    seller: ZZOrder,
    fillQuantity: number,
    fillPrice: number,
    fillId: number,
    makerOfferId: number,
    takerOfferId: number
  ) => {
    const networkProvider = this.NETWORK_PROVIDER[chainId]
    if (!networkProvider) throw new Error('Only for EVM style orders')

    networkProvider.sendMatch(
      market,
      buyer,
      seller,
      fillQuantity,
      fillPrice,
      fillId,
      makerOfferId,
      takerOfferId
    )
  }
}
