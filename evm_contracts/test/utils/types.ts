import { BigNumber } from 'ethers'

export interface Order {
  user: string
  sellToken: string
  buyToken: string
  sellAmount: BigNumber
  buyAmount: BigNumber
  expirationTimeSeconds: BigNumber
}
