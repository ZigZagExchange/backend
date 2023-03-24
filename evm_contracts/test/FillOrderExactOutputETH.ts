import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, Wallet } from 'ethers'
import { TESTRPC_PRIVATE_KEYS_STRINGS } from './utils/PrivateKeyList'
import { signOrder, signCancelOrder, getOrderHash } from './utils/SignUtil'

describe('fillOrderExactOutputETH_Deposit', () => {
  let exchangeContract: Contract
  let tokenA: Contract
  let weth: Contract
  const wallets: Wallet[] = []
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

    exchangeContract = await Exchange.deploy(
      'ZigZag',
      '2.1',
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

    const fillAmount = ethers.utils.parseEther('19500')
    const fillAmountETH = ethers.utils.parseEther('1')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactOutputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmountETH }
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
        .fillOrderExactOutputETH(
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

    const fillAmount = ethers.BigNumber.from('971')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmount }
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactOutputETH(
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
        .fillOrderExactOutputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    ).to.be.revertedWith('order canceled')
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
        .fillOrderExactOutputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmount }
        )
    ).to.be.revertedWith('order expired')
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

    const fillAmount = ethers.utils.parseEther('199.9')
    const fillAmountETH = ethers.utils.parseEther('100')
    const tx = await exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmountETH }
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactOutputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false,
          { value: fillAmountETH }
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
    const fillAmount = ethers.utils.parseEther('199.9')
    const fillAmountETH = ethers.utils.parseEther('100')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmountETH }
      )

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await provider.getBalance(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[2].address)
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

    const fillAmount = ethers.utils.parseEther('150')
    const fillAmountETH = ethers.utils.parseEther('100')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmountETH }
      )
    const tx2 = exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmountETH }
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

    const fillAmount = ethers.utils.parseEther('150')
    const fillAmountETH = ethers.utils.parseEther('100')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false,
        { value: fillAmountETH }
      )
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        true,
        { value: fillAmountETH }
      )

    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance4 = await weth.balanceOf(wallets[0].address)

    expect(balance2).to.equal(ethers.utils.parseEther('199.900000000000000001'))
    expect(balance4).to.equal(ethers.utils.parseEther('99.999999999999999999'))
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
        .fillOrderExactOutputETH(
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
        .fillOrderExactOutputETH(
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

describe('fillOrderExactOutputETH_Withdraw', () => {
  let exchangeContract: Contract
  let weth: Contract
  let tokenB: Contract
  const wallets: Wallet[] = []
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

    exchangeContract = await Exchange.deploy(
      'ZigZag',
      '2.1',
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

    const fillAmount = ethers.utils.parseEther('19500')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactOutputETH(
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

    const fillAmount = ethers.utils.parseEther('0.9')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactOutputETH(
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
        .fillOrderExactOutputETH(
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
        .fillOrderExactOutputETH(
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

    const fillAmount = ethers.BigNumber.from('971')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactOutputETH(
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
        .fillOrderExactOutputETH(
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
        .fillOrderExactOutputETH(
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

  it('should fail when filled twice', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
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
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        true
      )
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderExactOutputETH(
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
    const fillAmount = ethers.utils.parseEther('200')
    const tx = await exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
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
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

    expect(balance2).to.equal(ethers.utils.parseEther('200'))
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

    const fillAmount = ethers.utils.parseEther('100')
    await exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        true
      )
    const tx2 = exchangeContract
      .connect(wallets[1])
      .fillOrderExactOutputETH(
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      )
    await expect(tx2).to.be.revertedWith('amount exceeds available size')
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
        .fillOrderExactOutputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
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
        .fillOrderExactOutputETH(
          Object.values(makerOrder),
          signedLeftMessage,
          fillAmount,
          false
        )
    )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHash,
        ethers.utils.parseEther('200'),
        ethers.constants.Zero
      )
  })

  it('Should emit Swap fill a order', async () => {
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

    const fillAmount = ethers.utils.parseEther('50')

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderExactOutputETH(
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
        ethers.utils.parseEther('100'),
        ethers.utils.parseEther('50'),
      )
  })

  it('Should emit Swap fill a full order', async () => {
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

    expect(
      await exchangeContract
        .connect(wallets[1])
        .fillOrderExactOutputETH(
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
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('100'),
      )
  })
})
