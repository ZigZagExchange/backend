/* eslint-disable import/no-extraneous-dependencies */
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, Wallet } from 'ethers'
import { TESTRPC_PRIVATE_KEYS_STRINGS } from './utils/PrivateKeyList'
import { signOrder, getOrderHash } from './utils/SignUtil'
import { Order } from './utils/types'

describe('Signature Validation', () => {
  let exchangeContract: Contract
  let wallet: Wallet
  let order: Order

  beforeEach(async function _ () {
    this.timeout(30000)

    const Exchange = await ethers.getContractFactory('ZigZagExchange')
    exchangeContract = await Exchange.deploy(
      'ZigZag',
      '2.1',
      ethers.constants.AddressZero
    )

    wallet = new ethers.Wallet(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      ethers.provider
    )

    order = {
      user: wallet.address,
      sellToken: '0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed',
      buyToken: '0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed',
      sellAmount: ethers.BigNumber.from('12'),
      buyAmount: ethers.BigNumber.from('13'),
      expirationTimeSeconds: ethers.BigNumber.from('0'),
    }    
  })

  it('Should validate order signature', async () => {
    const signedMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      order,
      exchangeContract.address
    )

    expect(
      await exchangeContract.isValidOrderSignature(
        Object.values(order),
        signedMessage
      )
    ).to.equal(true)
  })

  it("Shouldn't validate order signature with different Private Key", async () => {
    const incorrenctlySignedMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[1],
      order,
      exchangeContract.address
    )
    expect(
      await exchangeContract.isValidOrderSignature(
        Object.values(order),
        incorrenctlySignedMessage
      )
    ).to.equal(false)
  })

  it("Should emit event cancel order", async () => {
    const orderHash = await getOrderHash(order, exchangeContract.address)

    expect(await exchangeContract.connect(wallet).cancelOrder(
      Object.values(order)
    )).to.emit(exchangeContract, 'CancelOrder')
      .withArgs(orderHash)
  })

})
