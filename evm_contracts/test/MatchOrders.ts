import { ethers } from "hardhat";
import { expect } from "chai";
import { TESTRPC_PRIVATE_KEYS_STRINGS } from "./utils/PrivateKeyList"
import { signOrder } from "./utils/SignUtil"
import { Order } from "./utils/types"
import { Contract, Wallet } from "ethers";

describe("Exchange contract", function () {

    let exchangeContract: Contract;
    let tokenA: Contract;
    let tokenB: Contract;
    let wallets: Wallet[] = [];
    const feeRecipientAddress: string = "0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed"

    beforeEach(async function () {

        const Exchange = await ethers.getContractFactory("Exchange");
        const Token = await ethers.getContractFactory("Token");
        const provider = ethers.provider;

        exchangeContract = await Exchange.deploy();
        tokenA = await Token.deploy();
        tokenB = await Token.deploy();
        let [owner] = await ethers.getSigners();

        for (let i = 0; i < 3; i++) {
            wallets[i] = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[i], provider)

            await owner.sendTransaction({
                to: wallets[i].address,
                value: ethers.utils.parseEther("1") // 1 ether
            })
        }

        await tokenA.mint(ethers.utils.parseEther("10000"), wallets[0].address);
        await tokenB.mint(ethers.utils.parseEther("10000"), wallets[1].address);
        await tokenA.connect(wallets[0]).approve(exchangeContract.address, ethers.utils.parseEther("10000"));
        await tokenB.connect(wallets[1]).approve(exchangeContract.address, ethers.utils.parseEther("10000"));


    });

    it("Should revert with 'not profitable spread' ", async function () {


        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("10000"),
            takerAssetAmount: ethers.BigNumber.from("10000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("10000"),
            takerAssetAmount: ethers.BigNumber.from("20000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('not profitable spread');


    });

    it("Should revert with 'not profitable spread' ", async function () {


        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("10000"),
            takerAssetAmount: ethers.BigNumber.from("20000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("10000"),
            takerAssetAmount: ethers.BigNumber.from("10000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('not profitable spread');


    });

    it("Should revert with 'right order not enough balance' ", async function () {


        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("1"),
            takerAssetAmount: ethers.utils.parseEther("20000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("20000"),
            takerAssetAmount: ethers.utils.parseEther("1"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('right order not enough balance');
    });

    it("Should revert with 'left order not enough balance' ", async function () {


        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("20000"),
            takerAssetAmount: ethers.utils.parseEther("1"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("1"),
            takerAssetAmount: ethers.utils.parseEther("20000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('left order not enough balance');
    });

    it("Should revert with 'right order not enough balance for fee' ", async function () {


        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("1"),
            takerAssetAmount: ethers.utils.parseEther("10000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("10000"),
            takerAssetAmount: ethers.utils.parseEther("1"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("1000"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('right order not enough balance for fee');
    });

    it("Should revert with 'left order not enough balance for fee' ", async function () {


        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("10000"),
            takerAssetAmount: ethers.utils.parseEther("1"),
            makerVolumeFee: ethers.BigNumber.from("1000"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("1"),
            takerAssetAmount: ethers.utils.parseEther("10000"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)


        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith('left order not enough balance for fee');
    });

    it("Should execute with spread of 0", async function () {


        const rightOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("100"),
            takerAssetAmount: ethers.BigNumber.from("100"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const leftOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("100"),
            takerAssetAmount: ethers.BigNumber.from("100"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

    });

    it("Should revert with invalid signature from mismatching maker and taker tokens", async function () {

        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("10000"),
            takerAssetAmount: ethers.BigNumber.from("10000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("10000"),
            takerAssetAmount: ethers.BigNumber.from("20000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("invalid right signature")

    });

    it("Should revert with maker amount = 0", async function () {

        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("0"),
            takerAssetAmount: ethers.BigNumber.from("10000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("10000"),
            takerAssetAmount: ethers.BigNumber.from("20000"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("left order status not Fillable")

    });

    it("Should revert when right order is already filled", async function () {

        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("120"),
            takerAssetAmount: ethers.BigNumber.from("970"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("890"),
            takerAssetAmount: ethers.BigNumber.from("10"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        await exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("right order status not Fillable")
    });

    it("Should revert when right order is canceled", async function () {

        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("120"),
            takerAssetAmount: ethers.BigNumber.from("970"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("890"),
            takerAssetAmount: ethers.BigNumber.from("10"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        await exchangeContract.connect(wallets[1]).cancelOrder(Object.values(rightOrder))

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("right order status not Fillable")
    });

    it("Should revert when order time is expired", async function () {

        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("120"),
            takerAssetAmount: ethers.BigNumber.from("970"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.BigNumber.from("890"),
            takerAssetAmount: ethers.BigNumber.from("10"),
            makerVolumeFee: ethers.BigNumber.from("0"),
            takerVolumeFee: ethers.BigNumber.from("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) - 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        await expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)).to.be.revertedWith("right order status not Fillable")
    });

    it("feeRecipient should take Maker Fee", async function () {
        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("120"),
            takerAssetAmount: ethers.utils.parseEther("970"),
            makerVolumeFee: ethers.utils.parseEther("0.1"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("890"),
            takerAssetAmount: ethers.utils.parseEther("10"),
            makerVolumeFee: ethers.utils.parseEther("0.1"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)

        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenA.balanceOf(wallets[2].address);
        const balance4 = await tokenB.balanceOf(wallets[0].address);
        const balance5 = await tokenB.balanceOf(wallets[1].address);
        const balance6 = await tokenB.balanceOf(wallets[2].address);
        const balance7 = await tokenA.balanceOf(feeRecipientAddress);
        const balance8 = await tokenB.balanceOf(feeRecipientAddress);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4));
        console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6));
        console.log(ethers.utils.formatEther(balance7), ethers.utils.formatEther(balance8));

        expect(balance7).to.equal(ethers.utils.parseEther("0.1").mul(890).div(970))
    });

    it("feeRecipient should take Taker Fee", async function () {
        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("120"),
            takerAssetAmount: ethers.utils.parseEther("970"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0.1"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("890"),
            takerAssetAmount: ethers.utils.parseEther("10"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0.1"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)
        //console.log(tx)

        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenA.balanceOf(wallets[2].address);
        const balance4 = await tokenB.balanceOf(wallets[0].address);
        const balance5 = await tokenB.balanceOf(wallets[1].address);
        const balance6 = await tokenB.balanceOf(wallets[2].address);
        const balance7 = await tokenA.balanceOf(feeRecipientAddress);
        const balance8 = await tokenB.balanceOf(feeRecipientAddress);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance4));
        console.log(ethers.utils.formatEther(balance2), ethers.utils.formatEther(balance5));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance6));
        console.log(ethers.utils.formatEther(balance7), ethers.utils.formatEther(balance8));

        expect(balance8).to.equal(ethers.utils.parseEther("0.1"))
    });

    it("same price should match", async function () {
        // tokenA = ETH
        // tokenB = USDC
        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("100"),
            takerAssetAmount: ethers.utils.parseEther("200"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("200"),
            takerAssetAmount: ethers.utils.parseEther("100"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)
    });

    it("should fail when filled twice", async function () {
        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("100"),
            takerAssetAmount: ethers.utils.parseEther("200"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("200"),
            takerAssetAmount: ethers.utils.parseEther("100"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)
        expect(exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage))
            .to.be.reverted
    });

    it("should fill at maker price - market buy into ask - fill maker fully", async function () {
        // tokenA = ETH
        // tokenB = USDC
        // User 0 starts with all the ETH
        // User 1 starts with all the USDC
        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("1"),
            takerAssetAmount: ethers.utils.parseEther("1000"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("4000"),
            takerAssetAmount: ethers.utils.parseEther("2"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("1")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)
        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenB.balanceOf(wallets[0].address);
        const balance4 = await tokenB.balanceOf(wallets[1].address);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance2));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance4));

        expect(balance2).to.equal(ethers.utils.parseEther("1"))
        expect(balance3).to.equal(ethers.utils.parseEther("1000"))
    });

    it("should fill at maker price - market buy into ask - fill maker partially", async function () {
        // tokenA = ETH
        // tokenB = USDC
        // User 0 starts with all the ETH
        // User 1 starts with all the USDC
        const leftOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("2"),
            takerAssetAmount: ethers.utils.parseEther("2000"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("2000"),
            takerAssetAmount: ethers.utils.parseEther("1"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("1")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], rightOrder)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)
        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenB.balanceOf(wallets[0].address);
        const balance4 = await tokenB.balanceOf(wallets[1].address);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance2));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance4));

        expect(balance2).to.equal(ethers.utils.parseEther("2"))
        expect(balance3).to.equal(ethers.utils.parseEther("2000"))
    });

    it("should fill at maker price - market sell into bid - fill maker fully", async function () {
        // tokenA = ETH
        // tokenB = USDC
        // User 0 starts with all the ETH
        // User 1 starts with all the USDC
        const leftOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("1000"),
            takerAssetAmount: ethers.utils.parseEther("1"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("2"),
            takerAssetAmount: ethers.utils.parseEther("1000"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("1")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], rightOrder)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)
        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenB.balanceOf(wallets[0].address);
        const balance4 = await tokenB.balanceOf(wallets[1].address);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance2));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance4));

        expect(balance2).to.equal(ethers.utils.parseEther("1"))
        expect(balance3).to.equal(ethers.utils.parseEther("1000"))
    });

    it("should fill at maker price - market sell into bid - fill maker partially", async function () {
        // tokenA = ETH
        // tokenB = USDC
        // User 0 starts with all the ETH
        // User 1 starts with all the USDC
        const leftOrder = {
            makerAddress: wallets[1].address,
            makerToken: tokenB.address,
            takerToken: tokenA.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("2000"),
            takerAssetAmount: ethers.utils.parseEther("2"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("0")
        }

        const rightOrder = {
            makerAddress: wallets[0].address,
            makerToken: tokenA.address,
            takerToken: tokenB.address,
            feeRecipientAddress: feeRecipientAddress,
            makerAssetAmount: ethers.utils.parseEther("1"),
            takerAssetAmount: ethers.utils.parseEther("500"),
            makerVolumeFee: ethers.utils.parseEther("0"),
            takerVolumeFee: ethers.utils.parseEther("0"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from(String(Math.floor(Date.now() / 1000) + 3600)),
            salt: ethers.BigNumber.from("1")
        }

        const signedLeftMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], leftOrder)
        const signedRightMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], rightOrder)

        const tx = await exchangeContract.connect(wallets[2]).matchOrders(Object.values(leftOrder), Object.values(rightOrder), signedLeftMessage, signedRightMessage)
        const balance1 = await tokenA.balanceOf(wallets[0].address);
        const balance2 = await tokenA.balanceOf(wallets[1].address);
        const balance3 = await tokenB.balanceOf(wallets[0].address);
        const balance4 = await tokenB.balanceOf(wallets[1].address);
        console.log(ethers.utils.formatEther(balance1), ethers.utils.formatEther(balance2));
        console.log(ethers.utils.formatEther(balance3), ethers.utils.formatEther(balance4));

        expect(balance2).to.equal(ethers.utils.parseEther("1"))
        expect(balance3).to.equal(ethers.utils.parseEther("1000"))
    });

});
