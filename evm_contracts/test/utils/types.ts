import { BigNumber } from "ethers";

export interface Order {
    makerAddress: string,
    makerToken: string,
    takerToken: string,
    feeRecipientAddress: string,
    makerAssetAmount: BigNumber,
    takerAssetAmount: BigNumber,
    makerVolumeFee: BigNumber,
    takerVolumeFee: BigNumber,
    gasFee: BigNumber,
    expirationTimeSeconds: BigNumber,
    salt: BigNumber
}