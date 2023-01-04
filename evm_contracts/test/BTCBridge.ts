import { ethers } from "hardhat";
import { expect } from "chai";
import { TESTRPC_PRIVATE_KEYS_STRINGS } from "./utils/PrivateKeyList"
import { Contract, Wallet } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";


describe("BTCBridge", function () {

    const WBTC_DECIMALS = 8;
    let bridgeContract: Contract;
    let WBTC: Contract;
    let wallets: Wallet[] = [];
    let manager: any;

    beforeEach(async function () {
        const Bridge = await ethers.getContractFactory("ZigZagBTCBridge");
        const Token = await ethers.getContractFactory("Token");

        WBTC = await Token.deploy();
        let [owner] = await ethers.getSigners();

        for (let i = 0; i < 4; i++) {
            wallets[i] = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[i], ethers.provider)

            await owner.sendTransaction({
                to: wallets[i].address,
                value: ethers.utils.parseEther("1") // 1 ether
            })
        }

        manager = wallets[3];
        bridgeContract = await Bridge.deploy(manager.address, WBTC.address);

        await WBTC.mint(ethers.utils.parseUnits("10000", WBTC_DECIMALS), wallets[0].address);
        await WBTC.mint(ethers.utils.parseUnits("10000", WBTC_DECIMALS), wallets[1].address);
        await WBTC.mint(ethers.utils.parseUnits("1", WBTC_DECIMALS), bridgeContract.address);
        await WBTC.connect(wallets[0]).approve(bridgeContract.address, ethers.utils.parseUnits("10000", WBTC_DECIMALS));
        await WBTC.connect(wallets[1]).approve(bridgeContract.address, ethers.utils.parseUnits("10000", WBTC_DECIMALS));
    });

    it("Manager should be able to set deposit rate", async function () {
        await bridgeContract.connect(manager).setDepositRate(370);
        const deposit_rate_numerator = await bridgeContract.DEPOSIT_RATE_NUMERATOR();
        await expect(deposit_rate_numerator).to.equal(370);
    });

    it("Non-manager should not be able to set deposit rate", async function () {
        await expect(bridgeContract.connect(wallets[0]).setDepositRate(370)).to.be.revertedWith("only manager can set deposit rate");
    });

    //it("Should update LP price when deposit rate is set", async function () {
    //    await bridgeContract.connect(manager).setDepositRate(370);
    //    await time.increase(86400*180);
    //    await bridgeContract.connect(manager).updateLPPrice();
    //    const lp_price_numerator = await bridgeContract.LP_PRICE_NUMERATOR();
    //    expect(lp_price_numerator).to.equal(1e12 + 86400*180*370 + 370);
    //});

    //it("Anyone should be able to update LP Price", async function () {
    //    await bridgeContract.connect(manager).setDepositRate(370);
    //    await time.increase(86400*180);
    //    await bridgeContract.connect(wallets[0]).updateLPPrice();
    //});

    //it("Should allow manager to update manager", async function () {
    //    await bridgeContract.connect(manager).updateManager(wallets[1].address);
    //    await bridgeContract.connect(wallets[1]).updateManager(manager.address);
    //});

    //it("Non-manager should not be able to update manager", async function () {
    //    await expect(bridgeContract.connect(wallets[0]).updateManager(wallets[1].address)).to.be.revertedWith("only manager can update manager");
    //});

    //it("Deposit + withdraw LP w/ interest", async function () {
    //    await bridgeContract.connect(manager).setDepositRate(370);

    //    await bridgeContract.connect(wallets[0]).depositWBTCToLP(ethers.utils.parseUnits("1", WBTC_DECIMALS));
    //    let lp_balance = await bridgeContract.balanceOf(wallets[0].address);
    //    let wbtc_balance = await WBTC.balanceOf(wallets[0].address);
    //    expect(lp_balance.toString()).to.equal("999999999630000000");
    //    expect(wbtc_balance).to.equal(ethers.utils.parseUnits("9999", 8));

    //    await time.increase(86400);

    //    await bridgeContract.connect(wallets[0]).withdrawWBTCFromLP(lp_balance);
    //    wbtc_balance = await WBTC.balanceOf(wallets[0].address);
    //    lp_balance = await bridgeContract.balanceOf(wallets[0].address);
    //    expect(wbtc_balance.toString()).to.equal("1000000003196");
    //    expect(lp_balance.toString()).to.equal("0");
    //});
});
