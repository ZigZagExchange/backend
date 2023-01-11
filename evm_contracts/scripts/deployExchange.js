const hre = require('hardhat')

async function main() {
  const Exchange = await hre.ethers.getContractFactory('ZigZagExchange')
  const fee_address = "0xF4BBA1e2a5024a2754225b981e9A0DB7d2c33EE9";
  const weth_address = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
  const exchange = await Exchange.deploy("ZigZag", "2.1", fee_address, weth_address);

  await exchange.deployed()

  console.log('Exchange deployed to:', exchange.address)
}

main()
