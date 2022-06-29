//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library LibOrder{
   
   
    bytes32 constant internal eip712DomainHash = 0x66ca85c73263b5f0115572f82c47128c8611f8c66c1235ea367b67876bc11817;
    /*
    keccak256(
        abi.encode(
            keccak256(
                "EIP712Domain(string name,string version,uint256 chainId)"
            ),
            keccak256(bytes("ZigZag")),
            keccak256(bytes("2")),
            uint256(42161)
        )
    ); 
    */
    bytes32 constant internal _EIP712_ORDER_SCHEMA_HASH = 0x59455b9c66ec2b7a460dc0794aef21e45f7590b2a870e30ab4cf5e579763f2d9;
    //keccak256("Order(address makerAddress,address makerToken,address takerToken,address feeRecipientAddress,uint256 makerAssetAmount,uint256 takerAssetAmount,uint256 makerVolumeFee,uint256 takerVolumeFee,uint256 gasFee,uint256 expirationTimeSeconds,uint256 salt)")
        // 0x59455b9c66ec2b7a460dc0794aef21e45f7590b2a870e30ab4cf5e579763f2d9

    enum OrderStatus {
        INVALID,                     // Default value
        INVALID_MAKER_ASSET_AMOUNT,  // Order does not have a valid maker asset amount
        INVALID_TAKER_ASSET_AMOUNT,  // Order does not have a valid taker asset amount
        FILLABLE,                    // Order is fillable
        EXPIRED,                     // Order has already expired
        FULLY_FILLED,                // Order is fully filled
        CANCELLED                    // Order has been cancelled
    }

   struct Order{
        address makerAddress; //address of the Order Creator making the sale
        address makerToken; // address of the Maker Token the Order Creator wants to sell
        address takerToken; // address of the Taker Token the Order Creator wants to recive in return
        address feeRecipientAddress; // address of the protocol owner that recives the fees
        uint256 makerAssetAmount; // amount of Maker Token that the Order Creator wants to sell
        uint256 takerAssetAmount; // amount of Taker Token that the Order Creator wants to recive in return
        uint256 makerVolumeFee; // Fee taken from Order Creator in the form of the Maker Token in propotion to the volume filled, In case of right order should be set to 0
        uint256 takerVolumeFee;// Fee taken from the taker 
        uint256 gasFee;// Fee paid by left Order to cover gas fees each time a transaction is made with this order, taken in the form of the makerToken
        uint256 expirationTimeSeconds; //time after which the order is no longer valid
        uint256 salt; //to further ensure the order hash is unique, could represent the order created time
   }

    struct OrderInfo {
        OrderStatus orderStatus;                    // Status that describes order's validity and fillability.
        bytes32 orderHash;                    // EIP712 typed data hash of the order (see LibOrder.getTypedDataHash).
        uint256 orderTakerAssetFilledAmount;  // Amount of order that has already been filled.
    }

   function getOrderHash(Order memory order) internal pure returns (bytes32){



       bytes32 orderHash = keccak256(abi.encode(

        _EIP712_ORDER_SCHEMA_HASH,
        order.makerAddress,
        order.makerToken,
        order.takerToken,
        order.feeRecipientAddress,
        order.makerAssetAmount,
        order.takerAssetAmount,
        order.makerVolumeFee,
        order.takerVolumeFee,
        order.gasFee,
        order.expirationTimeSeconds,
        order.salt
        
       ));
       
        bytes32 result = hashEIP712Message(orderHash);
        //bytes32 result = keccak256(abi.encodePacked("\x19\x01",eip712DomainHash,orderHash));

       return result;
   }

    function hashEIP712Message( bytes32 hashStruct)
        internal
        pure
        returns (bytes32 result)
    {
        // Assembly for more efficient computing:
        // keccak256(abi.encodePacked(
        //     EIP191_HEADER,
        //     EIP712_DOMAIN_HASH,
        //     hashStruct
        // ));

        assembly {
            // Load free memory pointer
            let memPtr := mload(64)

            mstore(memPtr, 0x1901000000000000000000000000000000000000000000000000000000000000)  // EIP191 header
            mstore(add(memPtr, 2), eip712DomainHash)                                            // EIP712 domain hash
            mstore(add(memPtr, 34), hashStruct)                                                 // Hash of struct

            // Compute hash
            result := keccak256(memPtr, 66)
        }
        return result;
    }
}
