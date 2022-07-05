const hre = require('hardhat');

async function main () {
    const Exchange = await hre.ethers.getContractFactory("Exchange");
    const exchange = await Exchange.deploy();

    await exchange.deployed();

    console.log("Exchange deployed to:", exchange.address);
}

main()

