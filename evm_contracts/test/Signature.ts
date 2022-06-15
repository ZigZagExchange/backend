import { ethers } from "hardhat";
import { expect } from "chai";
import { TESTRPC_PRIVATE_KEYS_STRINGS } from "./utils/PrivateKeyList"
import { signOrder } from "./utils/SignUtil"
import { Order } from "./utils/types"
import { Contract, Wallet } from "ethers";

describe("Exchange contract", function () {

    let exchangeContract: Contract;
    let wallet: Wallet;
    let order: Order;

    beforeEach(async function () {

        const Exchange = await ethers.getContractFactory("Exchange");
        exchangeContract = await Exchange.deploy();

        wallet = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[0], ethers.getDefaultProvider())

        order = {
            makerAddress: wallet.address,
            makerToken: "0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed",
            takerToken: "0x2546BcD3c84621e976D8185a91A922aE77ECEc30",
            feeRecipientAddress: "0xdD2FD4581271e230360230F9337D5c0430Bf44C0",
            makerAssetAmount: ethers.BigNumber.from("12"),
            takerAssetAmount: ethers.BigNumber.from("13"),
            makerFee: ethers.BigNumber.from("21"),
            takerFee: ethers.BigNumber.from("20")
        }
    });

    it("Should validate signature", async function () {


        const signedMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], order)
        //console.log(signedMessage)

        expect(await exchangeContract.isValidSignature([
            order.makerAddress,
            order.makerToken,
            order.takerToken,
            order.feeRecipientAddress,
            order.makerAssetAmount,
            order.takerAssetAmount,
            order.makerFee,
            order.takerFee
        ],
            signedMessage)
        ).to.equal(true);


    });

    it("Shouldn't validate signature with different Private Key", async function () {

        const incorrenctlySignedMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], order)
        expect(await exchangeContract.isValidSignature([
            order.makerAddress,
            order.makerToken,
            order.takerToken,
            order.feeRecipientAddress,
            order.makerAssetAmount,
            order.takerAssetAmount,
            order.makerFee,
            order.takerFee
        ],
            incorrenctlySignedMessage)
        ).to.equal(false);
    });
});