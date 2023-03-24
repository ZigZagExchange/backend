import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, Wallet } from 'ethers'
import { TESTRPC_PRIVATE_KEYS_STRINGS } from './utils/PrivateKeyList'
import { signOrder, getOrderHash } from './utils/SignUtil'

describe('fillOrderRouteETH_Deposit', () => {
  let exchangeContract: Contract
  let weth: Contract
  let tokenB: Contract
  let tokenC: Contract
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
    tokenC = await Token.deploy()
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
      value: ethers.utils.parseEther('100')
    })
    await tokenB.mint(ethers.utils.parseEther('1000'), wallets[1].address)
    await tokenC.mint(ethers.utils.parseEther('1000'), wallets[2].address)
    await tokenB
      .connect(wallets[1])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenC
      .connect(wallets[2])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))

  })

  it('should revert with "Length of makerOrders can not be 0"', async () => {
    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderRoute([], [], fillAmount, false)
    ).to.be.revertedWith('Length of makerOrders can not be 0')
  })

  it('should revert with "Length of makerOrders and makerSignatures does not match", more makerOrders', async () => {
    const makerOrderOne = {
      user: wallets[0].address,
      sellToken: tokenB.address,
      buyToken: tokenC.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const makerOrderTwo = {
      user: wallets[0].address,
      sellToken: tokenB.address,
      buyToken: tokenC.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrderOne,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderRoute(
          [Object.values(makerOrderOne), Object.values(makerOrderTwo)],
          [signedLeftMessage],
          fillAmount,
          false
        )
    ).to.be.revertedWith(
      'Length of makerOrders and makerSignatures does not match'
    )
  })

  it('should revert with "Length of makerOrders and makerSignatures does not match", more signatures', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenB.address,
      buyToken: tokenC.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessageOne = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    const signedLeftMessageTwo = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderRoute(
          [Object.values(makerOrder)],
          [signedLeftMessageOne, signedLeftMessageTwo],
          fillAmount,
          false
        )
    ).to.be.revertedWith(
      'Length of makerOrders and makerSignatures does not match'
    )
  })

  it('fill a full order, n=1', async () => {
    const makerOrder = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[1],
      makerOrder,
      exchangeContract.address
    )
    const orderHash = await getOrderHash(makerOrder)

    const balance3Before = await provider.getBalance(wallets[0].address)
    const fillAmount = ethers.utils.parseEther('100')
    let tx
    await expect(
      (tx = exchangeContract
        .connect(wallets[0])
        .fillOrderRouteETH(
          [Object.values(makerOrder)],
          [signedLeftMessage],
          fillAmount,
          false,
          { value: fillAmount }
        ))
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[1].address,
        weth.address,
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
        ethers.utils.parseEther('0')
      )

    const res = await (await tx).wait()

    const balance1 = await tokenB.balanceOf(wallets[0].address)
    const balance2 = await tokenB.balanceOf(wallets[1].address)
    const balance3 = (await provider.getBalance(wallets[0].address))
      .sub(balance3Before)
      .add(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
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
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

    // user
    expect(balance1).to.equal(ethers.utils.parseEther('200')) // fillAmount (100) * price (2)
    expect(balance3).to.equal(ethers.utils.parseEther('-100')) // delta = -fillAmount
    expect(balance4).to.equal(ethers.utils.parseEther('0')) // user has no weth

    // mm
    expect(balance2).to.equal(ethers.utils.parseEther('800')) // mint (1000) - fillAmount (100) * price (2)
    expect(balance5).to.equal(ethers.utils.parseEther('100')) // = fillAmount(100) - makerFee (0)


    // exchange contract should have no ETH or WETH left over
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('fill a full order, n=2', async () => {
    const makerOrderOne = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const makerOrderTwo = {
      user: wallets[2].address,
      sellToken: tokenC.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('400'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedMessageOne = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[1],
      makerOrderOne,
      exchangeContract.address
    )
    const signedMessageTwo = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[2],
      makerOrderTwo,
      exchangeContract.address
    )
    const orderHashOne = await getOrderHash(makerOrderOne)
    const orderHashTwo = await getOrderHash(makerOrderTwo)

    const fillAmount = ethers.utils.parseEther('100')
    const balance1_2Before = await provider.getBalance(wallets[0].address)
    const balance2_2Before = await provider.getBalance(wallets[1].address)
    const balance3_2Before = await provider.getBalance(wallets[2].address)
    const balance13_2Before = await provider.getBalance(
      exchangeContract.address
    )
    let tx
    await expect(
      (tx = await exchangeContract
        .connect(wallets[0])
        .fillOrderRouteETH(
          [Object.values(makerOrderOne), Object.values(makerOrderTwo)],
          [signedMessageOne, signedMessageTwo],
          fillAmount,
          false,
          { value: fillAmount }
        ))
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        weth.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('100'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.1')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashOne,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('0')
      )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[2].address,
        wallets[0].address,
        tokenC.address,
        tokenB.address,
        ethers.utils.parseEther('399.8'),
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.19999')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashTwo,
        ethers.utils.parseEther('399.8'),
        ethers.utils.parseEther('0.2')
      )
    const res = await tx.wait()

    const balance1_1 = await weth.balanceOf(wallets[0].address)
    // remove fee impact
    const balance1_2 = (await provider.getBalance(wallets[0].address))
      .sub(balance1_2Before)
      .add(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance2_1 = await weth.balanceOf(wallets[1].address)
    const balance2_2 = (await provider.getBalance(wallets[1].address)).sub(
      balance2_2Before
    )
    const balance3_1 = await weth.balanceOf(wallets[2].address)
    const balance3_2 = (await provider.getBalance(wallets[2].address)).sub(
      balance3_2Before
    )
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7 = await tokenC.balanceOf(wallets[0].address)
    const balance8 = await tokenC.balanceOf(wallets[1].address)
    const balance9 = await tokenC.balanceOf(wallets[2].address)
    const balance13_1 = await weth.balanceOf(exchangeContract.address)
    const balance13_2 = (
      await provider.getBalance(exchangeContract.address)
    ).sub(balance13_2Before)
    const balance14 = await tokenB.balanceOf(exchangeContract.address)
    const balance15 = await tokenC.balanceOf(exchangeContract.address)
    console.log(
      ethers.utils.formatEther(balance1_1),
      ethers.utils.formatEther(balance1_2),
      ethers.utils.formatEther(balance4),
      ethers.utils.formatEther(balance7)
    )
    console.log(
      ethers.utils.formatEther(balance2_1),
      ethers.utils.formatEther(balance2_2),
      ethers.utils.formatEther(balance5),
      ethers.utils.formatEther(balance8)
    )
    console.log(
      ethers.utils.formatEther(balance3_1),
      ethers.utils.formatEther(balance3_2),
      ethers.utils.formatEther(balance6),
      ethers.utils.formatEther(balance9)
    )
    console.log(
      ethers.utils.formatEther(balance13_1),
      ethers.utils.formatEther(balance13_2),
      ethers.utils.formatEther(balance14),
      ethers.utils.formatEther(balance15)
    )

    // check address1 (user)
    expect(balance1_1).to.equal(ethers.utils.parseEther('0')) // user has no weth
    expect(balance1_2).to.equal(ethers.utils.parseEther('-100')) // delta = -100 (outflow)
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance7).to.equal(ethers.utils.parseEther('400')) // 100 * 2 * 2

    // check address2 (mm one)
    expect(balance2_1).to.equal(ethers.utils.parseEther('100')) // fillAmount = mm one buy amount
    expect(balance2_2).to.equal(ethers.utils.parseEther('0')) // mm one no eth
    expect(balance5).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm sell amount (200)
    expect(balance8).to.equal(ethers.utils.parseEther('0'))

    // check address3 (mm two)
    expect(balance3_1).to.equal(ethers.utils.parseEther('0'))
    expect(balance3_2).to.equal(ethers.utils.parseEther('0'))
    expect(balance6).to.equal(ethers.utils.parseEther('200')) // fillAmount = mm one buy amount = 100 * 2
    expect(balance9).to.equal(ethers.utils.parseEther('600')) // mint (1000) - mm one sell amount (100 * 2 * 2)

    // nothing left in exchange contract
    expect(balance13_1).to.equal(ethers.utils.parseEther('0'))
    expect(balance13_2).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('0'))
    expect(balance15).to.equal(ethers.utils.parseEther('0'))

    console.log(
      'GAS FEE: ',
      ethers.utils.formatEther(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    )
  })
})

