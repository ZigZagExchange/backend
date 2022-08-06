import { ethers } from "hardhat";
import { expect } from "chai";
import { TESTRPC_PRIVATE_KEYS_STRINGS } from "./utils/PrivateKeyList"
import { signOrder } from "./utils/SignUtil"
import { Order } from "./utils/types"
import { Contract, Wallet } from "ethers";

describe("Signature Validation", function () {

    let exchangeContract: Contract;
    let wallet: Wallet;
    let order: Order;

    beforeEach(async function () {

        const Exchange = await ethers.getContractFactory("Exchange");
        exchangeContract = await Exchange.deploy();

        wallet = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[0], ethers.getDefaultProvider())

        order = {
            user: wallet.address,
            sellToken: "0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed",
            buyToken: "0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed",
            feeRecipientAddress: "0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed",
            relayerAddress: ethers.constants.AddressZero,
            sellAmount: ethers.BigNumber.from("12"),
            buyAmount: ethers.BigNumber.from("13"),
            makerVolumeFee: ethers.BigNumber.from("21"),
            takerVolumeFee: ethers.BigNumber.from("20"),
            gasFee: ethers.BigNumber.from("0"),
            expirationTimeSeconds: ethers.BigNumber.from("0"),
            salt: ethers.BigNumber.from("0")
        }
    });

    it("Should validate signature", async function () {


        const signedMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[0], order)
        //console.log(signedMessage)

        expect(await exchangeContract.isValidSignature(
            Object.values(order)
            ,
            signedMessage)
        ).to.equal(true);


    });

    it("Shouldn't validate signature with different Private Key", async function () {

        const incorrenctlySignedMessage = await signOrder(TESTRPC_PRIVATE_KEYS_STRINGS[1], order)
        expect(await exchangeContract.isValidSignature(
            Object.values(order)
            ,
            incorrenctlySignedMessage)
        ).to.equal(false);
    });
});
