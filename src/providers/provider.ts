import { ethers } from 'ethers'
import type { 
  ZZMarket,
  ZZOrder,
  ZZMarketInfo,
  AnyObject
} from '../types'

import ArbitrumProvider from './arbitrumProvider'

export default class Provider {
  providers: AnyObject = {}

  constructor() {
    this.providers[42161] = new ArbitrumProvider()
  }

  validateOrder = async (
    chainId: number,
    zktx: ZZOrder,
    marketInfo: ZZMarketInfo
  ) => {
    const networkProvider = this.providers[chainId]
    if (!networkProvider) throw new Error('Only for EVM style orders')

    const assets = [marketInfo.baseAsset.address, marketInfo.quoteAsset.address]

    /* validate order */
    if (!ethers.utils.isAddress(zktx.userAddress))
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
    } else {
      baseAssetBN = ethers.BigNumber.from(zktx.takerAssetAmount)
      quoteAssetBN = ethers.BigNumber.from(zktx.makerAssetAmount)
    }

    // check fees
    if (zktx.feeRecipientAddress !== networkProvider.feeAddress)
      throw new Error(
        `Bad feeRecipientAddress, use '${networkProvider.feeAddress}'`
      )
    if (zktx.feeToken !== networkProvider.feeToken)
      throw new Error(`Bad makerFeeAssetData, use the same as makerAssetData`)
    if (zktx.feeToken !== networkProvider.feeToken)
      throw new Error(`Bad takerFeeAssetData, use the same as makerAssetData`)
    const orderMakerFeeAmountBN = ethers.BigNumber.from(zktx.makerFee)
    const orderTakerFeeAmountBN = ethers.BigNumber.from(zktx.takerFee)
    const makerFeeBN = baseAssetBN.div(1 / networkProvider.makerFee)
    const takerFeeBN = baseAssetBN.div(1 / networkProvider.takerFee)
    if (orderMakerFeeAmountBN.lt(makerFeeBN))
      throw new Error(`Bad makerFee, minimum is ${networkProvider.makerFee}`)
    if (orderTakerFeeAmountBN.lt(takerFeeBN))
      throw new Error(`Bad takerFee, minimum is ${networkProvider.takerFee}`)

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
    buyer: any,
    seller: any,
    fillQuantity: number,
    fillPrice: number,
    fillId: number,
    makerOfferId: number,
    takerOfferId: number
  ) => {
    const networkProvider = this.providers[chainId]
    if (!networkProvider) throw new Error('Only for EVM style orders')

    networkProvider.relayMatch(
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
