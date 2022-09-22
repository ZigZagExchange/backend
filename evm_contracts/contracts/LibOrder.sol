//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library LibOrder{
   
   
    bytes32 constant internal eip712DomainHash = 0xa076a88b3e9c52bec7bd0441613055c9487552e6e9bc376730af6e90ac980e2d;
    /*
    keccak256(
        abi.encode(
            keccak256(
                "EIP712Domain(string name,string version,uint256 chainId)"
            ),
            keccak256(bytes("ZigZag")),
            keccak256(bytes("6")),
            uint256(42161)
        )
    ); 
    */

    bytes32 constant internal _EIP712_ORDER_SCHEMA_HASH = 0x573d82b18a677641f8b46e5280c268852c77c040affcce708d5575f2be6f92b0;
    //keccak256("Order(address user,address sellToken,address buyToken,address feeRecipientAddress,address relayerAddress,uint256 sellAmount,uint256 buyAmount,uint256 gasFee,uint256 expirationTimeSeconds,uint256 salt)")

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
        address user; //address of the Order Creator making the sale
        address sellToken; // address of the Token the Order Creator wants to sell
        address buyToken; // address of the Token the Order Creator wants to receive in return
        address feeRecipientAddress; // address of the protocol owner that recives the fees
        address relayerAddress; // if specified, only the specified address can relay the order. setting it to the zero address will allow anyone to relay
        uint256 sellAmount; // amount of Token that the Order Creator wants to sell
        uint256 buyAmount; // amount of Token that the Order Creator wants to receive in return
        uint256 gasFee;// Fee paid by taker Order to cover gas fees each time a transaction is made with this order, taken in the form of the sellToken
        uint256 expirationTimeSeconds; //time after which the order is no longer valid
        uint256 salt; //to further ensure the order hash is unique, could represent the order created time
   }

    struct OrderInfo {
        OrderStatus orderStatus;                    // Status that describes order's validity and fillability.
        bytes32 orderHash;                    // EIP712 typed data hash of the order (see LibOrder.getTypedDataHash).
        uint256 orderBuyFilledAmount;  // Amount of order that has already been filled.
    }

   function getOrderHash(Order memory order) internal pure returns (bytes32){
      bytes32 orderHash = keccak256(
        abi.encode(
            _EIP712_ORDER_SCHEMA_HASH,
            order.user,
            order.sellToken,
            order.buyToken,
            order.feeRecipientAddress,
            order.relayerAddress,
            order.sellAmount,
            order.buyAmount,
            order.gasFee,
            order.expirationTimeSeconds,
            order.salt
        )
      );

       
      //return hashEIP712Message(orderHash);
      return keccak256(abi.encodePacked("\x19\x01",eip712DomainHash,orderHash));
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
