// eslint-disable-next-line import/no-extraneous-dependencies
import { ethers } from 'ethers'
import { Order } from './types'

export async function signOrder(
  privateKey: string,
  order: Order,
  exchangeAddress: string
) {
  const provider = ethers.getDefaultProvider()
  const wallet = new ethers.Wallet(privateKey, provider)

  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Order: [
        { name: 'user', type: 'address' },
        { name: 'sellToken', type: 'address' },
        { name: 'buyToken', type: 'address' },
        { name: 'sellAmount', type: 'uint256' },
        { name: 'buyAmount', type: 'uint256' },
        { name: 'expirationTimeSeconds', type: 'uint256' },
      ],
    },
    primaryType: 'Order',
    domain: {
      name: 'ZigZag',
      version: '2.1',
      chainId: '31337', // test hardhat default
      verifyingContract: exchangeAddress,
    },
    message: {
      user: order.user,
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      expirationTimeSeconds: order.expirationTimeSeconds,
    },
  }

  // eslint-disable-next-line no-underscore-dangle
  const signature = await wallet._signTypedData(
    typedData.domain,
    { Order: typedData.types.Order },
    typedData.message
  )

  return signature
}

export async function signCancelOrder(
  privateKey: string,
  order: Order,
  exchangeAddress: string
) {
  const provider = ethers.getDefaultProvider()
  const wallet = new ethers.Wallet(privateKey, provider)

  const types = {
    Order: [
      { name: 'user', type: 'address' },
      { name: 'sellToken', type: 'address' },
      { name: 'buyToken', type: 'address' },
      { name: 'sellAmount', type: 'uint256' },
      { name: 'buyAmount', type: 'uint256' },
      { name: 'expirationTimeSeconds', type: 'uint256' },
    ],
    CancelOrder: [
      { name: 'orderHash', type: 'bytes32' },
    ]
  }
  const domain = {
    name: 'ZigZag',
    version: '2.1',
    chainId: '31337', // test hardhat default
    verifyingContract: exchangeAddress,
  }
  const orderMessage = {
    user: order.user,
    sellToken: order.sellToken,
    buyToken: order.buyToken,
    sellAmount: order.sellAmount,
    buyAmount: order.buyAmount,
    expirationTimeSeconds: order.expirationTimeSeconds,
  }

  const orderHash = ethers.utils._TypedDataEncoder.from({ Order: types.Order }).hash(orderMessage);

  const cancelOrderMessage = {
    orderHash
  }

  // eslint-disable-next-line no-underscore-dangle
  const signature = await wallet._signTypedData(
    domain,
    { CancelOrder: types.CancelOrder },
    cancelOrderMessage
  )

  return signature
}
