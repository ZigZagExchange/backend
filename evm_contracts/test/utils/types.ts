import { BigNumber } from "ethers";

export interface Order {
    makerAddress: string,
    makerToken: string,
    takerToken: string,
    feeRecipientAddress: string,
    makerAssetAmount: BigNumber,
    takerAssetAmount: BigNumber,
    makerFee: BigNumber,
    takerFee: BigNumber
}