describe('fillOrderRouteETH_Withdraw', () => {
  let exchangeContract: Contract
  let tokenA: Contract
  let tokenB: Contract
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
    tokenB = await Token.deploy()
    weth = await aeWETH.deploy()
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

    await tokenA.mint(ethers.utils.parseEther('1000'), wallets[0].address)
    await tokenB.mint(ethers.utils.parseEther('1000'), wallets[1].address)
    await owner.sendTransaction({
      to: wallets[2].address,
      value: ethers.utils.parseEther('500')
    })
    await weth
      .connect(wallets[2])
      .deposit({ value: ethers.utils.parseEther('500') })

    await tokenA
      .connect(wallets[0])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenB
      .connect(wallets[1])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await weth
      .connect(wallets[2])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))

  })

  it('fill a full order, n=1', async () => {
    const makerOrder = {
      user: wallets[2].address,
      sellToken: weth.address,
      buyToken: tokenA.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[2],
      makerOrder,
      exchangeContract.address
    )
    const orderHash = await getOrderHash(makerOrder)

    const balance2Before = await provider.getBalance(wallets[0].address)
    const fillAmount = ethers.utils.parseEther('100')
    let tx
    await expect(
      (tx = await exchangeContract
        .connect(wallets[0])
        .fillOrderRouteETH(
          [Object.values(makerOrder)],
          [signedLeftMessage],
          fillAmount,
          false
        ))
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[2].address,
        weth.address,
        tokenA.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('100'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.1')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHash,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('0')
      )

    const res = await tx.wait()

    const balance1 = await weth.balanceOf(wallets[0].address)
    const balance2 = (await provider.getBalance(wallets[0].address))
      .sub(balance2Before)
      .add(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await tokenA.balanceOf(wallets[0].address)
    const balance5 = await tokenA.balanceOf(wallets[2].address)
    const balance6 = await weth.balanceOf(wallets[2].address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenA.balanceOf(exchangeContract.address)
    console.log(
      ethers.utils.formatEther(balance1),
      ethers.utils.formatEther(balance2),
      ethers.utils.formatEther(balance4)
    )
    console.log(
      ethers.utils.formatEther(balance5),
      ethers.utils.formatEther(balance6)
    )
    console.log(
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

    // user
    expect(balance1).to.equal(ethers.utils.parseEther('0')) // user has no weth
    expect(balance2).to.equal(ethers.utils.parseEther('200')) // fillAmount(100) * price (2)
    expect(balance4).to.equal(ethers.utils.parseEther('900')) // mint (1000) - fillAmount(100)

    // mm
    expect(balance5).to.equal(ethers.utils.parseEther('100')) // = fillAmount(100)
    expect(balance6).to.equal(ethers.utils.parseEther('300')) // mint (500) - fillAmount(100) * price(2)

    // exchange contract should have no ETH or WETH left over
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))

    console.log(
      'GAS FEE: ',
      ethers.utils.formatEther(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    )
  })

  it('fill a full order, n=2', async () => {
    const makerOrderOne = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: tokenA.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const makerOrderTwo = {
      user: wallets[2].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('400'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedMessageOne = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[1],
      makerOrderOne,
      exchangeContract.address
    )
    const signedMessageTwo = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[2],
      makerOrderTwo,
      exchangeContract.address
    )
    const orderHashOne = await getOrderHash(makerOrderOne)
    const orderHashTwo = await getOrderHash(makerOrderTwo)

    const fillAmount = ethers.utils.parseEther('100')
    const balance7_2Before = await provider.getBalance(wallets[0].address)
    const balance8_2Before = await provider.getBalance(wallets[1].address)
    const balance9_2Before = await provider.getBalance(wallets[2].address)
    const balance15_2Before = await provider.getBalance(
      exchangeContract.address
    )
    let tx
    await expect(
      (tx = await exchangeContract
        .connect(wallets[0])
        .fillOrderRouteETH(
          [Object.values(makerOrderOne), Object.values(makerOrderTwo)],
          [signedMessageOne, signedMessageTwo],
          fillAmount,
          false
        ))
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        tokenA.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('100'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.1')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashOne,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('0')
      )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[2].address,
        wallets[0].address,
        weth.address,
        tokenB.address,
        ethers.utils.parseEther('399.8'),
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.19999')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashTwo,
        ethers.utils.parseEther('399.8'),
        ethers.utils.parseEther('0.2')
      )

    const res = await tx.wait()

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7_1 = await weth.balanceOf(wallets[0].address)
    // remove fee impact
    const balance7_2 = (await provider.getBalance(wallets[0].address))
      .sub(balance7_2Before)
      .add(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance8_1 = await weth.balanceOf(wallets[1].address)
    const balance8_2 = (await provider.getBalance(wallets[1].address)).sub(
      balance8_2Before
    )
    const balance9_1 = await weth.balanceOf(wallets[2].address)
    const balance9_2 = (await provider.getBalance(wallets[2].address)).sub(
      balance9_2Before
    )
    const balance13 = await weth.balanceOf(exchangeContract.address)
    const balance14 = await tokenB.balanceOf(exchangeContract.address)
    const balance15_1 = await weth.balanceOf(exchangeContract.address)
    const balance15_2 = (
      await provider.getBalance(exchangeContract.address)
    ).sub(balance15_2Before)
    console.log(
      ethers.utils.formatEther(balance1),
      ethers.utils.formatEther(balance4),
      ethers.utils.formatEther(balance7_1),
      ethers.utils.formatEther(balance7_2)
    )
    console.log(
      ethers.utils.formatEther(balance2),
      ethers.utils.formatEther(balance5),
      ethers.utils.formatEther(balance8_1),
      ethers.utils.formatEther(balance8_2)
    )
    console.log(
      ethers.utils.formatEther(balance3),
      ethers.utils.formatEther(balance6),
      ethers.utils.formatEther(balance9_1),
      ethers.utils.formatEther(balance9_2)
    )
    console.log(
      ethers.utils.formatEther(balance13),
      ethers.utils.formatEther(balance14),
      ethers.utils.formatEther(balance15_1),
      ethers.utils.formatEther(balance15_2)
    )

    // check address1 (user)
    expect(balance1).to.equal(ethers.utils.parseEther('900')) // mint (1000) - fillAmount (100)
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance7_1).to.equal(ethers.utils.parseEther('0')) // user has no weth
    expect(balance7_2).to.equal(ethers.utils.parseEther('400')) // delta = 100 * 2 * 2

    // check address2 (mm one)
    expect(balance2).to.equal(ethers.utils.parseEther('100')) // fillAmount = mm one buy amount
    expect(balance5).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm sell amount (200)
    expect(balance8_1).to.equal(ethers.utils.parseEther('0'))
    expect(balance8_2).to.equal(ethers.utils.parseEther('0')) // mm one no eth

    // check address3 (mm two)
    expect(balance3).to.equal(ethers.utils.parseEther('0'))
    expect(balance6).to.equal(ethers.utils.parseEther('200')) // fillAmount = mm one buy amount = 100 * 2
    expect(balance9_1).to.equal(ethers.utils.parseEther('100')) // mint (500) - mm one sell amount (100 * 2 * 2)
    expect(balance9_2).to.equal(ethers.utils.parseEther('0')) // mm two no eth

    // nothing left in exchange contract
    expect(balance13).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('0'))
    expect(balance15_1).to.equal(ethers.utils.parseEther('0'))
    expect(balance15_2).to.equal(ethers.utils.parseEther('0'))

    console.log(
      'GAS FEE: ',
      ethers.utils.formatEther(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    )
  })
})
