import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, Wallet } from 'ethers'
import { TESTRPC_PRIVATE_KEYS_STRINGS } from './utils/PrivateKeyList'
import { signOrder, signCancelOrder, getOrderHash } from './utils/SignUtil'

describe('fillOrderExactInput', () => {
  let exchangeContract: Contract
  let tokenA: Contract
  let tokenB: Contract
  const wallets: Wallet[] = []

  beforeEach(async function () {
    this.timeout(30000)
    const Exchange = await ethers.getContractFactory('ZigZagExchange')
    const Token = await ethers.getContractFactory('Token')
    const { provider } = ethers

    tokenA = await Token.deploy()
    tokenB = await Token.deploy()
    const [owner] = await ethers.getSigners()

    for (let i = 0; i < 4; i++) {
      wallets[i] = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[i], provider)

      await owner.sendTransaction({
        to: wallets[i].address,
        value: ethers.utils.parseEther('0.1') // 0.1 ether
      })
    }

    exchangeContract = await Exchange.deploy(
      'ZigZag',
      '2.1',
      ethers.constants.AddressZero
    )

    await tokenA.mint(ethers.utils.parseEther('1000'), wallets[0].address)
    await tokenB.mint(ethers.utils.parseEther('1000'), wallets[1].address)
    await tokenA
      .connect(wallets[0])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenB
      .connect(wallets[1])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))

  })

  it("Should revert with 'maker order not enough balance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('20000'),
      buyAmount: ethers.utils.parseEther('1'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }
    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('1')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('maker order not enough balance')
  })

  it("Should revert with 'taker order not enough balance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('1'),
      buyAmount: ethers.utils.parseEther('15000'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }
    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('15000')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('taker order not enough balance')
  })

  it("Should revert with 'maker order not enough allowance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    await tokenA.connect(wallets[0]).approve(exchangeContract.address, '0')

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('maker order not enough allowance')
  })

  it("Should revert with 'taker order not enough allowance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    await tokenB.connect(wallets[1]).approve(exchangeContract.address, '0')

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('taker order not enough allowance')
  })

  it('Should revert when maker order is already filled', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.BigNumber.from('971'),
      buyAmount: ethers.BigNumber.from('120'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.BigNumber.from('120')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInput(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('order is filled')
  })

  it('Should revert when maker order is canceled', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.BigNumber.from('970'),
      buyAmount: ethers.BigNumber.from('120'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('1')
    await exchangeContract
      .connect(wallets[0])
      .cancelOrder(Object.values(makerOrder))
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('order canceled')
  })


  it('Should revert when maker order is expired', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.BigNumber.from('970'),
      buyAmount: ethers.BigNumber.from('120'),
      expirationTimeSeconds: ethers.BigNumber.from('100')
    }

    const fillAmount = ethers.utils.parseEther('1')
    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('order expired')
  })

  it('should fail when filled twice', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('100')
    const tx = await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInput(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('order is filled')
  })

  it('fill a full order', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('100')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInput(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    console.log(
      ethers.utils.formatEther(balance1),
      ethers.utils.formatEther(balance4)
    )
    console.log(
      ethers.utils.formatEther(balance2),
      ethers.utils.formatEther(balance5)
    )
    console.log(
      ethers.utils.formatEther(balance3),
      ethers.utils.formatEther(balance6)
    )

    expect(balance2).to.equal(ethers.utils.parseEther('200'))
    expect(balance4).to.equal(ethers.utils.parseEther('100'))
  })

  it('should fail without fillAvailable when over-ordering', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('90')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInput(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    const tx2 = exchangeContract
      .connect(wallets[1])
      .fillOrderExactInput(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    await expect(tx2).to.be.revertedWith('amount exceeds available size')
  })

  it('should not fail with fillAvailable when over-ordering', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('90')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInput(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInput(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        true
      )

    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)

    expect(balance2).to.equal(ethers.utils.parseEther('200'))
    expect(balance4).to.equal(ethers.utils.parseEther('100'))
  })

  it('Should emit events for a partial order', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    const orderHash = await getOrderHash(makerOrder, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('50')

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[1].address,
        tokenA.address,
        tokenB.address,
        ethers.utils.parseEther('100'),
        ethers.utils.parseEther('50'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.05')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHash,
        ethers.utils.parseEther('100'),
        ethers.utils.parseEther('100')
      )
  })

  it('Should emit events for a full order', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    const orderHash = await getOrderHash(makerOrder, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderExactInput(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[1].address,
        tokenA.address,
        tokenB.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('100'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.1')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHash,
        ethers.utils.parseEther('200'),
        ethers.constants.Zero
      )
  })
})
