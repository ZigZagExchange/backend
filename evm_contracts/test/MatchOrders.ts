import { ethers } from "hardhat";
import { expect } from "chai";
import { TESTRPC_PRIVATE_KEYS_STRINGS } from "./utils/PrivateKeyList"
import { signOrder, signCancelOrder } from "./utils/SignUtil"
import { Order } from "./utils/types"
import { Contract, Wallet } from "ethers";

describe("Order Matching", function () {

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
        exchangeContract = await Exchange.deploy("ZigZag", "2.1", FEE_ADDRESS);

        await tokenA.mint(ethers.utils.parseEther("10000"), wallets[0].address);
        await tokenB.mint(ethers.utils.parseEther("10000"), wallets[1].address);
        await tokenA.connect(wallets[0]).approve(exchangeContract.address, ethers.utils.parseEther("10000"));
        await tokenB.connect(wallets[1]).approve(exchangeContract.address, ethers.utils.parseEther("10000"));

        await exchangeContract.connect(wallets[3]).setFees(5, 10000, 0, 10000);

    });

    it("Should revert with 'orders not crossed' ", async function () {


        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("10000"),
            buyAmount: ethers.BigNumber.from("10000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.BigNumber.from("10000"),
            buyAmount: ethers.BigNumber.from("20000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('orders not crossed');


    });

    it("Should revert with 'orders not crossed' ", async function () {


        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("10000"),
            buyAmount: ethers.BigNumber.from("20000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.BigNumber.from("10000"),
            buyAmount: ethers.BigNumber.from("10000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('orders not crossed');


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

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("20000"),
            buyAmount: ethers.utils.parseEther("1"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('taker order not enough balance');
    });

    it("Should revert with 'maker order not enough balance' ", async function () {


        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("20000"),
            buyAmount: ethers.utils.parseEther("1"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("20000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('maker order not enough balance');
    });


    it("Should execute with spread of 0", async function () {


        const takerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("100"),
            buyAmount: ethers.BigNumber.from("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const makerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.BigNumber.from("100"),
            buyAmount: ethers.BigNumber.from("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

    });

    it("Should revert with mismatched tokens from mismatching maker and taker tokens", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("10000"),
            buyAmount: ethers.BigNumber.from("10000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("10000"),
            buyAmount: ethers.BigNumber.from("20000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("mismatched tokens")

    });

    it("Should revert when taker order is already filled", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("120"),
            buyAmount: ethers.BigNumber.from("970"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.BigNumber.from("890"),
            buyAmount: ethers.BigNumber.from("10"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("order is filled")
    });

    it("Should revert when taker order is canceled", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("120"),
            buyAmount: ethers.BigNumber.from("970"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.BigNumber.from("890"),
            buyAmount: ethers.BigNumber.from("10"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        await exchangeContract.connect(wallets[1]).cancelOrder(Object.values(takerOrder))

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("order canceled")
    });

    it("Should revert when taker order is canceled with signature", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("120"),
            buyAmount: ethers.BigNumber.from("970"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.BigNumber.from("890"),
            buyAmount: ethers.BigNumber.from("10"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        const signedCancelOrder = await signCancelOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)
        await exchangeContract.connect(wallets[2]).cancelOrderWithSig(Object.values(takerOrder), signedCancelOrder)

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("order canceled")
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

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.BigNumber.from("890"),
            buyAmount: ethers.BigNumber.from("10"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        const signedCancelOrder = await signCancelOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], takerOrder, exchangeContract.address)
        await expect(exchangeContract.connect(wallets[2]).cancelOrderWithSig(Object.values(takerOrder), signedCancelOrder)).to.be.revertedWith('invalid cancel signature')
    });

    it("Should revert when order time is expired", async function () {

        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.BigNumber.from("120"),
            buyAmount: ethers.BigNumber.from("970"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.BigNumber.from("890"),
            buyAmount: ethers.BigNumber.from("10"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) - 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("order expired")
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

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("900"),
            buyAmount: ethers.utils.parseEther("80"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)

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

        expect(balance8).to.equal(ethers.utils.parseEther("0.45"));
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

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1000"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)
        //console.log(tx)

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

        expect(balance7).to.equal(ethers.utils.parseEther("0.05"))
    });

    it("feeRecipient should take partial Taker Fee", async function () {
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("500"),
            buyAmount: ethers.utils.parseEther("50"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("1000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)
        //console.log(tx)

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

        expect(balance7).to.equal(ethers.utils.parseEther("0.25"))
    });

    it("same price should match", async function () {
        // tokenA = ETH
        // tokenB = USDC
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("200"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("200"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)
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

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("200"),
            buyAmount: ethers.utils.parseEther("100"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)
        expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage))
            .to.be.reverted
    });

    it("should fill at maker price - market buy into ask - fill maker fully", async function () {
        // tokenA = ETH
        // tokenB = USDC
        // User 0 starts with all the ETH
        // User 1 starts with all the USDC
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("1000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("4000"),
            buyAmount: ethers.utils.parseEther("2"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)
        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenB.balanceOf(wallets[0].address);
        const balance4 = await tokenB.balanceOf(wallets[1].address);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance2));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance4));

        expect(balance2).to.equal(ethers.utils.parseEther("0.9995"))
        expect(balance3).to.equal(ethers.utils.parseEther("1000"))
    });

    it("should fill at maker price - market buy into ask - fill maker partially", async function () {
        // tokenA = ETH
        // tokenB = USDC
        // User 0 starts with all the ETH
        // User 1 starts with all the USDC
        const makerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("2"),
            buyAmount: ethers.utils.parseEther("2000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1500"),
            buyAmount: ethers.utils.parseEther("1"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)
        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenB.balanceOf(wallets[0].address);
        const balance4 = await tokenB.balanceOf(wallets[1].address);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance2));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance4));

        expect(balance2).to.equal(ethers.utils.parseEther("1.49925"))
        expect(balance3).to.equal(ethers.utils.parseEther("1500"))
    });

    it("should fill at maker price - market sell into bid - fill maker fully", async function () {
        // tokenA = ETH
        // tokenB = USDC
        // User 0 starts with all the ETH
        // User 1 starts with all the USDC
        const makerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("1000"),
            buyAmount: ethers.utils.parseEther("1"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("2"),
            buyAmount: ethers.utils.parseEther("1000"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], takerOrder, exchangeContract.address)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)
        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenB.balanceOf(wallets[0].address);
        const balance4 = await tokenB.balanceOf(wallets[1].address);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance2));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance4));

        expect(balance2).to.equal(ethers.utils.parseEther("1"))
        expect(balance3).to.equal(ethers.utils.parseEther("999.5"))
    });

    it("should fill at maker price - market sell into bid - fill maker partially", async function () {
        // tokenA = ETH
        // tokenB = USDC
        // User 0 starts with all the ETH
        // User 1 starts with all the USDC
        const makerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("2000"),
            buyAmount: ethers.utils.parseEther("2"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[0].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("500"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], takerOrder, exchangeContract.address)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)
        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenB.balanceOf(wallets[0].address);
        const balance4 = await tokenB.balanceOf(wallets[1].address);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance2));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance4));

        expect(balance2).to.equal(ethers.utils.parseEther("1"))
        expect(balance3).to.equal(ethers.utils.parseEther("999.5"))
    });

    it("should disallow self swap", async function () {
        // tokenA = ETH
        // tokenB = USDC
        // User 0 starts with all the ETH
        // User 1 starts with all the USDC
        const makerOrder = {
            user: wallets[1].address,
            sellToken: tokenB.address,
            buyToken: tokenA.address,
            sellAmount: ethers.utils.parseEther("2000"),
            buyAmount: ethers.utils.parseEther("2"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const takerOrder = {
            user: wallets[1].address,
            sellToken: tokenA.address,
            buyToken: tokenB.address,
            sellAmount: ethers.utils.parseEther("1"),
            buyAmount: ethers.utils.parseEther("500"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], makerOrder, exchangeContract.address)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('self swap not allowed');
    });

  it("Should revert cancelOrder if already filled", async function () {

    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.BigNumber.from("120"),
      buyAmount: ethers.BigNumber.from("970"),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
    }

    const takerOrder = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: tokenA.address,
      sellAmount: ethers.BigNumber.from("970"),
      buyAmount: ethers.BigNumber.from("120"),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
    const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

    await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)

    await expect(exchangeContract.connect(wallets[1]).cancelOrder(Object.values(takerOrder))).to.be.revertedWith("order already filled")
  });

  it("Should revert cancelOrderWithSig if already filled", async function () {

    const makerOrder = {
      user: wallets[0].address,
      sellToken: tokenA.address,
      buyToken: tokenB.address,
      sellAmount: ethers.BigNumber.from("120"),
      buyAmount: ethers.BigNumber.from("970"),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
    }

    const takerOrder = {
      user: wallets[1].address,
      sellToken: tokenB.address,
      buyToken: tokenA.address,
      sellAmount: ethers.BigNumber.from("970"),
      buyAmount: ethers.BigNumber.from("120"),
      expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600))
    }

    const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], makerOrder, exchangeContract.address)
    const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)

    await exchangeContract.connect(wallets[2]).matchOrders(Object.values(makerOrder), Object.values(takerOrder), signedLeftMessage, signedRightMessage)

    const signedCancelOrder = await signCancelOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], takerOrder, exchangeContract.address)
    await expect(exchangeContract.connect(wallets[2]).cancelOrderWithSig(Object.values(takerOrder), signedCancelOrder)).to.be.revertedWith("order already filled")
    });
});
