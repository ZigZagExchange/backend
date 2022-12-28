import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, Wallet } from 'ethers'
import { TESTRPC_PRIVATE_KEYS_STRINGS } from './utils/PrivateKeyList'
import { signOrder, getOrderHash } from './utils/SignUtil'

describe('fillOrderRoute', () => {
  let exchangeContract: Contract
  let tokenA: Contract
  let tokenB: Contract
  let tokenC: Contract
  let tokenD: Contract
  let tokenE: Contract
  const wallets: Wallet[] = []
  let FEE_ADDRESS: string

  beforeEach(async function () {
    this.timeout(30000)
    const Exchange = await ethers.getContractFactory('ZigZagExchange')
    const Token = await ethers.getContractFactory('Token')
    const { provider } = ethers

    tokenA = await Token.deploy()
    tokenB = await Token.deploy()
    tokenC = await Token.deploy()
    tokenD = await Token.deploy()
    tokenE = await Token.deploy()
    const [owner] = await ethers.getSigners()

    for (let i = 0; i < 6; i++) {
      wallets[i] = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[i], provider)

      await owner.sendTransaction({
        to: wallets[i].address,
        value: ethers.utils.parseEther('0.1') // 0.1 ether
      })
    }

    FEE_ADDRESS = wallets[5].address
    exchangeContract = await Exchange.deploy(
      'ZigZag',
      '2.1',
      FEE_ADDRESS,
      ethers.constants.AddressZero
    )

    await tokenA.mint(ethers.utils.parseEther('1000'), wallets[0].address)
    await tokenB.mint(ethers.utils.parseEther('1000'), wallets[1].address)
    await tokenC.mint(ethers.utils.parseEther('1000'), wallets[2].address)
    await tokenD.mint(ethers.utils.parseEther('1000'), wallets[3].address)
    await tokenE.mint(ethers.utils.parseEther('1000'), wallets[4].address)
    await tokenA
      .connect(wallets[0])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenB
      .connect(wallets[1])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenC
      .connect(wallets[2])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenD
      .connect(wallets[3])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenE
      .connect(wallets[4])
      .approve(exchangeContract.address, ethers.utils.parseEther('1000'))

    await exchangeContract.connect(wallets[5]).setFees(5, 10000, 0, 10000)
  })

  it('fill a full order, n=1', async () => {
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

    const orderHash = await getOrderHash(makerOrder)

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[1])
        .fillOrderRoute(
          [Object.values(makerOrder)],
          [signedLeftMessage],
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
        ethers.utils.parseEther('199.9'),
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

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7 = await tokenA.balanceOf(FEE_ADDRESS)
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

    expect(balance2).to.equal(ethers.utils.parseEther('199.9'))
    expect(balance4).to.equal(ethers.utils.parseEther('100'))
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
    await expect(
      exchangeContract
        .connect(wallets[0])
        .fillOrderRoute(
          [Object.values(makerOrderOne), Object.values(makerOrderTwo)],
          [signedMessageOne, signedMessageTwo],
          fillAmount,
          false
        )
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        tokenA.address,
        ethers.utils.parseEther('199.9'),
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
        ethers.utils.parseEther('199.9'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.19999')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashTwo,
        ethers.utils.parseEther('399.8'),
        ethers.utils.parseEther('0.2')
      )

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7 = await tokenC.balanceOf(wallets[0].address)
    const balance8 = await tokenC.balanceOf(wallets[1].address)
    const balance9 = await tokenC.balanceOf(wallets[2].address)
    const balance10 = await tokenA.balanceOf(FEE_ADDRESS)
    const balance11 = await tokenB.balanceOf(FEE_ADDRESS)
    const balance12 = await tokenC.balanceOf(FEE_ADDRESS)
    const balance13 = await tokenA.balanceOf(exchangeContract.address)
    const balance14 = await tokenB.balanceOf(exchangeContract.address)
    const balance15 = await tokenC.balanceOf(exchangeContract.address)
    console.log(
      ethers.utils.formatEther(balance1),
      ethers.utils.formatEther(balance4),
      ethers.utils.formatEther(balance7)
    )
    console.log(
      ethers.utils.formatEther(balance2),
      ethers.utils.formatEther(balance5),
      ethers.utils.formatEther(balance8)
    )
    console.log(
      ethers.utils.formatEther(balance3),
      ethers.utils.formatEther(balance6),
      ethers.utils.formatEther(balance9)
    )
    console.log(
      ethers.utils.formatEther(balance10),
      ethers.utils.formatEther(balance11),
      ethers.utils.formatEther(balance12)
    )
    console.log(
      ethers.utils.formatEther(balance13),
      ethers.utils.formatEther(balance14),
      ethers.utils.formatEther(balance15)
    )

    // check address1 (user)
    expect(balance1).to.equal(ethers.utils.parseEther('900')) // mint (1000) - fillAmount (100)
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance7).to.equal(ethers.utils.parseEther('399.6001')) // 100 * 2 * 0.9995 * 2 * 0.9995

    // check address2 (mm one)
    expect(balance2).to.equal(ethers.utils.parseEther('100')) // fillAmount = mm one buy amount
    expect(balance5).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm one sell amount (200)
    expect(balance8).to.equal(ethers.utils.parseEther('0'))

    // check address3 (mm two)
    expect(balance3).to.equal(ethers.utils.parseEther('0'))
    expect(balance6).to.equal(ethers.utils.parseEther('199.9')) // fillAmount = mm two buy amount = 100 * 2 * 0.9995
    expect(balance9).to.equal(ethers.utils.parseEther('600.2')) // mint (1000) - mm two sell amount (100 * 2 * 0.9995 * 2)

    // check fees
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
    expect(balance11).to.equal(ethers.utils.parseEther('0.1')) // trade one takerAmount * 0.0005 = 100 * 2 * 0.0005
    expect(balance12).to.equal(ethers.utils.parseEther('0.1999')) // trade two takerAmount * 0.0005 = 100 * 2 * 0.9995 * 2 * 0.0005

    // nothing left in exchange contract
    expect(balance13).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('0'))
    expect(balance15).to.equal(ethers.utils.parseEther('0'))
  })

  it('fill a full order, n=3', async () => {
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
      sellToken: tokenC.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('400'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const makerOrderThree = {
      user: wallets[3].address,
      sellToken: tokenD.address,
      buyToken: tokenC.address,
      sellAmount: ethers.utils.parseEther('250'),
      buyAmount: ethers.utils.parseEther('500'),
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
    const signedMessageThree = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[3],
      makerOrderThree,
      exchangeContract.address
    )

    const orderHashOne = await getOrderHash(makerOrderOne)
    const orderHashTwo = await getOrderHash(makerOrderTwo)
    const orderHashThree = await getOrderHash(makerOrderThree)

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[0])
        .fillOrderRoute(
          [
            Object.values(makerOrderOne),
            Object.values(makerOrderTwo),
            Object.values(makerOrderThree)
          ],
          [signedMessageOne, signedMessageTwo, signedMessageThree],
          fillAmount,
          false
        )
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        tokenA.address,
        ethers.utils.parseEther('199.9'),
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
        ethers.utils.parseEther('199.9'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.19999')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashTwo,
        ethers.utils.parseEther('399.8'),
        ethers.utils.parseEther('0.2')
      )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[3].address,
        wallets[0].address,
        tokenD.address,
        tokenC.address,
        ethers.utils.parseEther('199.80005'),
        ethers.utils.parseEther('399.8'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.09995')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashThree,
        ethers.utils.parseEther('199.80005'),
        ethers.utils.parseEther('50.19995')
      )

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenA.balanceOf(wallets[3].address)

    const balance5 = await tokenB.balanceOf(wallets[0].address)
    const balance6 = await tokenB.balanceOf(wallets[1].address)
    const balance7 = await tokenB.balanceOf(wallets[2].address)
    const balance8 = await tokenB.balanceOf(wallets[3].address)

    const balance9 = await tokenC.balanceOf(wallets[0].address)
    const balance10 = await tokenC.balanceOf(wallets[1].address)
    const balance11 = await tokenC.balanceOf(wallets[2].address)
    const balance12 = await tokenC.balanceOf(wallets[3].address)

    const balance13 = await tokenD.balanceOf(wallets[0].address)
    const balance14 = await tokenD.balanceOf(wallets[1].address)
    const balance15 = await tokenD.balanceOf(wallets[2].address)
    const balance16 = await tokenD.balanceOf(wallets[3].address)

    const balance17 = await tokenA.balanceOf(FEE_ADDRESS)
    const balance18 = await tokenB.balanceOf(FEE_ADDRESS)
    const balance19 = await tokenC.balanceOf(FEE_ADDRESS)
    const balance20 = await tokenD.balanceOf(FEE_ADDRESS)

    const balance21 = await tokenA.balanceOf(exchangeContract.address)
    const balance22 = await tokenB.balanceOf(exchangeContract.address)
    const balance23 = await tokenC.balanceOf(exchangeContract.address)
    const balance24 = await tokenD.balanceOf(exchangeContract.address)

    console.log(
      ethers.utils.formatEther(balance1),
      ethers.utils.formatEther(balance5),
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance13)
    )
    console.log(
      ethers.utils.formatEther(balance2),
      ethers.utils.formatEther(balance6),
      ethers.utils.formatEther(balance10),
      ethers.utils.formatEther(balance14)
    )
    console.log(
      ethers.utils.formatEther(balance3),
      ethers.utils.formatEther(balance7),
      ethers.utils.formatEther(balance11),
      ethers.utils.formatEther(balance15)
    )
    console.log(
      ethers.utils.formatEther(balance4),
      ethers.utils.formatEther(balance8),
      ethers.utils.formatEther(balance12),
      ethers.utils.formatEther(balance16)
    )

    console.log(
      ethers.utils.formatEther(balance17),
      ethers.utils.formatEther(balance18),
      ethers.utils.formatEther(balance19),
      ethers.utils.formatEther(balance20)
    )

    console.log(
      ethers.utils.formatEther(balance21),
      ethers.utils.formatEther(balance22),
      ethers.utils.formatEther(balance23),
      ethers.utils.formatEther(balance24)
    )

    // check address1 (user)
    expect(balance1).to.equal(ethers.utils.parseEther('900')) // mint (1000) - fillAmount (100)
    expect(balance5).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance13).to.equal(ethers.utils.parseEther('199.700149975')) // 100 * 2 * 0.9995 * 2 * 0.9995 * 0.5 * 0.9995

    // check address2 (mm one)
    expect(balance2).to.equal(ethers.utils.parseEther('100')) // fillAmount = mm one buy amount
    expect(balance6).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm sell amount (200)
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('0'))

    // check address3 (mm two)
    expect(balance3).to.equal(ethers.utils.parseEther('0'))
    expect(balance7).to.equal(ethers.utils.parseEther('199.9')) // fillAmount = mm one buy amount = 100 * 2 * 0.9995
    expect(balance11).to.equal(ethers.utils.parseEther('600.2')) // mint (1000) - mm one sell amount (100 * 2 * 0.9995 * 2)
    expect(balance15).to.equal(ethers.utils.parseEther('0'))

    // check address4 (mm three)
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance8).to.equal(ethers.utils.parseEther('0'))
    expect(balance12).to.equal(ethers.utils.parseEther('399.6001')) // fillAmount = mm two buy amount = 100 * 2 * 0.9995 * 2 * 0.9995
    expect(balance16).to.equal(ethers.utils.parseEther('800.19995')) // mint (1000) - mm two sell amount (100 * 2 * 0.9995 * 2 * 0.9995 * 0.5)

    // check fees
    expect(balance17).to.equal(ethers.utils.parseEther('0'))
    expect(balance18).to.equal(ethers.utils.parseEther('0.1')) // trade one takerAmount * 0.0005 = 100 * 2 * 0.0005
    expect(balance19).to.equal(ethers.utils.parseEther('0.1999')) // trade two takerAmount * 0.0005 = 100 * 2 * 0.9995 * 2 * 0.0005
    expect(balance20).to.equal(ethers.utils.parseEther('0.099900025')) // trade three takerAmount * 0.0005 = 100 * 2 * 0.9995 * 2 * 0.9995 * 0.5 * 0.0005

    // nothing left in exchange contract
    expect(balance21).to.equal(ethers.utils.parseEther('0'))
    expect(balance22).to.equal(ethers.utils.parseEther('0'))
    expect(balance23).to.equal(ethers.utils.parseEther('0'))
    expect(balance24).to.equal(ethers.utils.parseEther('0'))
  })

  it('fill a full order, n=4', async () => {
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
      sellToken: tokenC.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('400'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const makerOrderThree = {
      user: wallets[3].address,
      sellToken: tokenD.address,
      buyToken: tokenC.address,
      sellAmount: ethers.utils.parseEther('250'),
      buyAmount: ethers.utils.parseEther('500'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const makerOrderFour = {
      user: wallets[4].address,
      sellToken: tokenE.address,
      buyToken: tokenD.address,
      sellAmount: ethers.utils.parseEther('100'),
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
    const signedMessageThree = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[3],
      makerOrderThree,
      exchangeContract.address
    )
    const signedMessageFour = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[4],
      makerOrderFour,
      exchangeContract.address
    )

    const orderHashOne = await getOrderHash(makerOrderOne)
    const orderHashTwo = await getOrderHash(makerOrderTwo)
    const orderHashThree = await getOrderHash(makerOrderThree)
    const orderHashFour = await getOrderHash(makerOrderFour)

    const fillAmount = ethers.utils.parseEther('100')
    await expect(
      exchangeContract
        .connect(wallets[0])
        .fillOrderRoute(
          [
            Object.values(makerOrderOne),
            Object.values(makerOrderTwo),
            Object.values(makerOrderThree),
            Object.values(makerOrderFour)
          ],
          [
            signedMessageOne,
            signedMessageTwo,
            signedMessageThree,
            signedMessageFour
          ],
          fillAmount,
          false
        )
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        tokenA.address,
        ethers.utils.parseEther('199.9'),
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
        ethers.utils.parseEther('199.9'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.19999')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashTwo,
        ethers.utils.parseEther('399.8'),
        ethers.utils.parseEther('0.2')
      )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[3].address,
        wallets[0].address,
        tokenD.address,
        tokenC.address,
        ethers.utils.parseEther('199.80005'),
        ethers.utils.parseEther('399.8'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.09995')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashThree,
        ethers.utils.parseEther('199.80005'),
        ethers.utils.parseEther('50.19995')
      )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[4].address,
        wallets[0].address,
        tokenE.address,
        tokenD.address,
        ethers.utils.parseEther('99.8500749875'),
        ethers.utils.parseEther('199.80005'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0.04992503749375')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(
        orderHashFour,
        ethers.utils.parseEther('99.8500749875'),
        ethers.utils.parseEther('0.1499250125')
      )

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenA.balanceOf(wallets[3].address)
    const balance5 = await tokenA.balanceOf(wallets[4].address)

    const balance6 = await tokenB.balanceOf(wallets[0].address)
    const balance7 = await tokenB.balanceOf(wallets[1].address)
    const balance8 = await tokenB.balanceOf(wallets[2].address)
    const balance9 = await tokenB.balanceOf(wallets[3].address)
    const balance10 = await tokenB.balanceOf(wallets[4].address)

    const balance11 = await tokenC.balanceOf(wallets[0].address)
    const balance12 = await tokenC.balanceOf(wallets[1].address)
    const balance13 = await tokenC.balanceOf(wallets[2].address)
    const balance14 = await tokenC.balanceOf(wallets[3].address)
    const balance15 = await tokenC.balanceOf(wallets[4].address)

    const balance16 = await tokenD.balanceOf(wallets[0].address)
    const balance17 = await tokenD.balanceOf(wallets[1].address)
    const balance18 = await tokenD.balanceOf(wallets[2].address)
    const balance19 = await tokenD.balanceOf(wallets[3].address)
    const balance20 = await tokenD.balanceOf(wallets[4].address)

    const balance21 = await tokenE.balanceOf(wallets[0].address)
    const balance22 = await tokenE.balanceOf(wallets[1].address)
    const balance23 = await tokenE.balanceOf(wallets[2].address)
    const balance24 = await tokenE.balanceOf(wallets[3].address)
    const balance25 = await tokenE.balanceOf(wallets[4].address)

    const balance26 = await tokenA.balanceOf(FEE_ADDRESS)
    const balance27 = await tokenB.balanceOf(FEE_ADDRESS)
    const balance28 = await tokenC.balanceOf(FEE_ADDRESS)
    const balance29 = await tokenD.balanceOf(FEE_ADDRESS)
    const balance30 = await tokenE.balanceOf(FEE_ADDRESS)

    const balance31 = await tokenA.balanceOf(exchangeContract.address)
    const balance32 = await tokenB.balanceOf(exchangeContract.address)
    const balance33 = await tokenC.balanceOf(exchangeContract.address)
    const balance34 = await tokenD.balanceOf(exchangeContract.address)
    const balance35 = await tokenE.balanceOf(exchangeContract.address)

    console.log(
      ethers.utils.formatEther(balance1),
      ethers.utils.formatEther(balance6),
      ethers.utils.formatEther(balance11),
      ethers.utils.formatEther(balance16),
      ethers.utils.formatEther(balance21)
    )
    console.log(
      ethers.utils.formatEther(balance2),
      ethers.utils.formatEther(balance7),
      ethers.utils.formatEther(balance12),
      ethers.utils.formatEther(balance17),
      ethers.utils.formatEther(balance22)
    )
    console.log(
      ethers.utils.formatEther(balance3),
      ethers.utils.formatEther(balance8),
      ethers.utils.formatEther(balance13),
      ethers.utils.formatEther(balance18),
      ethers.utils.formatEther(balance23)
    )
    console.log(
      ethers.utils.formatEther(balance4),
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance14),
      ethers.utils.formatEther(balance19),
      ethers.utils.formatEther(balance24)
    )
    console.log(
      ethers.utils.formatEther(balance5),
      ethers.utils.formatEther(balance10),
      ethers.utils.formatEther(balance15),
      ethers.utils.formatEther(balance20),
      ethers.utils.formatEther(balance25)
    )

    console.log(
      ethers.utils.formatEther(balance26),
      ethers.utils.formatEther(balance27),
      ethers.utils.formatEther(balance28),
      ethers.utils.formatEther(balance29),
      ethers.utils.formatEther(balance30)
    )

    console.log(
      ethers.utils.formatEther(balance31),
      ethers.utils.formatEther(balance32),
      ethers.utils.formatEther(balance33),
      ethers.utils.formatEther(balance34),
      ethers.utils.formatEther(balance35)
    )

    // check address1 (user)
    expect(balance1).to.equal(ethers.utils.parseEther('900')) // mint (1000) - fillAmount (100)
    expect(balance6).to.equal(ethers.utils.parseEther('0'))
    expect(balance11).to.equal(ethers.utils.parseEther('0'))
    expect(balance16).to.equal(ethers.utils.parseEther('0'))
    expect(balance21).to.equal(ethers.utils.parseEther('99.80014995000625')) // 100 * 2 * 0.9995 * 2 * 0.9995 * 0.5 * 0.9995 * 0.5 * 0.9995

    // check address2 (mm one)
    expect(balance2).to.equal(ethers.utils.parseEther('100')) // fillAmount = mm one buy amount
    expect(balance7).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm sell amount (200)
    expect(balance12).to.equal(ethers.utils.parseEther('0'))
    expect(balance17).to.equal(ethers.utils.parseEther('0'))
    expect(balance22).to.equal(ethers.utils.parseEther('0'))

    // check address3 (mm two)
    expect(balance3).to.equal(ethers.utils.parseEther('0'))
    expect(balance8).to.equal(ethers.utils.parseEther('199.9')) // fillAmount = mm one buy amount = 100 * 2 * 0.9995
    expect(balance13).to.equal(ethers.utils.parseEther('600.2')) // mint (1000) - mm one sell amount (100 * 2 * 0.9995 * 2)
    expect(balance18).to.equal(ethers.utils.parseEther('0'))
    expect(balance23).to.equal(ethers.utils.parseEther('0'))

    // check address4 (mm three)
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('399.6001')) // fillAmount = mm two buy amount = 100 * 2 * 0.9995 * 2 * 0.9995
    expect(balance19).to.equal(ethers.utils.parseEther('800.19995')) // mint (1000) - mm tow sell amount (100 * 2 * 0.9995 * 2 * 0.9995 * 0.5)
    expect(balance24).to.equal(ethers.utils.parseEther('0'))

    // check address5 (mm four)
    expect(balance5).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
    expect(balance15).to.equal(ethers.utils.parseEther('0'))
    expect(balance20).to.equal(ethers.utils.parseEther('199.700149975')) // fillAmount = mm three buy amount = 100 * 2 * 0.9995 * 2 * 0.9995 * 0.5 * 0.9995
    expect(balance25).to.equal(ethers.utils.parseEther('900.1499250125')) // mint (1000) - mm three sell amount (100 * 2 * 0.9995 * 2 * 0.9995 * 0.5 * 0.9995 * 0.5)

    // check fees
    expect(balance26).to.equal(ethers.utils.parseEther('0'))
    expect(balance27).to.equal(ethers.utils.parseEther('0.1')) // trade one takerAmount * 0.0005 = 100 * 2 * 0.0005
    expect(balance28).to.equal(ethers.utils.parseEther('0.1999')) // trade two takerAmount * 0.0005 = 100 * 2 * 0.9995 * 2 * 0.0005
    expect(balance29).to.equal(ethers.utils.parseEther('0.099900025')) // trade three takerAmount * 0.0005 = 100 * 2 * 0.9995 * 2 * 0.9995 * 0.5 * 0.0005
    expect(balance30).to.equal(ethers.utils.parseEther('0.04992503749375')) // trade four takerAmount * 0.0005 = 100 * 2 * 0.9995 * 2 * 0.9995 * 0.5 * 0.9995 * 0.5 * 0.0005

    // nothing left in exchange contract
    expect(balance31).to.equal(ethers.utils.parseEther('0'))
    expect(balance32).to.equal(ethers.utils.parseEther('0'))
    expect(balance33).to.equal(ethers.utils.parseEther('0'))
    expect(balance34).to.equal(ethers.utils.parseEther('0'))
    expect(balance35).to.equal(ethers.utils.parseEther('0'))
  })
})
