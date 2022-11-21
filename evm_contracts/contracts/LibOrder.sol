//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library LibOrder {
  //keccak256("Order(address user,address sellToken,address buyToken,uint256 sellAmount,uint256 buyAmount,uint256 expirationTimeSeconds)")
  bytes32 internal constant _EIP712_ORDER_SCHEMA_HASH = 0x68d868c8698fc31da3a36bb7a184a4af099797794701bae97bea3de7ebe6e399;

  //keccak256("CancelOrder(bytes32 orderHash)")
  bytes32 internal constant _EIP712_CANCEL_ORDER_SCHEMA_HASH = 0xe70fd60b1c6c2a2394fdccb638d1e84b9233a8fa520436c8cf500b6d5b62cd64;

  struct Order {
    address user; //address of the Order Creator making the sale
    address sellToken; // address of the Token the Order Creator wants to sell
    address buyToken; // address of the Token the Order Creator wants to receive in return
    uint256 sellAmount; // amount of Token that the Order Creator wants to sell
    uint256 buyAmount; // amount of Token that the Order Creator wants to receive in return
    uint256 expirationTimeSeconds; //time after which the order is no longer valid
  }

  struct CancelOrder {
    bytes32 orderHash;
  }

  struct OrderInfo {
    bytes32 orderHash; // EIP712 typed data hash of the order (see LibOrder.getTypedDataHash).
    uint256 orderSellFilledAmount; // Amount of order that has already been filled.
  }

  // https://eips.ethereum.org/EIPS/eip-712#definition-of-hashstruct
  function getOrderHash(Order memory order) internal pure returns (bytes32 orderHash) {
    orderHash = keccak256(
      abi.encode(_EIP712_ORDER_SCHEMA_HASH, order.user, order.sellToken, order.buyToken, order.sellAmount, order.buyAmount, order.expirationTimeSeconds)
    );
  }

  // https://eips.ethereum.org/EIPS/eip-712#definition-of-hashstruct
  function getCancelOrderHash(bytes32 orderHash) internal pure returns (bytes32 cancelOrderHash) {
    cancelOrderHash = keccak256(
      abi.encode(_EIP712_CANCEL_ORDER_SCHEMA_HASH, orderHash)
    );
  }
}
