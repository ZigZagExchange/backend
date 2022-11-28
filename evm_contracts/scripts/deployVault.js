const hre = require('hardhat')

async function main() {
  const Vault = await hre.ethers.getContractFactory('ZigZagVault')
  const manager = "0x6f457Ce670D18FF8bda00E1B5D9654833e7D91BB";
  const vault = await Vault.deploy(manager, "ZigZag LP", "ZZLP");

  await vault.deployed()

  console.log('Vault deployed to:', vault.address)
}

main()
