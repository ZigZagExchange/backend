const ethers = require("ethers")
const eip712 = require("eip-712")
const bytesToHex = require('@noble/hashes/utils').bytesToHex

async function sign() {

    const provider = ethers.getDefaultProvider()
    const wallet = new ethers.Wallet("90c8e3c43c824ae8e365e6a40ed63e3b1365247ac545746ac2d06cb35a683a76", provider)

    const signingKey = new ethers.utils.SigningKey("0x90c8e3c43c824ae8e365e6a40ed63e3b1365247ac545746ac2d06cb35a683a76");

    console.log(wallet.address)

    // const domain = {
    //     "name": 'SetTest',
    //     "version": '1',
    //     "chainId": 1,
    // }

    // const types = {
    //     "Order": [
    //         { "name": 'makerAddress', "type": 'address' },
    //         { "name": 'makerToken', "type": 'address' },
    //         { "name": 'takerToken', "type": 'address' },
    //         { "name": 'makerAssetAmount', "type": 'uint256' },
    //         { "name": 'takerAssetAmount', "type": 'uint256' },
    //         { "name": 'makerFee', "type": 'uint256' },
    //         { "name": 'takerFee', "type": 'uint256' },
    //     ]
    // }

    // const value = {
    //     "makerAddress": wallet.address,
    //     "makerToken": '0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed',
    //     "takerToken": '0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed',
    //     "makerAssetAmount": 0,
    //     "takerAssetAmount": 0,
    //     "makerFee": 0,
    //     "takerFee": 0
    // }

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
                { "name": 'makerFee', "type": 'uint256' },
                { "name": 'takerFee', "type": 'uint256' },
            ]
        },
        "primaryType": 'Order',
        "domain": {
            "name": 'SetTest',
            "version": '1',
            "chainId": 1,

        },
        "message": {
            "makerAddress": wallet.address,
            "makerToken": '0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed',
            "takerToken": '0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed',
            "feeRecipientAddress": '0x90d4ffBf13bF3203940E6DAcE392F7C23ff6b9Ed',
            "makerAssetAmount": ethers.BigNumber.from("0"),
            "takerAssetAmount": ethers.BigNumber.from("0"),
            "makerFee": ethers.BigNumber.from("0"),
            "takerFee": ethers.BigNumber.from("0")
        }
    }


    //console.log(eip712.getTypeHash(typedData, 'EIP712Domain').toString('hex'));
    console.log(eip712.encodeType(typedData, 'Order'));


    const message = eip712.getMessage(typedData, true);
    const { r, s, v } = signingKey.signDigest(message);

    //console.log(`Message: 0x${bytesToHex(message)}`);

    console.log(`Signature: (${r}, ${s}, ${v})`);
    const signedMessage = [r.slice(0, 2), v.toString(16), r.slice(2, r.length), s.slice(2, s.length)].join('');
    console.log(signedMessage)

    return signedMessage;
}

sign()
