import { ethers } from "hardhat";
import { expect } from "chai";
import { TESTRPC_PRIVATE_KEYS_STRINGS } from "./utils/PrivateKeyList"
import { signOrder } from "./utils/SignUtil"
import { Contract, Wallet } from "ethers";

describe("Vault", function () {

    let exchangeContract: Contract;
    let vaultContract: Contract;
    let tokenA: Contract;
    let tokenB: Contract;
    let wallets: Wallet[] = [];
    let FEE_ADDRESS: string;
    let manager: any;

    beforeEach(async function () {
        this.timeout(30000) 
        const Exchange = await ethers.getContractFactory("ZigZagExchange");
        const Vault = await ethers.getContractFactory("ZigZagVault");
        const Token = await ethers.getContractFactory("Token");
        const provider = ethers.provider;

        tokenA = await Token.deploy();
        tokenB = await Token.deploy();
        let [owner] = await ethers.getSigners();

        for (let i = 0; i < 4; i++) {
            wallets[i] = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[i], provider)

            await owner.sendTransaction({
                to: wallets[i].address,
                value: ethers.utils.parseEther("1") // 1 ether
            })
        }

        manager = wallets[2];
        FEE_ADDRESS = wallets[3].address;
        exchangeContract = await Exchange.deploy("ZigZag", "2.0", FEE_ADDRESS);
        vaultContract = await Vault.deploy(manager.address, "ZigZag LP 1", "ZZLP1");

        await tokenA.mint(ethers.utils.parseEther("10000"), wallets[0].address);
        await tokenB.mint(ethers.utils.parseEther("10000"), vaultContract.address);
        await tokenA.connect(wallets[0]).approve(exchangeContract.address, ethers.utils.parseEther("10000"));
        await vaultContract.connect(manager).approveToken(tokenB.address, exchangeContract.address, ethers.utils.parseEther("10000"));

        //await exchangeContract.connect(wallets[3]).setFees(5, 10000, 0, 10000);

    });

    it("Should allow manager to sign orders", async function () {
        const makerOrder = {
            user: vaultContract.address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("1");
        await exchangeContract.connect(wallets[0]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)
    });

    it("Non-manager cannot sign orders", async function () {
        const makerOrder = {
            user: vaultContract.address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("1");
        await expect(exchangeContract.connect(wallets[0]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)).to.be.revertedWith("invalid maker signature");
    });

    it("Non-manager cannot sign limit orders", async function () {
        const makerOrder = {
            user: vaultContract.address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const takerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("1"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], takerOrder, exchangeContract.address)

        await expect(exchangeContract.connect(wallets[0]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage))
          .to.be.revertedWith("invalid maker signature");
    });

    it("Vault limit order", async function () {
        const makerOrder = {
            user: vaultContract.address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const takerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("1"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], takerOrder, exchangeContract.address)

        await exchangeContract.connect(wallets[0]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage);
    });

    it("Vault mint LP tokens", async function () {
        await vaultContract.connect(wallets[2]).mintLPToken(ethers.utils.parseEther("100"));
    });

    it("Non-manager cannot mint LP tokens", async function () {
        await expect(vaultContract.connect(wallets[1]).mintLPToken(ethers.utils.parseEther("100"))).to.be.revertedWith("only manager can mint LP tokens");
    });

    it("Vault mint and burn LP tokens", async function () {
        await vaultContract.connect(wallets[2]).mintLPToken(ethers.utils.parseEther("100"));
        await vaultContract.connect(wallets[2]).burnLPToken(ethers.utils.parseEther("100"));
    });

    it("Non-manager cannot burn LP tokens", async function () {
        await vaultContract.connect(wallets[2]).mintLPToken(ethers.utils.parseEther("100"));
        await expect(vaultContract.connect(wallets[1]).burnLPToken(ethers.utils.parseEther("100"))).to.be.revertedWith("only manager can burn LP tokens");
    });

    it("Cannot burn more than vault balance", async function () {
        await vaultContract.connect(wallets[2]).mintLPToken(ethers.utils.parseEther("100"));
        await expect(vaultContract.connect(wallets[2]).burnLPToken(ethers.utils.parseEther("200"))).to.be.reverted
    });

    it("Mint and swap LP tokens", async function () {
        await vaultContract.connect(wallets[2]).mintLPToken(ethers.utils.parseEther("100"));
        await vaultContract.connect(wallets[2]).approveToken(vaultContract.address, exchangeContract.address, ethers.utils.parseEther("100"));

        const makerOrder = {
            user: vaultContract.address,
            sellToken: vaultContract.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("1");
        await exchangeContract.connect(wallets[0]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)
    });

    it("Cannot burn after mint and swap LP tokens", async function () {
        await vaultContract.connect(wallets[2]).mintLPToken(ethers.utils.parseEther("100"));
        await vaultContract.connect(wallets[2]).approveToken(vaultContract.address, exchangeContract.address, ethers.utils.parseEther("100"));

        const makerOrder = {
            user: vaultContract.address,
            sellToken: vaultContract.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("1");
        await exchangeContract.connect(wallets[0]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)

        await expect(vaultContract.connect(wallets[2]).burnLPToken(ethers.utils.parseEther("100"))).to.be.reverted
    });

    it("Non-manager cannot approve tokens", async function () {
        await expect(vaultContract.connect(wallets[1]).approveToken(tokenA.address, exchangeContract.address, ethers.utils.parseEther("100"))).to.be.revertedWith("only manager can approve tokens");
    });

    it("Update manager", async function () {
        await vaultContract.connect(wallets[2]).updateManager(wallets[1].address);
        await vaultContract.connect(wallets[1]).approveToken(vaultContract.address, exchangeContract.address, ethers.utils.parseEther("100"));
    });

    it("Non-manager cannot update manager", async function () {
        await expect(vaultContract.connect(wallets[1]).updateManager(wallets[1].address)).to.be.revertedWith("only manager can update manager");
    });

    it("Minting LP tokens doesn't affect circulating supply", async function () {
        const mintAmount = ethers.utils.parseEther("100");
        await vaultContract.connect(wallets[2]).mintLPToken(mintAmount);

        const circulatingSupply = await vaultContract.circulatingSupply();
        const totalSupply = await vaultContract.totalSupply();
        await expect(totalSupply).to.equal(mintAmount);
        await expect(circulatingSupply).to.equal("0");
    });

    it("Mint and swapping LP tokens affects circulating supply", async function () {
        await vaultContract.connect(wallets[2]).mintLPToken(ethers.utils.parseEther("100"));
        await vaultContract.connect(wallets[2]).approveToken(vaultContract.address, exchangeContract.address, ethers.utils.parseEther("100"));

        const makerOrder = {
            user: vaultContract.address,
            sellToken: vaultContract.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[2], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("1");
        await exchangeContract.connect(wallets[0]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)

        const circulatingSupply = await vaultContract.circulatingSupply();
        const totalSupply = await vaultContract.totalSupply();
        await expect(totalSupply).to.equal(ethers.utils.parseEther("100"));
        await expect(circulatingSupply).to.equal(ethers.utils.parseEther("1"));
    });
});
