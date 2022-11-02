import { task } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";

task("accounts", "Prints the list of accounts", async (args, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(await account.address);
  }
});
/**
 * @type import('hardhat/config').HardhatUserConfig
 */
export default {
  solidity: "0.8.10",
  settings: {
    optimizer: {
      enabled: true,
      runs: 1000,
    },
  },
  networks: {
      arbitrum: {
        url: "https://arb1.arbitrum.io/rpc",
        accounts: []
      },
      arbitrumGoerli: {
        url: "https://goerli-rollup.arbitrum.io/rpc",
        accounts: []
      }
  }
}
