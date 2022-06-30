import { ethers } from "ethers";
import { getMessage } from "eip-712";
import { Order } from "./types"

export async function signOrder(privateKey: string, order: Order) {

    const provider = ethers.getDefaultProvider()
    const wallet = new ethers.Wallet(privateKey, provider)

    const signingKey = new ethers.utils.SigningKey(privateKey);

    const typedData = {
        "types": {
            "EIP712Domain": [
                { "name": 'name', "type": 'string' },
                { "name": 'version', "type": 'string' },
                { "name": 'chainId', "type": 'uint256' },

            ],
            "Order": [
                { "name": 'makerAddress', "type": 'address' },
                { "name": 'makerToken', "type": 'address' },
                { "name": 'takerToken', "type": 'address' },
                { "name": 'feeRecipientAddress', "type": 'address' },
                { "name": 'makerAssetAmount', "type": 'uint256' },
                { "name": 'takerAssetAmount', "type": 'uint256' },
                { "name": 'makerVolumeFee', "type": 'uint256' },
                { "name": 'takerVolumeFee', "type": 'uint256' },
                { "name": 'gasFee', "type": 'uint256' },
                { "name": 'expirationTimeSeconds', "type": 'uint256' },
                { "name": 'salt', "type": 'uint256' },
            ]
        },
        "primaryType": 'Order',
        "domain": {
            "name": 'ZigZag',
            "version": '3',
            "chainId": 42161,

        },
        "message": {
            "makerAddress": order.makerAddress,
            "makerToken": order.makerToken,
            "takerToken": order.takerToken,
            "feeRecipientAddress": order.feeRecipientAddress,
            "makerAssetAmount": order.makerAssetAmount,
            "takerAssetAmount": order.takerAssetAmount,
            "makerVolumeFee": order.makerVolumeFee,
            "takerVolumeFee": order.takerVolumeFee,
            "gasFee": order.gasFee,
            "expirationTimeSeconds": order.expirationTimeSeconds,
            "salt": order.salt
        }
    }

    const signature = await wallet._signTypedData(typedData.domain, {"Order":typedData.types.Order}, typedData.message);
    const signatureModified = signature.slice(0,2) + signature.slice(-2) + signature.slice(2,-2);
    //const message = getMessage(typedData, true);
    //const { r, s, v } = signingKey.signDigest(message);
    //const signedMessage = [r.slice(0, 2), v.toString(16), r.slice(2, r.length), s.slice(2, s.length)].join('');

    return signatureModified;
}
