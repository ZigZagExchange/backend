import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, Wallet } from 'ethers'
import { TESTRPC_PRIVATE_KEYS_STRINGS } from './utils/PrivateKeyList'
import { signOrder, getOrderHash, signReq } from './utils/SignUtil'
import { Interface } from 'ethers/lib/utils'

describe('Forwarder', () => {
  let exchangeContract: Contract
  let forwarderContract: Contract
  let tokenA: Contract
  let tokenB: Contract
  let tokenC: Contract
  let tokenD: Contract
  let tokenE: Contract
  const wallets: Wallet[] = []
  let weth: Contract
  let provider: any

  let iFaceExchange: Interface

  beforeEach(async function () {
    this.timeout(30000)
    const Exchange = await ethers.getContractFactory('ZigZagExchange')
    const Token = await ethers.getContractFactory('Token')
    const Forwarder = await ethers.getContractFactory('MinimalForwarder')
    const aeWETH = await ethers.getContractFactory('aeWETH')
    provider = ethers.provider

    tokenA = await Token.deploy()
    tokenB = await Token.deploy()
    tokenC = await Token.deploy()
    tokenD = await Token.deploy()
    tokenE = await Token.deploy()
    forwarderContract = await Forwarder.deploy()
    weth = await aeWETH.deploy()
    const [owner] = await ethers.getSigners()

    for (let i = 0; i < 6; i++) {
      wallets[i] = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[i], provider)

      await owner.sendTransaction({
        to: wallets[i].address,
        value: ethers.utils.parseEther('1'), // 0.1 ether
      })
    }

    exchangeContract = await Exchange.deploy('ZigZag', '2.1', weth.address, forwarderContract.address)
    iFaceExchange = Exchange.interface

    await tokenA.mint(ethers.utils.parseEther('1000'), wallets[0].address)
    await tokenA.mint(ethers.utils.parseEther('1000'), wallets[2].address)
    await tokenB.mint(ethers.utils.parseEther('1000'), wallets[1].address)
    await tokenC.mint(ethers.utils.parseEther('1000'), wallets[2].address)
    await tokenD.mint(ethers.utils.parseEther('1000'), wallets[3].address)
    await tokenE.mint(ethers.utils.parseEther('1000'), wallets[4].address)

    await tokenA.connect(wallets[0]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenA.connect(wallets[2]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenB.connect(wallets[1]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenC.connect(wallets[2]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenD.connect(wallets[3]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenE.connect(wallets[4]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))

    await weth.connect(wallets[0]).deposit({ value: ethers.utils.parseEther('0.5') })
    await weth.connect(wallets[1]).deposit({ value: ethers.utils.parseEther('0.5') })
    await weth.connect(wallets[2]).deposit({ value: ethers.utils.parseEther('0.5') })
    await weth.connect(wallets[0]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await weth.connect(wallets[1]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await weth.connect(wallets[2]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
  })

  it('should execute fillOrderBook', async () => {
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

    const calldata = iFaceExchange.encodeFunctionData('fillOrderBook', [
      [Object.values(makerOrderA), Object.values(makerOrderB)],
      [signedLeftMessageA, signedLeftMessageB],
      fillAmount,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    await forwarderContract
      .connect(wallets[3])
      .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)

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

  it('should execute fillOrderExactInput', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderExactInput', [
      Object.values(makerOrder),
      signedLeftMessage,
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    await forwarderContract
      .connect(wallets[3])
      .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))

    expect(balance2).to.equal(ethers.utils.parseEther('200'))
    expect(balance4).to.equal(ethers.utils.parseEther('100'))
  })

  it('should execute fillOrderExactInputETH deposit', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('0.1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

    const calldata = iFaceExchange.encodeFunctionData('fillOrderExactInputETH', [
      Object.values(makerOrder),
      signedLeftMessage,
      ethers.utils.parseEther('0.1'),
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.utils.parseEther('0.1'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract
      .connect(wallets[3])
      .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature, {
        value: newRequest.value,
      })
    const res = await tx.wait()

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = balance3_before
      .sub(await provider.getBalance(wallets[3].address))
      .sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[3].address)
    const balance8 = await provider.getBalance(exchangeContract.address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenA.balanceOf(exchangeContract.address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))
    console.log(ethers.utils.formatEther(balance8), ethers.utils.formatEther(balance9), ethers.utils.formatEther(balance10))

    expect(balance1).to.equal(ethers.utils.parseEther('800')) // 1000 - 200
    expect(balance4).to.equal(ethers.utils.parseEther('0.6')) // 0.5 + 0.1

    expect(balance2).to.equal(ethers.utils.parseEther('200')) // 0 + 200
    expect(balance5).to.equal(ethers.utils.parseEther('0.5')) // 0.5 +- 0

    expect(balance3).to.equal(ethers.utils.parseEther('0.1'))
    expect(balance6).to.equal(ethers.utils.parseEther('0'))

    // exchange contract should have no ETH or WETH left over
    expect(balance8).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('should execute fillOrderExactInputETH deposit send too much ETH', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('0.1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

    const calldata = iFaceExchange.encodeFunctionData('fillOrderExactInputETH', [
      Object.values(makerOrder),
      signedLeftMessage,
      ethers.utils.parseEther('0.1'),
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.utils.parseEther('0.1'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance1_before = await provider.getBalance(wallets[1].address)
    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract
      .connect(wallets[3])
      .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature, {
        value: newRequest.value.mul('2'),
      })
    const res = await tx.wait()

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = balance3_before
      .sub(await provider.getBalance(wallets[3].address))
      .sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[3].address)
    const balance7 = (await provider.getBalance(wallets[1].address)).sub(balance1_before)
    const balance8 = await provider.getBalance(exchangeContract.address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenA.balanceOf(exchangeContract.address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5), `ETH delta: ${ethers.utils.formatEther(balance7)}`)
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))
    console.log(ethers.utils.formatEther(balance8), ethers.utils.formatEther(balance9), ethers.utils.formatEther(balance10))

    expect(balance1).to.equal(ethers.utils.parseEther('800')) // 1000 - 200
    expect(balance4).to.equal(ethers.utils.parseEther('0.6')) // 0.5 + 0.1

    expect(balance2).to.equal(ethers.utils.parseEther('200')) // 0 + 200
    expect(balance5).to.equal(ethers.utils.parseEther('0.5')) // 0.5 +- 0
    expect(balance7).to.equal(ethers.utils.parseEther('0'))

    expect(balance3).to.equal(ethers.utils.parseEther('0.1'))
    expect(balance6).to.equal(ethers.utils.parseEther('0'))

    // exchange contract should have no ETH or WETH left over
    expect(balance8).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('should execute fillOrderExactInputETH withdraw', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('0.1'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

    const calldata = iFaceExchange.encodeFunctionData('fillOrderExactInputETH', [
      Object.values(makerOrder),
      signedLeftMessage,
      ethers.utils.parseEther('200'),
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance1_before = await provider.getBalance(wallets[1].address)
    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract
      .connect(wallets[3])
      .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)
    const res = await tx.wait()

    const balance1 = await tokenB.balanceOf(wallets[0].address)
    const balance2 = await tokenB.balanceOf(wallets[1].address)
    const balance3 = balance3_before
      .sub(await provider.getBalance(wallets[3].address))
      .sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = (await provider.getBalance(wallets[1].address)).sub(balance1_before)
    const balance6 = await weth.balanceOf(wallets[3].address)

    const balance8 = await provider.getBalance(exchangeContract.address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenB.balanceOf(exchangeContract.address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))
    console.log(ethers.utils.formatEther(balance8), ethers.utils.formatEther(balance9), ethers.utils.formatEther(balance10))

    expect(balance1).to.equal(ethers.utils.parseEther('200')) // 0 + 200
    expect(balance4).to.equal(ethers.utils.parseEther('0.4')) // 0.5 - 0.1

    expect(balance2).to.equal(ethers.utils.parseEther('800')) // 1000 - 200
    expect(balance5).to.equal(ethers.utils.parseEther('0.1'))

    expect(balance3).to.equal(ethers.utils.parseEther('0'))
    expect(balance6).to.equal(ethers.utils.parseEther('0'))

    // exchange contract should have no ETH or WETH left over
    expect(balance8).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('should execute fillOrderExactOutput', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderExactOutput', [
      Object.values(makerOrder),
      signedLeftMessage,
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    await forwarderContract
      .connect(wallets[3])
      .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    expect(balance1).to.equal(ethers.utils.parseEther('900')) // 1000 - 100
    expect(balance4).to.equal(ethers.utils.parseEther('200')) // 0 + 200

    expect(balance2).to.equal(ethers.utils.parseEther('100')) // 0 + 100
    expect(balance5).to.equal(ethers.utils.parseEther('800')) // 1000 - 200
  })

  it('should execute fillOrderExactOutputETH deposit', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('0.1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
    const fillAmount = ethers.utils.parseEther('200')
    const fillAmountETH = ethers.utils.parseEther('0.1')
    const calldata = iFaceExchange.encodeFunctionData('fillOrderExactOutputETH', [
      Object.values(makerOrder),
      signedLeftMessage,
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: fillAmountETH,
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract
      .connect(wallets[3])
      .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature, {
        value: fillAmountETH,
      })
    const res = await tx.wait()

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = balance3_before
      .sub(await provider.getBalance(wallets[3].address))
      .sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[3].address)
    const balance8 = await provider.getBalance(exchangeContract.address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenA.balanceOf(exchangeContract.address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))
    console.log(ethers.utils.formatEther(balance8), ethers.utils.formatEther(balance9), ethers.utils.formatEther(balance10))

    expect(balance1).to.equal(ethers.utils.parseEther('800')) // 1000 - 200
    expect(balance4).to.equal(ethers.utils.parseEther('0.6')) // 0.5 + 0.1

    expect(balance2).to.equal(ethers.utils.parseEther('200')) // 0 + 200
    expect(balance5).to.equal(ethers.utils.parseEther('0.5')) // 0.5 +- 0

    expect(balance3).to.equal(ethers.utils.parseEther('0.1'))
    expect(balance6).to.equal(ethers.utils.parseEther('0'))

    // exchange contract should have no ETH or WETH left over
    expect(balance8).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('should execute fillOrderExactOutputETH deposit send too much ETH', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('0.1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
    const fillAmount = ethers.utils.parseEther('200')
    const fillAmountETH = ethers.utils.parseEther('0.1')
    const calldata = iFaceExchange.encodeFunctionData('fillOrderExactOutputETH', [
      Object.values(makerOrder),
      signedLeftMessage,
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: fillAmountETH,
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract
      .connect(wallets[3])
      .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature, {
        value: fillAmountETH.mul('2'),
      })
    const res = await tx.wait()

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = balance3_before
      .sub(await provider.getBalance(wallets[3].address))
      .sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[3].address)
    const balance8 = await provider.getBalance(exchangeContract.address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenA.balanceOf(exchangeContract.address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))
    console.log(ethers.utils.formatEther(balance8), ethers.utils.formatEther(balance9), ethers.utils.formatEther(balance10))

    expect(balance1).to.equal(ethers.utils.parseEther('800')) // 1000 - 200
    expect(balance4).to.equal(ethers.utils.parseEther('0.6')) // 0.5 + 0.1

    expect(balance2).to.equal(ethers.utils.parseEther('200')) // 0 + 200
    expect(balance5).to.equal(ethers.utils.parseEther('0.5')) // 0.5 +- 0

    expect(balance3).to.equal(ethers.utils.parseEther('0.1'))
    expect(balance6).to.equal(ethers.utils.parseEther('0'))

    // exchange contract should have no ETH or WETH left over
    expect(balance8).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('should execute fillOrderExactOutputETH withdraw', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('0.1'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('0.1')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderExactOutputETH', [
      Object.values(makerOrder),
      signedLeftMessage,
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance1_before = await provider.getBalance(wallets[1].address)
    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract
      .connect(wallets[3])
      .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)
    const res = await tx.wait()

    const balance1 = await tokenB.balanceOf(wallets[0].address)
    const balance2 = await tokenB.balanceOf(wallets[1].address)
    const balance3 = balance3_before
      .sub(await provider.getBalance(wallets[3].address))
      .sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = (await provider.getBalance(wallets[1].address)).sub(balance1_before)
    const balance6 = await weth.balanceOf(wallets[3].address)

    const balance8 = await provider.getBalance(exchangeContract.address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenB.balanceOf(exchangeContract.address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))
    console.log(ethers.utils.formatEther(balance8), ethers.utils.formatEther(balance9), ethers.utils.formatEther(balance10))

    expect(balance1).to.equal(ethers.utils.parseEther('200')) // 0 + 200
    expect(balance4).to.equal(ethers.utils.parseEther('0.4')) // 0.5 - 0.1

    expect(balance2).to.equal(ethers.utils.parseEther('800')) // 1000 - 200
    expect(balance5).to.equal(ethers.utils.parseEther('0.1'))

    expect(balance3).to.equal(ethers.utils.parseEther('0'))
    expect(balance6).to.equal(ethers.utils.parseEther('0'))

    // exchange contract should have no ETH or WETH left over
    expect(balance8).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('should execute fillOrderRoute, n=1', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

    const orderHash = await getOrderHash(makerOrder, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderRoute', [
      [Object.values(makerOrder)],
      [signedLeftMessage],
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    await expect(
      await forwarderContract
        .connect(wallets[5])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)
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
      .withArgs(orderHash, ethers.utils.parseEther('200'), ethers.utils.parseEther('0'))

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))

    expect(balance2).to.equal(ethers.utils.parseEther('200'))
    expect(balance4).to.equal(ethers.utils.parseEther('100'))
  })

  it('should execute fillOrderRoute, n=2', async () => {
    const makerOrderOne = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: tokenA.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const makerOrderTwo = {
      user: wallets[2].address,
      sellToken: tokenC.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('400'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedMessageOne = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrderOne, exchangeContract.address)
    const signedMessageTwo = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderTwo, exchangeContract.address)
    const orderHashOne = await getOrderHash(makerOrderOne, exchangeContract.address)
    const orderHashTwo = await getOrderHash(makerOrderTwo, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderRoute', [
      [Object.values(makerOrderOne), Object.values(makerOrderTwo)],
      [signedMessageOne, signedMessageTwo],
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[0].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[0], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    await expect(
      await forwarderContract
        .connect(wallets[5])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        tokenA.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('100')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashOne, ethers.utils.parseEther('200'), ethers.utils.parseEther('0'))
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[2].address,
        wallets[0].address,
        tokenC.address,
        tokenB.address,
        ethers.utils.parseEther('400'),
        ethers.utils.parseEther('200')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashTwo, ethers.utils.parseEther('400'), ethers.utils.parseEther('0'))

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7 = await tokenC.balanceOf(wallets[0].address)
    const balance8 = await tokenC.balanceOf(wallets[1].address)
    const balance9 = await tokenC.balanceOf(wallets[2].address)
    const balance13 = await tokenA.balanceOf(exchangeContract.address)
    const balance14 = await tokenB.balanceOf(exchangeContract.address)
    const balance15 = await tokenC.balanceOf(exchangeContract.address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4), ethers.utils.formatEther(balance7))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5), ethers.utils.formatEther(balance8))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6), ethers.utils.formatEther(balance9))
    console.log(ethers.utils.formatEther(balance13), ethers.utils.formatEther(balance14), ethers.utils.formatEther(balance15))

    // check address1 (user)
    expect(balance1).to.equal(ethers.utils.parseEther('900')) // mint (1000) - fillAmount (100)
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance7).to.equal(ethers.utils.parseEther('400')) // 100 * 2 * 2

    // check address2 (mm one)
    expect(balance2).to.equal(ethers.utils.parseEther('100')) // fillAmount = mm one buy amount
    expect(balance5).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm one sell amount (200)
    expect(balance8).to.equal(ethers.utils.parseEther('0'))

    // check address3 (mm two)
    expect(balance3).to.equal(ethers.utils.parseEther('1000')) // default
    expect(balance6).to.equal(ethers.utils.parseEther('200')) // fillAmount = mm two buy amount = 100 * 2
    expect(balance9).to.equal(ethers.utils.parseEther('600')) // mint (1000) - mm two sell amount (100 * 2 * 2)

    // nothing left in exchange contract
    expect(balance13).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('0'))
    expect(balance15).to.equal(ethers.utils.parseEther('0'))
  })

  it('should execute fillOrderRoute, n=3', async () => {
    const makerOrderOne = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: tokenA.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const makerOrderTwo = {
      user: wallets[2].address,
      sellToken: tokenC.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('400'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const makerOrderThree = {
      user: wallets[3].address,
      sellToken: tokenD.address,
      buyToken: tokenC.address,
      sellAmount: ethers.utils.parseEther('250'),
      buyAmount: ethers.utils.parseEther('500'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedMessageOne = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrderOne, exchangeContract.address)
    const signedMessageTwo = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderTwo, exchangeContract.address)
    const signedMessageThree = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[3], makerOrderThree, exchangeContract.address)

    const orderHashOne = await getOrderHash(makerOrderOne, exchangeContract.address)
    const orderHashTwo = await getOrderHash(makerOrderTwo, exchangeContract.address)
    const orderHashThree = await getOrderHash(makerOrderThree, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderRoute', [
      [Object.values(makerOrderOne), Object.values(makerOrderTwo), Object.values(makerOrderThree)],
      [signedMessageOne, signedMessageTwo, signedMessageThree],
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[0].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[0], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    await expect(
      await forwarderContract
        .connect(wallets[5])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        tokenA.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('100')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashOne, ethers.utils.parseEther('200'), ethers.utils.parseEther('0'))
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[2].address,
        wallets[0].address,
        tokenC.address,
        tokenB.address,
        ethers.utils.parseEther('400'),
        ethers.utils.parseEther('200')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashTwo, ethers.utils.parseEther('400'), ethers.utils.parseEther('0'))
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[3].address,
        wallets[0].address,
        tokenD.address,
        tokenC.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('400')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashThree, ethers.utils.parseEther('200'), ethers.utils.parseEther('50'))

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
      ethers.utils.formatEther(balance21),
      ethers.utils.formatEther(balance22),
      ethers.utils.formatEther(balance23),
      ethers.utils.formatEther(balance24)
    )

    // check address1 (user)
    expect(balance1).to.equal(ethers.utils.parseEther('900')) // mint (1000) - fillAmount (100)
    expect(balance5).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance13).to.equal(ethers.utils.parseEther('200')) // 100 * 2 * 2 * 0.5

    // check address2 (mm one)
    expect(balance2).to.equal(ethers.utils.parseEther('100')) // fillAmount = mm one buy amount
    expect(balance6).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm sell amount (200)
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('0'))

    // check address3 (mm two)
    expect(balance3).to.equal(ethers.utils.parseEther('1000')) // default
    expect(balance7).to.equal(ethers.utils.parseEther('200')) // fillAmount = mm one buy amount = 100 * 2
    expect(balance11).to.equal(ethers.utils.parseEther('600')) // mint (1000) - mm one sell amount (100 * 2 * 2)
    expect(balance15).to.equal(ethers.utils.parseEther('0'))

    // check address4 (mm three)
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance8).to.equal(ethers.utils.parseEther('0'))
    expect(balance12).to.equal(ethers.utils.parseEther('400')) // fillAmount = mm two buy amount = 100 * 2 * 2
    expect(balance16).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm two sell amount (100 * 2 * 2 * 0.5)

    // nothing left in exchange contract
    expect(balance21).to.equal(ethers.utils.parseEther('0'))
    expect(balance22).to.equal(ethers.utils.parseEther('0'))
    expect(balance23).to.equal(ethers.utils.parseEther('0'))
    expect(balance24).to.equal(ethers.utils.parseEther('0'))
  })

  it('should execute fillOrderRoute, n=4', async () => {
    const makerOrderOne = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: tokenA.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('100'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const makerOrderTwo = {
      user: wallets[2].address,
      sellToken: tokenC.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('400'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const makerOrderThree = {
      user: wallets[3].address,
      sellToken: tokenD.address,
      buyToken: tokenC.address,
      sellAmount: ethers.utils.parseEther('250'),
      buyAmount: ethers.utils.parseEther('500'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const makerOrderFour = {
      user: wallets[4].address,
      sellToken: tokenE.address,
      buyToken: tokenD.address,
      sellAmount: ethers.utils.parseEther('100'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedMessageOne = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrderOne, exchangeContract.address)
    const signedMessageTwo = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderTwo, exchangeContract.address)
    const signedMessageThree = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[3], makerOrderThree, exchangeContract.address)
    const signedMessageFour = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[4], makerOrderFour, exchangeContract.address)

    const orderHashOne = await getOrderHash(makerOrderOne, exchangeContract.address)
    const orderHashTwo = await getOrderHash(makerOrderTwo, exchangeContract.address)
    const orderHashThree = await getOrderHash(makerOrderThree, exchangeContract.address)
    const orderHashFour = await getOrderHash(makerOrderFour, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('100')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderRoute', [
      [Object.values(makerOrderOne), Object.values(makerOrderTwo), Object.values(makerOrderThree), Object.values(makerOrderFour)],
      [signedMessageOne, signedMessageTwo, signedMessageThree, signedMessageFour],
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[0].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[0], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    await expect(
      await forwarderContract
        .connect(wallets[5])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        tokenA.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('100')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashOne, ethers.utils.parseEther('200'), ethers.utils.parseEther('0'))
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[2].address,
        wallets[0].address,
        tokenC.address,
        tokenB.address,
        ethers.utils.parseEther('400'),
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('0'),
        ethers.utils.parseEther('0')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashTwo, ethers.utils.parseEther('400'), ethers.utils.parseEther('0'))
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[3].address,
        wallets[0].address,
        tokenD.address,
        tokenC.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('400')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashThree, ethers.utils.parseEther('200'), ethers.utils.parseEther('50'))
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[4].address,
        wallets[0].address,
        tokenE.address,
        tokenD.address,
        ethers.utils.parseEther('100'),
        ethers.utils.parseEther('200')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashFour, ethers.utils.parseEther('100'), ethers.utils.parseEther('0'))

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
    expect(balance21).to.equal(ethers.utils.parseEther('100')) // 100 * 2 * 2 * 0.5 * 0.5

    // check address2 (mm one)
    expect(balance2).to.equal(ethers.utils.parseEther('100')) // fillAmount = mm one buy amount
    expect(balance7).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm sell amount (200)
    expect(balance12).to.equal(ethers.utils.parseEther('0'))
    expect(balance17).to.equal(ethers.utils.parseEther('0'))
    expect(balance22).to.equal(ethers.utils.parseEther('0'))

    // check address3 (mm two)
    expect(balance3).to.equal(ethers.utils.parseEther('1000')) // default
    expect(balance8).to.equal(ethers.utils.parseEther('200')) // fillAmount = mm one buy amount = 100 * 2
    expect(balance13).to.equal(ethers.utils.parseEther('600')) // mint (1000) - mm one sell amount (100 * 2 * 2)
    expect(balance18).to.equal(ethers.utils.parseEther('0'))
    expect(balance23).to.equal(ethers.utils.parseEther('0'))

    // check address4 (mm three)
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('400')) // fillAmount = mm two buy amount = 100 * 2 * 2
    expect(balance19).to.equal(ethers.utils.parseEther('800')) // mint (1000) - mm tow sell amount (100 * 2 * 2 * 0.5)
    expect(balance24).to.equal(ethers.utils.parseEther('0'))

    // check address5 (mm four)
    expect(balance5).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
    expect(balance15).to.equal(ethers.utils.parseEther('0'))
    expect(balance20).to.equal(ethers.utils.parseEther('200')) // fillAmount = mm three buy amount = 100 * 2 * 2 * 0.5
    expect(balance25).to.equal(ethers.utils.parseEther('900')) // mint (1000) - mm three sell amount (100 * 2 * 2 * 0.5 * 0.5)

    // nothing left in exchange contract
    expect(balance31).to.equal(ethers.utils.parseEther('0'))
    expect(balance32).to.equal(ethers.utils.parseEther('0'))
    expect(balance33).to.equal(ethers.utils.parseEther('0'))
    expect(balance34).to.equal(ethers.utils.parseEther('0'))
    expect(balance35).to.equal(ethers.utils.parseEther('0'))
  })

  it('fill a full order fillOrderRouteETH deposit, n=1', async () => {
    const makerOrder = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('0.2'),
      buyAmount: ethers.utils.parseEther('0.1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrder, exchangeContract.address)
    const orderHash = await getOrderHash(makerOrder, exchangeContract.address)

    const opBefore = await provider.getBalance(wallets[5].address)
    const balance3Before = await provider.getBalance(wallets[0].address)
    const fillAmount = ethers.utils.parseEther('0.1')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderRouteETH', [
      [Object.values(makerOrder)],
      [signedLeftMessage],
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[0].address,
      to: exchangeContract.address,
      value: fillAmount,
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[0], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)
    let tx
    await expect(
      (tx = forwarderContract
        .connect(wallets[5])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature, {
          value: fillAmount,
        }))
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[1].address,
        weth.address,
        tokenB.address,
        ethers.utils.parseEther('0.2'),
        ethers.utils.parseEther('0.1')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHash, ethers.utils.parseEther('0.2'), ethers.utils.parseEther('0'))

    const res = await (await tx).wait()

    const opAfter = (await provider.getBalance(wallets[5].address)).sub(opBefore).add(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance1 = await tokenB.balanceOf(wallets[0].address)
    const balance2 = await tokenB.balanceOf(wallets[1].address)
    const balance3 = (await provider.getBalance(wallets[0].address)).sub(balance3Before)
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenB.balanceOf(exchangeContract.address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    console.log(ethers.utils.formatEther(balance9), ethers.utils.formatEther(balance10))

    // check op
    expect(opAfter).to.equal(ethers.utils.parseEther('-0.1')) // delta = 0 - fillamount(0.1)

    // user
    expect(balance1).to.equal(ethers.utils.parseEther('0.2')) // fillAmount (0.1) * price (2)
    expect(balance3).to.equal(ethers.utils.parseEther('0')) // delta = 0
    expect(balance4).to.equal(ethers.utils.parseEther('0.5')) // user has inital weth

    // mm
    expect(balance2).to.equal(ethers.utils.parseEther('999.8')) // mint (1000) - fillAmount (0.1) * price (2)
    expect(balance5).to.equal(ethers.utils.parseEther('0.6')) // = inital weth + fillAmount(0.1)

    // exchange contract should have no ETH or WETH left over
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('fill a full order fillOrderRouteETH deposit, n=2', async () => {
    const makerOrderOne = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('0.2'),
      buyAmount: ethers.utils.parseEther('0.1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const makerOrderTwo = {
      user: wallets[2].address,
      sellToken: tokenC.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('0.4'),
      buyAmount: ethers.utils.parseEther('0.2'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedMessageOne = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrderOne, exchangeContract.address)
    const signedMessageTwo = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderTwo, exchangeContract.address)
    const orderHashOne = await getOrderHash(makerOrderOne, exchangeContract.address)
    const orderHashTwo = await getOrderHash(makerOrderTwo, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('0.1')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderRouteETH', [
      [Object.values(makerOrderOne), Object.values(makerOrderTwo)],
      [signedMessageOne, signedMessageTwo],
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[0].address,
      to: exchangeContract.address,
      value: fillAmount,
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[0], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    const opBefore = await provider.getBalance(wallets[5].address)
    const balance1_2Before = await provider.getBalance(wallets[0].address)
    const balance2_2Before = await provider.getBalance(wallets[1].address)
    const balance3_2Before = await provider.getBalance(wallets[2].address)
    const balance13_2Before = await provider.getBalance(exchangeContract.address)

    let tx
    await expect(
      (tx = forwarderContract
        .connect(wallets[5])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature, {
          value: fillAmount,
        }))
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        weth.address,
        ethers.utils.parseEther('0.2'),
        ethers.utils.parseEther('0.1')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashOne, ethers.utils.parseEther('0.2'), ethers.utils.parseEther('0'))
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[2].address,
        wallets[0].address,
        tokenC.address,
        tokenB.address,
        ethers.utils.parseEther('0.4'),
        ethers.utils.parseEther('0.2')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashTwo, ethers.utils.parseEther('0.4'), ethers.utils.parseEther('0'))
    const res = await (await tx).wait()

    const opAfter = (await provider.getBalance(wallets[5].address)).sub(opBefore).add(res.cumulativeGasUsed.mul(res.effectiveGasPrice))

    const balance1_1 = await weth.balanceOf(wallets[0].address)
    // remove fee impact
    const balance1_2 = (await provider.getBalance(wallets[0].address)).sub(balance1_2Before)
    const balance2_1 = await weth.balanceOf(wallets[1].address)
    const balance2_2 = (await provider.getBalance(wallets[1].address)).sub(balance2_2Before)
    const balance3_1 = await weth.balanceOf(wallets[2].address)
    const balance3_2 = (await provider.getBalance(wallets[2].address)).sub(balance3_2Before)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7 = await tokenC.balanceOf(wallets[0].address)
    const balance8 = await tokenC.balanceOf(wallets[1].address)
    const balance9 = await tokenC.balanceOf(wallets[2].address)
    const balance13_1 = await weth.balanceOf(exchangeContract.address)
    const balance13_2 = (await provider.getBalance(exchangeContract.address)).sub(balance13_2Before)
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

    // check op
    expect(opAfter).to.equal(ethers.utils.parseEther('-0.1')) // delta = 0 - fillamount(0.1)

    // check address1 (user)
    expect(balance1_1).to.equal(ethers.utils.parseEther('0.5')) // user has inital weth
    expect(balance1_2).to.equal(ethers.utils.parseEther('0')) // delta = 0 dont use user eth
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance7).to.equal(ethers.utils.parseEther('0.4')) // 0.1 * 2 * 2

    // check address2 (mm one)
    expect(balance2_1).to.equal(ethers.utils.parseEther('0.6')) // fillAmount = inital weth + mm one buy amount
    expect(balance2_2).to.equal(ethers.utils.parseEther('0')) // mm one no eth
    expect(balance5).to.equal(ethers.utils.parseEther('999.8')) // mint (1000) - mm sell amount (0.2)
    expect(balance8).to.equal(ethers.utils.parseEther('0'))

    // check address3 (mm two)
    expect(balance3_1).to.equal(ethers.utils.parseEther('0.5')) // inital weth
    expect(balance3_2).to.equal(ethers.utils.parseEther('0'))
    expect(balance6).to.equal(ethers.utils.parseEther('0.2')) // fillAmount = mm one buy amount = 0.1 * 2
    expect(balance9).to.equal(ethers.utils.parseEther('999.6')) // mint (1000) - mm one sell amount (0.1 * 2 * 2)

    // nothing left in exchange contract
    expect(balance13_1).to.equal(ethers.utils.parseEther('0'))
    expect(balance13_2).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('0'))
    expect(balance15).to.equal(ethers.utils.parseEther('0'))

    console.log('GAS FEE: ', ethers.utils.formatEther(res.cumulativeGasUsed.mul(res.effectiveGasPrice)))
  })

  it('fill a full order fillOrderRouteETH deposit send too much ETH, n=2', async () => {
    const makerOrderOne = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('0.2'),
      buyAmount: ethers.utils.parseEther('0.1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const makerOrderTwo = {
      user: wallets[2].address,
      sellToken: tokenC.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('0.4'),
      buyAmount: ethers.utils.parseEther('0.2'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedMessageOne = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrderOne, exchangeContract.address)
    const signedMessageTwo = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderTwo, exchangeContract.address)
    const orderHashOne = await getOrderHash(makerOrderOne, exchangeContract.address)
    const orderHashTwo = await getOrderHash(makerOrderTwo, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('0.1')

    const calldata = iFaceExchange.encodeFunctionData('fillOrderRouteETH', [
      [Object.values(makerOrderOne), Object.values(makerOrderTwo)],
      [signedMessageOne, signedMessageTwo],
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[0].address,
      to: exchangeContract.address,
      value: fillAmount,
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[0], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    const opBefore = await provider.getBalance(wallets[5].address)
    const balance1_2Before = await provider.getBalance(wallets[0].address)
    const balance2_2Before = await provider.getBalance(wallets[1].address)
    const balance3_2Before = await provider.getBalance(wallets[2].address)
    const balance13_2Before = await provider.getBalance(exchangeContract.address)

    let tx
    await expect(
      (tx = forwarderContract
        .connect(wallets[5])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature, {
          value: fillAmount.mul(2),
        }))
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        tokenB.address,
        weth.address,
        ethers.utils.parseEther('0.2'),
        ethers.utils.parseEther('0.1')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashOne, ethers.utils.parseEther('0.2'), ethers.utils.parseEther('0'))
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[2].address,
        wallets[0].address,
        tokenC.address,
        tokenB.address,
        ethers.utils.parseEther('0.4'),
        ethers.utils.parseEther('0.2')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashTwo, ethers.utils.parseEther('0.4'), ethers.utils.parseEther('0'))
    const res = await (await tx).wait()

    const opAfter = (await provider.getBalance(wallets[5].address)).sub(opBefore).add(res.cumulativeGasUsed.mul(res.effectiveGasPrice))

    const balance1_1 = await weth.balanceOf(wallets[0].address)
    // remove fee impact
    const balance1_2 = (await provider.getBalance(wallets[0].address)).sub(balance1_2Before)
    const balance2_1 = await weth.balanceOf(wallets[1].address)
    const balance2_2 = (await provider.getBalance(wallets[1].address)).sub(balance2_2Before)
    const balance3_1 = await weth.balanceOf(wallets[2].address)
    const balance3_2 = (await provider.getBalance(wallets[2].address)).sub(balance3_2Before)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7 = await tokenC.balanceOf(wallets[0].address)
    const balance8 = await tokenC.balanceOf(wallets[1].address)
    const balance9 = await tokenC.balanceOf(wallets[2].address)
    const balance13_1 = await weth.balanceOf(exchangeContract.address)
    const balance13_2 = (await provider.getBalance(exchangeContract.address)).sub(balance13_2Before)
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

    // check op
    expect(opAfter).to.equal(ethers.utils.parseEther('-0.1')) // delta = 0 - fillamount(0.1)

    // check address1 (user)
    expect(balance1_1).to.equal(ethers.utils.parseEther('0.5')) // user has inital weth
    expect(balance1_2).to.equal(ethers.utils.parseEther('0')) // delta = 0 dont use user eth
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance7).to.equal(ethers.utils.parseEther('0.4')) // 0.1 * 2 * 2

    // check address2 (mm one)
    expect(balance2_1).to.equal(ethers.utils.parseEther('0.6')) // fillAmount = inital weth + mm one buy amount
    expect(balance2_2).to.equal(ethers.utils.parseEther('0')) // mm one no eth
    expect(balance5).to.equal(ethers.utils.parseEther('999.8')) // mint (1000) - mm sell amount (0.2)
    expect(balance8).to.equal(ethers.utils.parseEther('0'))

    // check address3 (mm two)
    expect(balance3_1).to.equal(ethers.utils.parseEther('0.5')) // inital weth
    expect(balance3_2).to.equal(ethers.utils.parseEther('0'))
    expect(balance6).to.equal(ethers.utils.parseEther('0.2')) // fillAmount = mm one buy amount = 0.1 * 2
    expect(balance9).to.equal(ethers.utils.parseEther('999.6')) // mint (1000) - mm one sell amount (0.1 * 2 * 2)

    // nothing left in exchange contract
    expect(balance13_1).to.equal(ethers.utils.parseEther('0'))
    expect(balance13_2).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('0'))
    expect(balance15).to.equal(ethers.utils.parseEther('0'))

    console.log('GAS FEE: ', ethers.utils.formatEther(res.cumulativeGasUsed.mul(res.effectiveGasPrice)))
  })

  it('fill a full order fillOrderRouteETH withdraw, n=1', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('0.1'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

    const calldata = iFaceExchange.encodeFunctionData('fillOrderRouteETH', [
      [Object.values(makerOrder)],
      [signedLeftMessage],
      ethers.utils.parseEther('200'),
      false,
    ])
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }

    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    const orderHash = await getOrderHash(makerOrder, exchangeContract.address)
    const balance1_before = await provider.getBalance(wallets[1].address)
    const balance3_before = await provider.getBalance(wallets[3].address)

    let tx
    await expect(
      (tx = forwarderContract
        .connect(wallets[5])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature))
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[0].address,
        weth.address,
        tokenA.address,
        ethers.utils.parseEther('200'),
        ethers.utils.parseEther('0.1')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHash, ethers.utils.parseEther('0.1'), ethers.utils.parseEther('0'))
    const res = await (await tx).wait()

    const balance1 = await tokenB.balanceOf(wallets[0].address)
    const balance2 = await tokenB.balanceOf(wallets[1].address)
    const balance3 = balance3_before.sub(await provider.getBalance(wallets[3].address))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = (await provider.getBalance(wallets[1].address)).sub(balance1_before)
    const balance6 = await weth.balanceOf(wallets[3].address)

    const balance8 = await provider.getBalance(exchangeContract.address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenB.balanceOf(exchangeContract.address)
    console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4))
    console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5))
    console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6))
    console.log(ethers.utils.formatEther(balance8), ethers.utils.formatEther(balance9), ethers.utils.formatEther(balance10))

    expect(balance1).to.equal(ethers.utils.parseEther('200')) // 0 + 200
    expect(balance4).to.equal(ethers.utils.parseEther('0.4')) // 0.5 - 0.1

    expect(balance2).to.equal(ethers.utils.parseEther('800')) // 1000 - 200
    expect(balance5).to.equal(ethers.utils.parseEther('0.1'))

    expect(balance3).to.equal(ethers.utils.parseEther('0'))
    expect(balance6).to.equal(ethers.utils.parseEther('0'))

    // exchange contract should have no ETH or WETH left over
    expect(balance8).to.equal(ethers.utils.parseEther('0'))
    expect(balance9).to.equal(ethers.utils.parseEther('0'))
    expect(balance10).to.equal(ethers.utils.parseEther('0'))
  })

  it('fill a full order fillOrderRouteETH withdraw, n=2', async () => {
    const makerOrderOne = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: tokenA.address,
      sellAmount: ethers.utils.parseEther('0.2'),
      buyAmount: ethers.utils.parseEther('0.1'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const makerOrderTwo = {
      user: wallets[2].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('0.4'),
      buyAmount: ethers.utils.parseEther('0.2'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const signedMessageOne = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrderOne, exchangeContract.address)
    const signedMessageTwo = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrderTwo, exchangeContract.address)
    const orderHashOne = await getOrderHash(makerOrderOne, exchangeContract.address)
    const orderHashTwo = await getOrderHash(makerOrderTwo, exchangeContract.address)

    const fillAmount = ethers.utils.parseEther('0.1')
    const balance7_2Before = await provider.getBalance(wallets[0].address)
    const balance8_2Before = await provider.getBalance(wallets[1].address)
    const balance9_2Before = await provider.getBalance(wallets[2].address)
    const balance15_2Before = await provider.getBalance(exchangeContract.address)

    const calldata = iFaceExchange.encodeFunctionData('fillOrderRouteETH', [
      [Object.values(makerOrderOne), Object.values(makerOrderTwo)],
      [signedMessageOne, signedMessageTwo],
      fillAmount,
      false,
    ])
    const newRequest = {
      from: wallets[0].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[0], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    let tx
    await expect(
      (tx = forwarderContract
        .connect(wallets[5])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature))
    )
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[0].address,
        wallets[2].address,
        tokenB.address,
        tokenA.address,
        ethers.utils.parseEther('0.2'),
        ethers.utils.parseEther('0.1')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashOne, ethers.utils.parseEther('0.2'), ethers.utils.parseEther('0'))
      .to.emit(exchangeContract, 'Swap')
      .withArgs(
        wallets[1].address,
        wallets[2].address,
        weth.address,
        tokenB.address,
        ethers.utils.parseEther('0.4'),
        ethers.utils.parseEther('0.2')
      )
      .to.emit(exchangeContract, 'OrderStatus')
      .withArgs(orderHashTwo, ethers.utils.parseEther('0.4'), ethers.utils.parseEther('0'))

    const res = await (await tx).wait()

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = await tokenA.balanceOf(wallets[2].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    const balance6 = await tokenB.balanceOf(wallets[2].address)
    const balance7_1 = await weth.balanceOf(wallets[0].address)
    // remove fee impact
    const balance7_2 = (await provider.getBalance(wallets[0].address)).sub(balance7_2Before)
    const balance8_1 = await weth.balanceOf(wallets[1].address)
    const balance8_2 = (await provider.getBalance(wallets[1].address)).sub(balance8_2Before)
    const balance9_1 = await weth.balanceOf(wallets[2].address)
    const balance9_2 = (await provider.getBalance(wallets[2].address)).sub(balance9_2Before)
    const balance13 = await weth.balanceOf(exchangeContract.address)
    const balance14 = await tokenB.balanceOf(exchangeContract.address)
    const balance15_1 = await weth.balanceOf(exchangeContract.address)
    const balance15_2 = (await provider.getBalance(exchangeContract.address)).sub(balance15_2Before)
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
    expect(balance1).to.equal(ethers.utils.parseEther('999.9')) // mint (1000) - fillAmount (0.1)
    expect(balance4).to.equal(ethers.utils.parseEther('0'))
    expect(balance7_1).to.equal(ethers.utils.parseEther('0.5')) // inital weth
    expect(balance7_2).to.equal(ethers.utils.parseEther('0.4')) // delta = 0.1 * 2 * 2

    // check address2 (mm one)
    expect(balance2).to.equal(ethers.utils.parseEther('0.1')) // fillAmount = mm one buy amount
    expect(balance5).to.equal(ethers.utils.parseEther('999.8')) // mint (1000) - mm sell amount (0.2)
    expect(balance8_1).to.equal(ethers.utils.parseEther('0.5')) // inital weth
    expect(balance8_2).to.equal(ethers.utils.parseEther('0')) // mm one no eth

    // check address3 (mm two)
    expect(balance3).to.equal(ethers.utils.parseEther('1000')) // inital token
    expect(balance6).to.equal(ethers.utils.parseEther('0.2')) // fillAmount = mm one buy amount = 0.1 * 2
    expect(balance9_1).to.equal(ethers.utils.parseEther('0.1')) // mint (0.5) - mm one sell amount (0.1 * 2 * 2)
    expect(balance9_2).to.equal(ethers.utils.parseEther('0')) // mm two no eth

    // nothing left in exchange contract
    expect(balance13).to.equal(ethers.utils.parseEther('0'))
    expect(balance14).to.equal(ethers.utils.parseEther('0'))
    expect(balance15_1).to.equal(ethers.utils.parseEther('0'))
    expect(balance15_2).to.equal(ethers.utils.parseEther('0'))

    console.log('GAS FEE: ', ethers.utils.formatEther(res.cumulativeGasUsed.mul(res.effectiveGasPrice)))
  })

  it('should execute cancelOrder', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('0.1'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
    }

    const orderHash = await getOrderHash(makerOrder, exchangeContract.address)

    const calldata = iFaceExchange.encodeFunctionData('cancelOrder', [Object.values(makerOrder)])
    const newRequest = {
      from: wallets[0].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata,
    }
    const signature = await signReq(wallets[0], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify(
      [newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data],
      signature
    )
    expect(verifyRes).to.equal(true)

    expect(
      await forwarderContract
        .connect(wallets[3])
        .execute([newRequest.from, newRequest.to, newRequest.value, newRequest.gas, newRequest.nonce, newRequest.data], signature)
    )
      .to.emit(exchangeContract, 'CancelOrder')
      .withArgs(orderHash)
  })
})
