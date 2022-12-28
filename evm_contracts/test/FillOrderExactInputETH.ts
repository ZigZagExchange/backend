import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, Wallet } from 'ethers'
import { TESTRPC_PRIVATE_KEYS_STRINGS } from './utils/PrivateKeyList'
import { signOrder, signCancelOrder, getOrderHash } from './utils/SignUtil'
import { Order } from './utils/types'

describe('fillOrderExactInputETH_Deposit', () => {
  let exchangeContract: Contract
  let tokenA: Contract
  let weth: Contract
  const wallets: Wallet[] = []
  let FEE_ADDRESS: string
  let provider: any

  beforeEach(async function () {
    this.timeout(30000)
    const Exchange = await ethers.getContractFactory('ZigZagExchange')
    const Token = await ethers.getContractFactory('Token')
    const aeWETH = await ethers.getContractFactory('aeWETH')
    provider = ethers.provider

    tokenA = await Token.deploy()
    weth = await aeWETH.deploy()
    const [owner] = await ethers.getSigners()

    for (let i = 0; i < 4; i++) {
      wallets[i] = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[i], provider)

      await owner.sendTransaction({
        to: wallets[i].address,
        value: ethers.utils.parseEther('1') // 1 ether
      })
    }

    FEE_ADDRESS = wallets[3].address
    exchangeContract = await Exchange.deploy(
      'ZigZag',
      '2.1',
      FEE_ADDRESS,
      weth.address
    )

    await tokenA.mint(ethers.utils.parseEther('1000'), wallets[0].address)
    await owner.sendTransaction({
      to: wallets[1].address,
      value: ethers.utils.parseEther('100')
    })
    await tokenA
      .connect(wallets[0])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await weth
      .connect(wallets[1])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))

    await exchangeContract.connect(wallets[3]).setFees(5, 10000, 0, 10000)
  })

  it("Should revert with 'maker order not enough balance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    ).to.be.revertedWith('maker order not enough balance')
  })

  it("Should revert with 'maker order not enough allowance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    ).to.be.revertedWith('maker order not enough allowance')
  })

  it('Should revert when maker order is already filled', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmount }
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    ).to.be.revertedWith('order is filled')
  })

  it('Should revert when maker order is canceled', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    ).to.be.revertedWith('order canceled')
  })

  it('Should revert when maker order is canceled with signature', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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

    const signedCancelOrder = await signCancelOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    await exchangeContract
      .connect(wallets[2])
      .cancelOrderWithSig(Object.values(makerOrder), signedCancelOrder)

    const fillAmount = ethers.utils.parseEther('1')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    ).to.be.revertedWith('order canceled')
  })

  it('Bad cancel signature should revert', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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

    const signedCancelOrder = await signCancelOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[1],
      makerOrder,
      exchangeContract.address
    )
    await expect(
      exchangeContract
        .connect(wallets[2])
        .cancelOrderWithSig(Object.values(makerOrder), signedCancelOrder)
    ).to.be.revertedWith('invalid cancel signature')
  })

  it('Should revert when maker order is expired', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    ).to.be.revertedWith('order expired')
  })

  it('feeRecipient should take Maker Fee', async () => {
    await exchangeContract.connect(wallets[3]).setFees(0, 10000, 5, 10000)

    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('1000'),
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

    const fillAmount = ethers.utils.parseEther('30')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmount }
      )

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await provider.getBalance(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[2].address)
    const balance7 = await tokenA.balanceOf(FEE_ADDRESS)
    const balance8 = await weth.balanceOf(FEE_ADDRESS)
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
    console.log(
      ethers.utils.formatEther(balance7),
      ethers.utils.formatEther(balance8)
    )

    expect(balance8).to.equal(ethers.utils.parseEther('0.015'))
  })

  it('feeRecipient should take Taker Fee', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('1000'),
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

    const fillAmount = ethers.utils.parseEther('30')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmount }
      )

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await provider.getBalance(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[2].address)
    const balance7 = await tokenA.balanceOf(FEE_ADDRESS)
    const balance8 = await weth.balanceOf(FEE_ADDRESS)
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
    console.log(
      ethers.utils.formatEther(balance7),
      ethers.utils.formatEther(balance8)
    )

    expect(balance7).to.equal(ethers.utils.parseEther('0.15'))
  })

  it('should fail when filled twice', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmount }
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    ).to.be.revertedWith('order is filled')
  })

  it('fill a full order', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmount }
      )

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await provider.getBalance(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[2].address)
    const balance7 = await tokenA.balanceOf(FEE_ADDRESS)
    const balance8 = await weth.balanceOf(FEE_ADDRESS)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenA.balanceOf(exchangeContract.address)
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
    console.log(
      ethers.utils.formatEther(balance7),
      ethers.utils.formatEther(balance8)
    )
    console.log(
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

    expect(balance2).to.equal(ethers.utils.parseEther('199.9'))
    expect(balance4).to.equal(ethers.utils.parseEther('100'))
    // exchange contract should have no ETH or WETH left over
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('should fail without fillAvailable when over-ordering', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmount }
      )
    const tx2 = exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmount }
      )
    await expect(tx2).to.be.revertedWith('amount exceeds available size')
  })

  it('should not fail with fillAvailable when over-ordering', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmount }
      )
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        true,
        { value: fillAmount }
      )

    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance4 = await weth.balanceOf(wallets[0].address)

    expect(balance2).to.equal(ethers.utils.parseEther('199.9'))
    expect(balance4).to.equal(ethers.utils.parseEther('100'))
  })

  it('Should emit events for a partial order', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
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
    const orderHash = await getOrderHash(makerOrder)

    const fillAmount = ethers.utils.parseEther('50')

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[1].address,
        tokenA.address,
        weth.address,
        ethers.utils.parseEther('99.95'),
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
      buyToken: weth.address,
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
    const orderHash = await getOrderHash(makerOrder)

    const fillAmount = ethers.utils.parseEther('100')

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[1].address,
        tokenA.address,
        weth.address,
        ethers.utils.parseEther('199.9'),
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

describe('fillOrderExactInputETH_Withdraw', () => {
  let exchangeContract: Contract
  let weth: Contract
  let tokenB: Contract
  const wallets: Wallet[] = []
  let FEE_ADDRESS: string
  let provider: any

  beforeEach(async function () {
    this.timeout(30000)
    const Exchange = await ethers.getContractFactory('ZigZagExchange')
    const Token = await ethers.getContractFactory('Token')
    const aeWETH = await ethers.getContractFactory('aeWETH')
    provider = ethers.provider

    weth = await aeWETH.deploy()
    tokenB = await Token.deploy()
    const [owner] = await ethers.getSigners()

    for (let i = 0; i < 4; i++) {
      wallets[i] = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[i], provider)

      await owner.sendTransaction({
        to: wallets[i].address,
        value: ethers.utils.parseEther('0.1') // 0.1 ether
      })
    }

    FEE_ADDRESS = wallets[3].address
    exchangeContract = await Exchange.deploy(
      'ZigZag',
      '2.1',
      FEE_ADDRESS,
      weth.address
    )

    await owner.sendTransaction({
      to: wallets[0].address,
      value: ethers.utils.parseEther('205')
    })
    await weth
      .connect(wallets[0])
      .deposit({ value: ethers.utils.parseEther('205') })
    await tokenB.mint(ethers.utils.parseEther('1000'), wallets[1].address)
    await weth
      .connect(wallets[0])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenB
      .connect(wallets[1])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))

    await exchangeContract.connect(wallets[3]).setFees(5, 10000, 0, 10000)
  })

  it("Should revert with 'maker order not enough balance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('maker order not enough balance')

    const [owner] = await ethers.getSigners()
    await weth.connect(wallets[0]).withdraw(ethers.utils.parseEther('200'))
    await wallets[0].sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('200')
    })
  })

  it("Should revert with 'taker order not enough balance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('taker order not enough balance')

    const [owner] = await ethers.getSigners()
    await weth.connect(wallets[0]).withdraw(ethers.utils.parseEther('200'))
    await wallets[0].sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('200')
    })
  })

  it("Should revert with 'maker order not enough allowance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
    await weth.connect(wallets[0]).approve(exchangeContract.address, '0')

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('maker order not enough allowance')

    const [owner] = await ethers.getSigners()
    await weth.connect(wallets[0]).withdraw(ethers.utils.parseEther('200'))
    await wallets[0].sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('200')
    })
  })

  it("Should revert with 'taker order not enough allowance' ", async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('taker order not enough allowance')

    const [owner] = await ethers.getSigners()
    await weth.connect(wallets[0]).withdraw(ethers.utils.parseEther('200'))
    await wallets[0].sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('200')
    })
  })

  it('Should revert when maker order is already filled', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('order is filled')

    const [owner] = await ethers.getSigners()
    await weth.connect(wallets[0]).withdraw(ethers.utils.parseEther('200'))
    await wallets[0].sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('200')
    })
  })

  it('Should revert when maker order is canceled', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('order canceled')

    const [owner] = await ethers.getSigners()
    await weth.connect(wallets[0]).withdraw(ethers.utils.parseEther('200'))
    await wallets[0].sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('200')
    })
  })

  it('Should revert when maker order is canceled with signature', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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

    const signedCancelOrder = await signCancelOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    await exchangeContract
      .connect(wallets[2])
      .cancelOrderWithSig(Object.values(makerOrder), signedCancelOrder)

    const fillAmount = ethers.utils.parseEther('1')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('order canceled')

    const [owner] = await ethers.getSigners()
    await weth.connect(wallets[0]).withdraw(ethers.utils.parseEther('200'))
    await wallets[0].sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('200')
    })
  })

  it('Bad cancel signature should revert', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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

    const signedCancelOrder = await signCancelOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[1],
      makerOrder,
      exchangeContract.address
    )
    await expect(
      exchangeContract
        .connect(wallets[2])
        .cancelOrderWithSig(Object.values(makerOrder), signedCancelOrder)
    ).to.be.revertedWith('invalid cancel signature')

    const [owner] = await ethers.getSigners()
    await weth.connect(wallets[0]).withdraw(ethers.utils.parseEther('200'))
    await wallets[0].sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('200')
    })
  })

  it('Should revert when maker order is expired', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
        .fillOrderExactInputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    ).to.be.revertedWith('order expired')

    const [owner] = await ethers.getSigners()
    await weth.connect(wallets[0]).withdraw(ethers.utils.parseEther('200'))
    await wallets[0].sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('200')
    })
  })

  it('feeRecipient should take Maker Fee', async () => {
    await exchangeContract.connect(wallets[3]).setFees(0, 10000, 5, 10000)

    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('10'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }
    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('3')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )

    const balance1 = await weth.balanceOf(wallets[0].address)
    const balance2 = await weth.balanceOf(wallets[1].address)
    const balance3 = await weth.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7 = await weth.balanceOf(FEE_ADDRESS)
    const balance8 = await tokenB.balanceOf(FEE_ADDRESS)
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
    console.log(
      ethers.utils.formatEther(balance7),
      ethers.utils.formatEther(balance8)
    )

    expect(balance8).to.equal(ethers.utils.parseEther('0.0015'))
  })

  it('feeRecipient should take Taker Fee', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('10'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }
    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('3')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )

    const balance1 = await weth.balanceOf(wallets[0].address)
    const balance2 = await weth.balanceOf(wallets[1].address)
    const balance3 = await weth.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7 = await weth.balanceOf(FEE_ADDRESS)
    const balance8 = await tokenB.balanceOf(FEE_ADDRESS)
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
    console.log(
      ethers.utils.formatEther(balance7),
      ethers.utils.formatEther(balance8)
    )

    expect(balance7).to.equal(ethers.utils.parseEther('0.015'))
  })

  it('should fail when filled twice', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
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
      sellToken: weth.address,
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

    const balance2Before = await provider.getBalance(wallets[1].address)
    const fillAmount = ethers.utils.parseEther('100')
    const tx = await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    const res = await tx.wait()

    const balance1 = await weth.balanceOf(wallets[0].address)
    const balance2 = (await provider.getBalance(wallets[1].address))
      .sub(balance2Before)
      .add(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance3 = await weth.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7 = await weth.balanceOf(FEE_ADDRESS)
    const balance8 = await tokenB.balanceOf(FEE_ADDRESS)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenB.balanceOf(exchangeContract.address)
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
    console.log(
      ethers.utils.formatEther(balance7),
      ethers.utils.formatEther(balance8)
    )
    console.log(
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

    expect(balance2).to.equal(ethers.utils.parseEther('199.9'))
    expect(balance4).to.equal(ethers.utils.parseEther('100'))
    // exchange contract should have no ETH or WETH left over
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))

    console.log(
      'GAS FEE: ',
      ethers.utils.formatEther(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    )
  })

  it('should fail without fillAvailable when over-ordering', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    const tx2 = exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
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
      sellToken: weth.address,
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
    const balance2Before = await provider.getBalance(wallets[1].address)
    const tx1 = await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    const tx2 = await exchangeContract
      .connect(wallets[1])
      .fillOrderExactInputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        true
      )
    const res1 = await tx1.wait()
    const res2 = await tx2.wait()
    const gasFee = res1.cumulativeGasUsed
      .mul(res1.effectiveGasPrice)
      .add(res2.cumulativeGasUsed.mul(res2.effectiveGasPrice))

    const balance2 = (await provider.getBalance(wallets[1].address))
      .sub(balance2Before)
      .add(gasFee)
    const balance4 = await tokenB.balanceOf(wallets[0].address)

    expect(balance2).to.equal(ethers.utils.parseEther('199.9'))
    expect(balance4).to.equal(ethers.utils.parseEther('100'))
  })

  it('Should emit events for a partial order', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
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
    const orderHash = await getOrderHash(makerOrder)

    const fillAmount = ethers.utils.parseEther('50')

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
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
        weth.address,
        tokenB.address,
        ethers.utils.parseEther('99.95'),
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
      sellToken: weth.address,
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
    const orderHash = await getOrderHash(makerOrder)

    const fillAmount = ethers.utils.parseEther('100')

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderExactInputETH(
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
        weth.address,
        tokenB.address,
        ethers.utils.parseEther('199.9'),
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
