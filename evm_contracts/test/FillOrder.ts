import { ethers } from "hardhat";
import { expect } from "chai";
import { TESTRPC_PRIVATE_KEYS_STRINGS } from "./utils/PrivateKeyList"
import { signOrder, signCancelOrder } from "./utils/SignUtil"
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

    it("Should revert when maker order is canceled with signature", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("120"),
            buyAmount: ethers.BigNumber.from("970"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const signedCancelOrder = await signCancelOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        await exchangeContract.connect(wallets[2]).cancelOrderWithSig(Object.values(makerOrder), signedCancelOrder)

        const fillAmount = ethers.utils.parseEther("1");
        await expect(exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)).to.be.revertedWith('order canceled');
    });

    it("Bad cancel signature should revert", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("120"),
            buyAmount: ethers.BigNumber.from("970"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const signedCancelOrder = await signCancelOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrder, exchangeContract.address)
        await expect(exchangeContract.connect(wallets[2]).cancelOrderWithSig(Object.values(makerOrder), signedCancelOrder)).to.be.revertedWith('invalid cancel signature');
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

    it("feeRecipient should take Maker Fee", async function () {
        await exchangeContract.connect(wallets[3]).setFees(0, 10000, 5, 10000);

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("1000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("30");
        await exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)

        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenA.balanceOf(wallets[2].address);
        const balance4 = await tokenB.balanceOf(wallets[0].address);
        const balance5 = await tokenB.balanceOf(wallets[1].address);
        const balance6 = await tokenB.balanceOf(wallets[2].address);
        const balance7 = await tokenA.balanceOf(FEE_ADDRESS);
        const balance8 = await tokenB.balanceOf(FEE_ADDRESS);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4));
        console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6));
        console.log(ethers.utils.formatEther(balance7), ethers.utils.formatEther(balance8));

        expect(balance8).to.equal(ethers.utils.parseEther("0.15"));
    });

    it("feeRecipient should take Taker Fee", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("1000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }
        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("30");
        await exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)

        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenA.balanceOf(wallets[2].address);
        const balance4 = await tokenB.balanceOf(wallets[0].address);
        const balance5 = await tokenB.balanceOf(wallets[1].address);
        const balance6 = await tokenB.balanceOf(wallets[2].address);
        const balance7 = await tokenA.balanceOf(FEE_ADDRESS);
        const balance8 = await tokenB.balanceOf(FEE_ADDRESS);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4));
        console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6));
        console.log(ethers.utils.formatEther(balance7), ethers.utils.formatEther(balance8));

        expect(balance7).to.equal(ethers.utils.parseEther("0.015"));
    });

    it("should fail when filled twice", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("200"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("100");
        const tx = await exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)
        await expect(exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true))
            .to.be.revertedWith('order is filled');
    });

    it("fill a full order", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("200"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("100");
        await exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)

        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenA.balanceOf(wallets[2].address);
        const balance4 = await tokenB.balanceOf(wallets[0].address);
        const balance5 = await tokenB.balanceOf(wallets[1].address);
        const balance6 = await tokenB.balanceOf(wallets[2].address);
        const balance7 = await tokenA.balanceOf(FEE_ADDRESS);
        const balance8 = await tokenB.balanceOf(FEE_ADDRESS);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4));
        console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6));
        console.log(ethers.utils.formatEther(balance7), ethers.utils.formatEther(balance8));

        expect(balance2).to.equal(ethers.utils.parseEther("99.95"));
        expect(balance4).to.equal(ethers.utils.parseEther("200"));
    });

    it("should fill what's available", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("200"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("90");
        await exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)
        await exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)

        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenA.balanceOf(wallets[2].address);
        const balance4 = await tokenB.balanceOf(wallets[0].address);
        const balance5 = await tokenB.balanceOf(wallets[1].address);
        const balance6 = await tokenB.balanceOf(wallets[2].address);
        const balance7 = await tokenA.balanceOf(FEE_ADDRESS);
        const balance8 = await tokenB.balanceOf(FEE_ADDRESS);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4));
        console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6));
        console.log(ethers.utils.formatEther(balance7), ethers.utils.formatEther(balance8));

        expect(balance2).to.equal(ethers.utils.parseEther("99.95"));
        expect(balance4).to.equal(ethers.utils.parseEther("200"));
    });

    it("should fail without fillAvailable when over-ordering", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("200"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("90");
        await exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)
        const tx2 = exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, false)
        await expect(tx2).to.be.revertedWith('fill amount exceeds available size');
    });

    it("should fail without fillAvailable when over-ordering", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("200"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("90");
        await exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)
        const tx2 = exchangeContract.connect(wallets[1]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, false)
        await expect(tx2).to.be.revertedWith('fill amount exceeds available size');
    });


    it("should disallow self swap", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("200"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)

        const fillAmount = ethers.utils.parseEther("90");
        const tx = exchangeContract.connect(wallets[0]).fillOrder(Object.values(makerOrder), signedLeftMessage, fillAmount, true)
        await expect(tx).to.be.revertedWith("self swap not allowed");
    });
});
