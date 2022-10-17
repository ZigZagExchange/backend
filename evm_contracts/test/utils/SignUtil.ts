import { ethers } from "ethers";
import { getMessage } from "eip-712";
import { Order } from "./types"

export async function signOrder(privateKey: string, order: Order, exchangeAddress: string) {

    const provider = ethers.getDefaultProvider()
    const wallet = new ethers.Wallet(privateKey, provider)


    const typedData = {
        "types": {
            "EIP712Domain": [
                { "name": 'name', "type": 'string' },
                { "name": 'version', "type": 'string' },
                { "name": 'chainId', "type": 'uint256' },
                { "name": 'verifyingContract', "type": 'address' },
            ],
            "Order": [
                { "name": 'user', "type": 'address' },
                { "name": 'sellToken', "type": 'address' },
                { "name": 'buyToken', "type": 'address' },
                { "name": 'relayerAddress', "type": 'address' },
                { "name": 'sellAmount', "type": 'uint256' },
                { "name": 'buyAmount', "type": 'uint256' },
                { "name": 'gasFee', "type": 'uint256' },
                { "name": 'expirationTimeSeconds', "type": 'uint256' },
                { "name": 'salt', "type": 'uint256' },
            ]
        },
        "primaryType": 'Order',
        "domain": {
            "name": 'ZigZag',
            "version": '6',
            "chainId": '31337', // test hardhat default
            "verifyingContract": exchangeAddress,
        },
        "message": {
            "user": order.user,
            "sellToken": order.sellToken,
            "buyToken": order.buyToken,
            "relayerAddress": order.relayerAddress,
            "sellAmount": order.sellAmount,
            "buyAmount": order.buyAmount,
            "gasFee": order.gasFee,
            "expirationTimeSeconds": order.expirationTimeSeconds,
            "salt": order.salt
        }
    }

    // eslint-disable-next-line no-underscore-dangle
    const signature = await wallet._signTypedData(typedData.domain, {"Order":typedData.types.Order}, typedData.message)

    // const signatureModified = signature.slice(0,2) + signature.slice(-2) + signature.slice(2,-2);

    // const signingKey = new ethers.utils.SigningKey(privateKey);
    // const message = getMessage(typedData, true);
    // const { r, s, v } = signingKey.signDigest(message);
    // const signedMessage = [r.slice(0, 2), v.toString(16), r.slice(2, r.length), s.slice(2, s.length)].join('');

    return signature
}
