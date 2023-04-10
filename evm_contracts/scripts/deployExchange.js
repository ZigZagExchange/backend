const hre = require('hardhat')

async function main() {
  const Exchange = await hre.ethers.getContractFactory('ZigZagExchange')
  const weth_address = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
  const forwarder_address = "0xE3181eA3CfBD3528016FF5C71d3eA5521f414891";
  const exchange = await Exchange.deploy("ZigZag", "2.1", weth_address, forwarder_address);

  await exchange.deployed()

  console.log('Exchange deployed to:', exchange.address)
}

main()
