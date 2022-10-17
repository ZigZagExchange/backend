//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {EIP712} from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import {SignatureChecker} from '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';

//import "hardhat/console.sol";

contract Exchange is EIP712 {
  bytes32 internal constant _EIP712_ORDER_SCHEMA_HASH =
    0x68d868c8698fc31da3a36bb7a184a4af099797794701bae97bea3de7ebe6e399;
  //keccak256("Order(address user,address sellToken,address buyToken,uint256 sellAmount,uint256 buyAmount,uint256 expirationTimeSeconds)")

  struct Order {
    address user; //address of the Order Creator making the sale
    address sellToken; // address of the Token the Order Creator wants to sell
    address buyToken; // address of the Token the Order Creator wants to receive in return
    uint256 sellAmount; // amount of Token that the Order Creator wants to sell
    uint256 buyAmount; // amount of Token that the Order Creator wants to receive in return
    uint256 expirationTimeSeconds; //time after which the order is no longer valid
  }

  event Swap(
    address maker,
    address taker,
    address makerSellToken,
    address takerSellToken,
    uint256 makerSellAmount,
    uint256 takerSellAmount,
    uint256 makerVolumeFee,
    uint256 takerVolumeFee
  );

  mapping(bytes32 => uint256) public fills;

  // fees
  address FEE_ADDRESS;
  uint256 maker_fee_numerator = 0;
  uint256 maker_fee_denominator = 10000;
  uint256 taker_fee_numerator = 0;
  uint256 taker_fee_denominator = 10000;

  // initialize fee address
  constructor(
    string memory name,
    string memory version,
    address fee_address
  ) EIP712(name, version) {
    FEE_ADDRESS = fee_address;
  }

  function cancelOrder(Order memory order) public {
    require(msg.sender == order.user, 'only user may cancel order');
    bytes32 orderHash = getOrderHash(order);
    fills[orderHash] = order.sellAmount;
  }

  function matchOrder(
    Order memory order,
    bytes memory signature,
    uint fillAmount,
    bool fillAvailable
  )
    public
    returns (bool)
  {

    bytes32 orderhash = getOrderHash(order);

    // adjust size if the user wants to fill whatever is available
    uint availableSize = order.sellAmount - fills[orderhash];
    if (fillAvailable && fillAmount > availableSize) {
      fillAmount = availableSize;
    } 
    require(fillAmount <= availableSize, "fill amount exceeds available size");
    require(block.timestamp <= order.expirationTimeSeconds, 'order expired');

    require(
      _isValidSignatureHash(
        order.user,
        orderhash,
        signature
      ),
      'invalid signature'
    );


    fills[orderhash] += fillAmount;

    // Send out the tokens
    uint buyFillAmount = order.buyAmount * fillAmount / order.sellAmount;
    IERC20(order.sellToken).transferFrom(order.user, msg.sender, fillAmount);
    IERC20(order.buyToken).transferFrom(msg.sender, order.user, buyFillAmount);

    // Calculate and charge the fees
    uint takerFee = buyFillAmount * taker_fee_numerator / taker_fee_denominator;
    uint makerFee = fillAmount * maker_fee_numerator / maker_fee_denominator;
    if (takerFee > 0) {
      IERC20(order.buyToken).transferFrom(msg.sender, FEE_ADDRESS, takerFee);
    }
    if (makerFee > 0) {
      IERC20(order.sellToken).transferFrom(order.user, FEE_ADDRESS, makerFee);
    }

    emit Swap(
      order.user,
      msg.sender,
      order.sellToken,
      order.buyToken,
      fillAmount,
      buyFillAmount,
      makerFee,
      takerFee
    );

    return true;
  }

  // https://eips.ethereum.org/EIPS/eip-712#definition-of-hashstruct
  function getOrderHash(Order memory order) internal pure returns (bytes32) {
    bytes32 orderHash = keccak256(
      abi.encode(
        _EIP712_ORDER_SCHEMA_HASH,
        order.user,
        order.sellToken,
        order.buyToken,
        order.sellAmount,
        order.buyAmount,
        order.expirationTimeSeconds
      )
    );
    
    return orderHash;
  }

  function _isValidSignatureHash(
    address a,
    bytes32 orderHash,
    bytes memory signature
  ) private view returns (bool) {
    bytes32 digest = _hashTypedDataV4(orderHash);

    return SignatureChecker.isValidSignatureNow(a, digest, signature);
  }

  function setFees(
    uint256 _taker_fee_numerator,
    uint256 _taker_fee_denominator,
    uint256 _maker_fee_numerator,
    uint256 _maker_fee_denominator
  ) public {
    require(msg.sender == FEE_ADDRESS, 'only fee address may update fees');

    taker_fee_numerator = _taker_fee_numerator;
    taker_fee_denominator = _taker_fee_denominator;
    maker_fee_numerator = _maker_fee_numerator;
    maker_fee_denominator = _maker_fee_denominator;
  }
}
