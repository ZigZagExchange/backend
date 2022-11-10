import { ethers } from "hardhat";
import { expect } from "chai";
import { TESTRPC_PRIVATE_KEYS_STRINGS } from "./utils/PrivateKeyList"
import { signOrder } from "./utils/SignUtil"
import { Order } from "./utils/types"
import { Contract, Wallet } from "ethers";

describe("RFQ", function () {

    let exchangeContract: Contract;
    let tokenA: Contract;
    let tokenB: Contract;
    let wallets: Wallet[] = [];
    let FEE_ADDRESS: string;

    beforeEach(async function () {
        this.timeout(30000) 
        const Exchange = await ethers.getContractFactory("ZigZagExchange");
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

        FEE_ADDRESS = wallets[3].address;
        exchangeContract = await Exchange.deploy("ZigZag", "2.0", FEE_ADDRESS);

        await tokenA.mint(ethers.utils.parseEther("10000"), wallets[0].address);
        await tokenB.mint(ethers.utils.parseEther("10000"), wallets[1].address);
        await tokenA.connect(wallets[0]).approve(exchangeContract.address, ethers.utils.parseEther("10000"));
        await tokenB.connect(wallets[1]).approve(exchangeContract.address, ethers.utils.parseEther("10000"));

        await exchangeContract.connect(wallets[3]).setFees(5, 10000, 0, 10000);

    });

    it("Should revert with 'taker order not enough balance' ", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("20000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("1");
        await expect(exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)).to.be.revertedWith('taker order not enough balance');
    });

    it("Should revert with 'maker order not enough balance' ", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("15000"),
            buyAmount: ethers.utils.parseEther("1"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("15000");
        await expect(exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)).to.be.revertedWith('maker order not enough balance');
    });

    it("Should revert when maker order is already filled", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("120"),
            buyAmount: ethers.BigNumber.from("971"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("120");
        await exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)
        await expect(exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)).to.be.revertedWith('order is filled');
    });

    it("Should revert when maker order is canceled", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("120"),
            buyAmount: ethers.BigNumber.from("970"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("1");
        await exchangeContract.connect(wallets[0]).cancelOrder(Object.values(makerOrder))
        await expect(exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)).to.be.revertedWith('order canceled');
    });

    it("Should revert when maker order is expired", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("120"),
            buyAmount: ethers.BigNumber.from("970"),
            expirationTimeSeconds: ethers.BigNumber.from("100")
        }

        const fillAmount = ethers.utils.parseEther("1");
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        await expect(exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)).to.be.revertedWith('order expired');
    });

});
