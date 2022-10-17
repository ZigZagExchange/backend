//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library LibOrder {
  bytes32 internal constant _EIP712_ORDER_SCHEMA_HASH =
    0xfa32bf255b1c22edbfeb8277d85cc12f63ae6977de503f9ac76a2b65b5e4f195;
  //keccak256("Order(address user,address sellToken,address buyToken,address relayerAddress,uint256 sellAmount,uint256 buyAmount,uint256 gasFee,uint256 expirationTimeSeconds,uint256 salt)")

  enum OrderStatus {
    INVALID, // Default value
    INVALID_MAKER_ASSET_AMOUNT, // Order does not have a valid maker asset amount
    INVALID_TAKER_ASSET_AMOUNT, // Order does not have a valid taker asset amount
    FILLABLE, // Order is fillable
    EXPIRED, // Order has already expired
    FULLY_FILLED, // Order is fully filled
    CANCELLED // Order has been cancelled
  }

  struct Order {
    address user; //address of the Order Creator making the sale
    address sellToken; // address of the Token the Order Creator wants to sell
    address buyToken; // address of the Token the Order Creator wants to receive in return
    address relayerAddress; // if specified, only the specified address can relay the order. setting it to the zero address will allow anyone to relay
    uint256 sellAmount; // amount of Token that the Order Creator wants to sell
    uint256 buyAmount; // amount of Token that the Order Creator wants to receive in return
    uint256 gasFee; // Fee paid by taker Order to cover gas fees each time a transaction is made with this order, taken in the form of the sellToken
    uint256 expirationTimeSeconds; //time after which the order is no longer valid
    uint256 salt; //to further ensure the order hash is unique, could represent the order created time
  }

  struct OrderInfo {
    OrderStatus orderStatus; // Status that describes order's validity and fillability.
    bytes32 orderHash; // EIP712 typed data hash of the order (see LibOrder.getTypedDataHash).
    uint256 orderBuyFilledAmount; // Amount of order that has already been filled.
  }

  // https://eips.ethereum.org/EIPS/eip-712#definition-of-hashstruct
  function getOrderHash(Order memory order) internal pure returns (bytes32) {
    bytes32 orderHash = keccak256(
      abi.encode(
        _EIP712_ORDER_SCHEMA_HASH,
        order.user,
        order.sellToken,
        order.buyToken,
        order.relayerAddress,
        order.sellAmount,
        order.buyAmount,
        order.gasFee,
        order.expirationTimeSeconds,
        order.salt
      )
    );
    
    return orderHash;
  }
}
