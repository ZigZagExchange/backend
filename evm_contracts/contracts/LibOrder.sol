//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library LibOrder{
   
   
    bytes32 constant internal eip712DomainHash = 0x07072ef27221c12667016d82f01b570740d597075408abc64d1e6d899a8e5de9;
    /*
    keccak256(
        abi.encode(
            keccak256(
                "EIP712Domain(string name,string version,uint256 chainId)"
            ),
            keccak256(bytes("SetTest")),
            keccak256(bytes("1")),
            uint256(1)
        )
    ); 
    */
    bytes32 constant internal _EIP712_ORDER_SCHEMA_HASH = 0xfcbd3b8a64f35ab7eb14551d9fecf45fdf57bdae0192b52b1ed580076c7a8a0f;  //    keccak256(
        //         "Order(address makerAddress,address makerToken,address takerToken,uint256 makerAssetAmount,uint256 takerAssetAmount,uint256 makerFee,uint256 takerFee)"
        //     ),

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
       address makerAddress;
       address makerToken;
       address takerToken;
       address feeRecipientAddress;
       uint256 makerAssetAmount;
       uint256 takerAssetAmount;
       uint256 makerFee;
       uint256 takerFee;
        //uint256 expirationTimeSeconds; to be added
        //uint256 salt; to be added
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
        order.makerFee,
        order.takerFee
        
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