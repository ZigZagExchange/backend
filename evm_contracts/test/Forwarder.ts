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
    forwarderContract = await Forwarder.deploy()
    weth = await aeWETH.deploy()
    const [owner] = await ethers.getSigners()

    for (let i = 0; i < 4; i++) {
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

    await tokenA.connect(wallets[0]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenA.connect(wallets[2]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))
    await tokenB.connect(wallets[1]).approve(exchangeContract.address, ethers.utils.parseEther('1000'))

    await weth.connect(wallets[0]).deposit({ value: ethers.utils.parseEther('0.5') })
    await weth.connect(wallets[1]).deposit({ value: ethers.utils.parseEther('0.5') })
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
    
    const calldata = iFaceExchange.encodeFunctionData('fillOrderBook', [[Object.values(makerOrderA), Object.values(makerOrderB)], [signedLeftMessageA, signedLeftMessageB], fillAmount]) 
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)    
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    await forwarderContract.connect(wallets[3]).execute([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    
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

    const calldata = iFaceExchange.encodeFunctionData(
      'fillOrderExactInput', 
      [
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      ]
    ) 
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)    
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    await forwarderContract.connect(wallets[3]).execute([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
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

  it('should execute fillOrderExactInputETH deposit', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: weth.address,
      sellAmount: ethers.utils.parseEther('200'),
      buyAmount: ethers.utils.parseEther('0.1'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )  

    const calldata = iFaceExchange.encodeFunctionData(
      'fillOrderExactInputETH', 
      [
        Object.values(makerOrder),
        signedLeftMessage,
        ethers.utils.parseEther('0.1'),
        false
      ]
    ) 
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.utils.parseEther('0.1'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract.connect(wallets[3]).execute([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature,
      { value: newRequest.value }
    )
    const res = await tx.wait()

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = balance3_before.sub(await provider.getBalance(wallets[3].address)).sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[3].address)
    const balance8 = await provider.getBalance(exchangeContract.address)
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
      ethers.utils.formatEther(balance8),
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

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
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )  

    const calldata = iFaceExchange.encodeFunctionData(
      'fillOrderExactInputETH', 
      [
        Object.values(makerOrder),
        signedLeftMessage,
        ethers.utils.parseEther('0.1'),
        false
      ]
    ) 
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.utils.parseEther('0.1'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance1_before = await provider.getBalance(wallets[1].address)
    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract.connect(wallets[3]).execute([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature,
      { value: newRequest.value.mul("2") }
    )
    const res = await tx.wait()

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = balance3_before.sub(await provider.getBalance(wallets[3].address)).sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[3].address)
    const balance7 = (await provider.getBalance(wallets[1].address)).sub(balance1_before)
    const balance8 = await provider.getBalance(exchangeContract.address)
    const balance9 = await weth.balanceOf(exchangeContract.address)
    const balance10 = await tokenA.balanceOf(exchangeContract.address)
    console.log(
      ethers.utils.formatEther(balance1),
      ethers.utils.formatEther(balance4)
    )
    console.log(
      ethers.utils.formatEther(balance2),
      ethers.utils.formatEther(balance5),
      `ETH delta: ${ethers.utils.formatEther(balance7)}`
    )
    console.log(
      ethers.utils.formatEther(balance3),
      ethers.utils.formatEther(balance6)
    )
    console.log(
      ethers.utils.formatEther(balance8),
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

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
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const calldata = iFaceExchange.encodeFunctionData(
      'fillOrderExactInputETH', 
      [
        Object.values(makerOrder),
        signedLeftMessage,
        ethers.utils.parseEther('200'),
        false
      ]
    ) 
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)    
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance1_before = await provider.getBalance(wallets[1].address)
    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract.connect(wallets[3]).execute([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    const res = await tx.wait()
    
    const balance1 = await tokenB.balanceOf(wallets[0].address)
    const balance2 = await tokenB.balanceOf(wallets[1].address)
    const balance3 = balance3_before.sub(await provider.getBalance(wallets[3].address)).sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = (await provider.getBalance(wallets[1].address)).sub(balance1_before)
    const balance6 = await weth.balanceOf(wallets[3].address)

    const balance8 = await provider.getBalance(exchangeContract.address)
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
      ethers.utils.formatEther(balance8),
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

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
      
    const calldata = iFaceExchange.encodeFunctionData(
      'fillOrderExactOutput', 
      [
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      ]
    ) 
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)    
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    await forwarderContract.connect(wallets[3]).execute([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )

    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance4 = await tokenB.balanceOf(wallets[0].address)
    const balance5 = await tokenB.balanceOf(wallets[1].address)
    console.log(
      ethers.utils.formatEther(balance1),
      ethers.utils.formatEther(balance4)
    )
    console.log(
      ethers.utils.formatEther(balance2),
      ethers.utils.formatEther(balance5)
    )
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
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    const fillAmount = ethers.utils.parseEther('200')
    const fillAmountETH = ethers.utils.parseEther('0.1')
    const calldata = iFaceExchange.encodeFunctionData(
      'fillOrderExactOutputETH', 
      [
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      ]
    ) 
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: fillAmountETH,
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)    
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract.connect(wallets[3]).execute([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature,
      { value: fillAmountETH }
    )
    const res = await tx.wait()
    
    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = balance3_before.sub(await provider.getBalance(wallets[3].address)).sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[3].address)
    const balance8 = await provider.getBalance(exchangeContract.address)
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
      ethers.utils.formatEther(balance8),
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

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
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )
    const fillAmount = ethers.utils.parseEther('200')
    const fillAmountETH = ethers.utils.parseEther('0.1')      
    const calldata = iFaceExchange.encodeFunctionData(
      'fillOrderExactOutputETH', 
      [
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      ]
    ) 
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: fillAmountETH,
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)    
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract.connect(wallets[3]).execute([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature,
      { value: fillAmountETH.mul('2') }
    )
    const res = await tx.wait()

    
    const balance1 = await tokenA.balanceOf(wallets[0].address)
    const balance2 = await tokenA.balanceOf(wallets[1].address)
    const balance3 = balance3_before.sub(await provider.getBalance(wallets[3].address)).sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = await weth.balanceOf(wallets[1].address)
    const balance6 = await weth.balanceOf(wallets[3].address)
    const balance8 = await provider.getBalance(exchangeContract.address)
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
      ethers.utils.formatEther(balance8),
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

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
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const signedLeftMessage = await signOrder(
      TESTRPC_PRIVATE_KEYS_STRINGS[0],
      makerOrder,
      exchangeContract.address
    )

    const fillAmount = ethers.utils.parseEther('0.1')

    const calldata = iFaceExchange.encodeFunctionData(
      'fillOrderExactOutputETH', 
      [
        Object.values(makerOrder),
        signedLeftMessage,
        fillAmount,
        false
      ]
    ) 
    const newRequest = {
      from: wallets[1].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[1], newRequest, forwarderContract.address)    
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    const balance1_before = await provider.getBalance(wallets[1].address)
    const balance3_before = await provider.getBalance(wallets[3].address)
    const tx = await forwarderContract.connect(wallets[3]).execute([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    const res = await tx.wait()
    
    const balance1 = await tokenB.balanceOf(wallets[0].address)
    const balance2 = await tokenB.balanceOf(wallets[1].address)
    const balance3 = balance3_before.sub(await provider.getBalance(wallets[3].address)).sub(res.cumulativeGasUsed.mul(res.effectiveGasPrice))
    const balance4 = await weth.balanceOf(wallets[0].address)
    const balance5 = (await provider.getBalance(wallets[1].address)).sub(balance1_before)
    const balance6 = await weth.balanceOf(wallets[3].address)

    const balance8 = await provider.getBalance(exchangeContract.address)
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
      ethers.utils.formatEther(balance8),
      ethers.utils.formatEther(balance9),
      ethers.utils.formatEther(balance10)
    )

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

  it('should execute cancelOrder', async () => {
    const makerOrder = {
      user: wallets[0].address,
      sellToken: weth.address,
      buyToken: tokenB.address,
      sellAmount: ethers.utils.parseEther('0.1'),
      buyAmount: ethers.utils.parseEther('200'),
      expirationTimeSeconds: ethers.BigNumber.from(
        String(Math.floor(Date.now() / 1000) + 3600)
      )
    }

    const orderHash = await getOrderHash(makerOrder, exchangeContract.address)

    const calldata = iFaceExchange.encodeFunctionData(
      'cancelOrder', 
      [
        Object.values(makerOrder)
      ]
    ) 
    const newRequest = {
      from: wallets[0].address,
      to: exchangeContract.address,
      value: ethers.BigNumber.from('0'),
      gas: ethers.BigNumber.from('1000000'),
      nonce: ethers.BigNumber.from('0'),
      data: calldata
    }
    const signature = await signReq(wallets[0], newRequest, forwarderContract.address)    
    const verifyRes = await forwarderContract.verify([
        newRequest.from,
        newRequest.to,
        newRequest.value,
        newRequest.gas,
        newRequest.nonce,
        newRequest.data
      ], 
      signature
    )
    expect(verifyRes).to.equal(true)

    expect(await forwarderContract.connect(wallets[3]).execute([
          newRequest.from,
          newRequest.to,
          newRequest.value,
          newRequest.gas,
          newRequest.nonce,
          newRequest.data
        ], 
        signature
      )
    ).to.emit(exchangeContract, 'CancelOrder').withArgs(orderHash)    
  })

})
