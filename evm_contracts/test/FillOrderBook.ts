import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, Wallet } from 'ethers'
import { TESTRPC_PRIVATE_KEYS_STRINGS } from './utils/PrivateKeyList'
import { signOrder, getOrderHash } from './utils/SignUtil'

describe('FillOrderBook', () => {
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
        value: ethers.utils.parseEther('0.1'), // 0.1 ether
      })
    }

    exchangeContract = await Exchange.deploy(
      'ZigZag',
      '2.1',
      ethers.constants.AddressZero
    )

    await tokenA.mint(ethers.utils.parseEther('1000'), wallets[0].address)
    await tokenA.mint(ethers.utils.parseEther('1000'), wallets[2].address)
    await tokenB.mint(ethers.utils.parseEther('1000'), wallets[1].address)
    await tokenA.connect(wallets[0]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenA.connect(wallets[2]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenB.connect(wallets[1]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
  })

  it("Should revert with 'Taker amount not filled' A", async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('20000'),
      buyAmount: ethers.utils.parseEther('1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('15000')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    ).to.be.revertedWith('Taker amount not filled')
  })

  it("Should revert with 'Taker amount not filled' B", async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('20000'),
      buyAmount: ethers.utils.parseEther('1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('15000')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    ).to.be.revertedWith('Taker amount not filled')
  })

  it("Should revert with 'taker order not enough balance' ", async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('1'),
      buyAmount: ethers.utils.parseEther('15000'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('15000')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    ).to.be.revertedWith('taker order not enough balance')
  })

  it("Should not revert with 'maker order not enough allowance' A", async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('150'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    await tokenA.connect(wallets[0]).approve(exchangeContract.address, '0')

    const fillAmount = ethers.utils.parseEther('200')
    exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
  })

  it("Should not revert with 'maker order not enough allowance' B", async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('150'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    await tokenA.connect(wallets[2]).approve(exchangeContract.address, '0')

    const fillAmount = ethers.utils.parseEther('150')
    exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
  })

  it("Should not revert with 'maker order not enough allowance' A+B", async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('150'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    await tokenA.connect(wallets[0]).approve(exchangeContract.address, '0')
    await tokenA.connect(wallets[2]).approve(exchangeContract.address, '0')

    const fillAmount = ethers.utils.parseEther('150')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    ).to.be.revertedWith('Taker amount not filled')
  })

  it("Should revert with 'taker order not enough allowance' ", async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('150'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    await tokenB.connect(wallets[1]).approve(exchangeContract.address, '0')

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    ).to.be.revertedWith('taker order not enough allowance')
  })

  it('Should not revert when maker order is already filled A', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')
    await exchangeContract.connect(wallets[1]).fillOrderBook([Object.values(makerOrderA)], [signedLeftMessageA], fillAmount)
    await exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
  })

  it('Should not revert when maker order is already filled B', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmountOne = ethers.utils.parseEther('100')
    await exchangeContract.connect(wallets[1]).fillOrderBook([Object.values(makerOrderB)], [signedLeftMessageB], fillAmountOne)

    const fillAmountTwo = ethers.utils.parseEther('25')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmountTwo)
  })

  it('Should revert when maker order is already filled A+B', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')
    await exchangeContract.connect(wallets[1]).fillOrderBook([Object.values(makerOrderA)], [signedLeftMessageA], fillAmount)
    await exchangeContract.connect(wallets[1]).fillOrderBook([Object.values(makerOrderB)], [signedLeftMessageB], fillAmount)

    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    ).to.be.revertedWith('Taker amount not filled')
  })

  it('Should not revert when maker order is canceled A', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')
    await exchangeContract.connect(wallets[0]).cancelOrder(Object.values(makerOrderA))

    await exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
  })

  it('Should not revert when maker order is canceled B', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')
    await exchangeContract.connect(wallets[2]).cancelOrder(Object.values(makerOrderB))

    await exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
  })

  it('Should revert when maker order is canceled A+B', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')
    await exchangeContract.connect(wallets[0]).cancelOrder(Object.values(makerOrderA))
    await exchangeContract.connect(wallets[2]).cancelOrder(Object.values(makerOrderB))

    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    ).to.be.revertedWith('Taker amount not filled')
  })

  it('Should not revert when maker order is expired A', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(100),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
  })

  it('Should not revert when maker order is expired B', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(100),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
  })

  it('Should revert when maker order is expired A+B', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(100),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(100),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    ).to.be.revertedWith('Taker amount not filled')
  })

  it('should fail when filled twice', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('200')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)

    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    ).to.be.revertedWith('Taker amount not filled')
  })

  it('fill a full order', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('200')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))

    // makerA
    expect(balance1).to.equal(ethers.utils.parseEther('900')) // 1000 - 100
    expect(balance4).to.equal(ethers.utils.parseEther('150')) // 150

    // makerB
    expect(balance3).to.equal(ethers.utils.parseEther('900')) // 1000 - 100
    expect(balance6).to.equal(ethers.utils.parseEther('200')) // 200

    // user
    expect(balance2).to.equal(ethers.utils.parseEther('200')) // 100 + 100
    expect(balance5).to.equal(ethers.utils.parseEther('650')) // 1000 - 150 - 200
  })

  it('Should emit events for a partial order', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const orderHashA = await getOrderHash(makerOrderA, exchangeContract.address)
    const fillAmount = ethers.utils.parseEther('100')

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[1].address,
        tokenA.address,
        tokenB.address,
        ethers.utils.parseEther('100'),
        ethers.utils.parseEther('150')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashA, ethers.utils.parseEther('100'), ethers.utils.parseEther('0'))
  })

  it('Should emit events for a full order', async () => {
    const makerOrderA = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('150'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const makerOrderB = {
      user: wallets[2].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }
    const signedLeftMessageA = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrderA, exchangeContract.address)
    const signedLeftMessageB = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderB, exchangeContract.address)

    const orderHashA = await getOrderHash(makerOrderA, exchangeContract.address)
    const orderHashB = await getOrderHash(makerOrderB, exchangeContract.address)
    const fillAmount = ethers.utils.parseEther('200')

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderBook([Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount)
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[1].address,
        tokenA.address,
        tokenB.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('350')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashA, ethers.utils.parseEther('100'), ethers.utils.parseEther('0'))
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashB, ethers.utils.parseEther('100'), ethers.utils.parseEther('0'))
  })
})
