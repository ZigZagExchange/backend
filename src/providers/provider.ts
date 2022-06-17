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

  validateOrder = async (
    chainId: number,
    zktx: ZZOrder,
    marketInfo: ZZMarketInfo
  ) => {
    const networkProvider = this.NETWORK_PROVIDER[chainId]
    const networkProviderConfig = networkProvider.CONFIG
    if (!networkProvider || Object.keys(networkProviderConfig).length === 0)
      throw new Error('Only for EVM style orders')

    const assets = [marketInfo.baseAsset.address, marketInfo.quoteAsset.address]

    /* validate order */
    if (!ethers.utils.isAddress(zktx.makerAddress))
      throw new Error('Bad userAddress')

    if (!assets.includes(zktx.makerToken))
      throw new Error(
        `Bad makerToken, market ${assets} does not include ${zktx.makerToken}`
      )

    if (!assets.includes(zktx.takerToken))
      throw new Error(
        `Bad takerToken, market ${assets} does not include ${zktx.takerToken}`
      )

    if (zktx.makerToken === zktx.takerToken)
      throw new Error(`Can't buy and sell the same token`)

    const expiry = Number(zktx.expirationTimeSeconds) * 1000
    if (expiry < Date.now() + 60000)
      throw new Error('Expiery time too low. Use at least NOW + 60sec')

    const side = marketInfo.baseAsset.address === zktx.makerToken ? 's' : 'b'
    let baseAssetBN
    let quoteAssetBN
    if (side === 's') {
      baseAssetBN = ethers.BigNumber.from(zktx.makerAssetAmount)
      quoteAssetBN = ethers.BigNumber.from(zktx.takerAssetAmount)

      const gasFee = ethers.utils.parseUnits(
        zktx.gasFee,
        marketInfo.base.decimals
      )
      if (gasFee < marketInfo.baseFee)
        throw new Error(
          `Bad gasFee, minimum is ${marketInfo.baseFee}${marketInfo.base.symbol}`
        )
    } else {
      baseAssetBN = ethers.BigNumber.from(zktx.takerAssetAmount)
      quoteAssetBN = ethers.BigNumber.from(zktx.makerAssetAmount)

      const gasFee = ethers.utils.parseUnits(
        zktx.gasFee,
        marketInfo.quote.decimals
      )
      if (gasFee < marketInfo.quoteFee)
        throw new Error(
          `Bad gasFee, minimum is ${marketInfo.quoteFee}${marketInfo.quote.symbol}`
        )
    }

    // check fees
    if (zktx.feeRecipientAddress !== networkProviderConfig.feeAddress)
      throw new Error(
        `Bad feeRecipientAddress, use '${networkProviderConfig.feeAddress}'`
      )

    if (Number(zktx.makerVolumeFee) < networkProviderConfig.minMakerVolumeFee)
      throw new Error(
        `Bad makerVolumeFee, minimum is ${networkProviderConfig.minMakerVolumeFee}`
      )

    if (Number(zktx.takerVolumeFee) < networkProviderConfig.minTakerVolumeFee)
      throw new Error(
        `Bad takerVolumeFee, minimum is ${networkProviderConfig.minTakerVolumeFee}`
      )

    /* validateSignature */
    const valid = await networkProvider.validateSignature(zktx)
    if (!valid) throw new Error('Order signature incorrect')

    const baseAmount = baseAssetBN
      .div(10 ** marketInfo.baseAsset.decimals)
      .toNumber()
    const quoteAmount = quoteAssetBN
      .div(10 ** marketInfo.quoteAsset.decimals)
      .toNumber()
    const price = quoteAmount / baseAmount

    return [side, price, baseAmount, quoteAmount]
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
