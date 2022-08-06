import { BigNumber } from "ethers";

export interface Order {
    user: string,
    sellToken: string,
    buyToken: string,
    feeRecipientAddress: string,
    relayerAddress: string,
    sellAmount: BigNumber,
    buyAmount: BigNumber,
    makerVolumeFee: BigNumber,
    takerVolumeFee: BigNumber,
    gasFee: BigNumber,
    expirationTimeSeconds: BigNumber,
    salt: BigNumber
}
