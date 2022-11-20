//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './LibOrder.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { EIP712 } from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import { SignatureChecker } from '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';

//import "hardhat/console.sol";

contract ZigZagExchange is EIP712 {
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

  using LibOrder for LibOrder.Order;

  mapping(bytes32 => uint256) public filled;

  mapping(bytes32 => bool) public cancelled;

  // fees
  address FEE_ADDRESS;
  uint256 maker_fee_numerator = 0;
  uint256 maker_fee_denominator = 10000;
  uint256 taker_fee_numerator = 5;
  uint256 taker_fee_denominator = 10000;

  // initialize fee address
  constructor(
    string memory name,
    string memory version,
    address fee_address
  ) EIP712(name, version) {
    FEE_ADDRESS = fee_address;
  }

  // Canceling an order prevents it from being filled 
  function cancelOrder(LibOrder.Order memory order) public {
    require(msg.sender == order.user, 'only user may cancel order');
    bytes32 orderHash = order.getOrderHash();
    cancelled[orderHash] = true;
  }

  // Canceling an order prevents it from being filled 
  // This is for smart contracts to be able to sign order cancels
  // To sign a cancel, set the sellAmount to 0, then sign the order
  // There is some potential for a replay with this, but generally 
  // the combination of the other 4 fields should be unique
  function cancelOrderWithSig(LibOrder.Order memory order, bytes32 cancelSignature) public {
    bytes32 orderHash = order.getOrderHash();
    order.sellAmount = 0;
    bytes32 cancelOrderHash = order.getOrderHash();
    require(_isValidSignatureHash(order.user, cancelOrderHash, cancelSignature), 'invalid cancel signature');
    cancelled[orderHash] = true;
  }

  // fillAmount is the amount of the makerOrder.sellAmount to fill
  // (fillAvailable = true) fills whatever is available if the makerOrder.sellAmount < fillAmount
  function fillOrder(
    LibOrder.Order memory makerOrder,
    bytes memory makerSignature,
    uint fillAmount,
    bool fillAvailable
  ) public returns (bool) {
    require(msg.sender != makerOrder.user, 'self swap not allowed');

    LibOrder.OrderInfo memory makerOrderInfo = getOpenOrder(makerOrder);

    //validate signature
    require(_isValidSignatureHash(makerOrder.user, makerOrderInfo.orderHash, makerSignature), 'invalid maker signature');

    // adjust size if the user wants to fill whatever is available
    uint availableSize = makerOrder.sellAmount - makerOrderInfo.orderSellFilledAmount;
    if (fillAvailable && availableSize < fillAmount) fillAmount = availableSize;
    require(fillAmount <= availableSize, 'fill amount exceeds available size');

    uint buyAmount = fillAmount * makerOrder.buyAmount / makerOrder.sellAmount;

    // Verify balances
    require(IERC20(makerOrder.buyToken).balanceOf(msg.sender) >= buyAmount, 'taker order not enough balance');
    require(IERC20(makerOrder.sellToken).balanceOf(makerOrder.user) >= fillAmount, 'maker order not enough balance');

    // mark fills in storage
    filled[makerOrderInfo.orderHash] += fillAmount;

    _settleMatchedOrders(
      makerOrder.user,
      msg.sender,
      makerOrder.sellToken,
      makerOrder.buyToken,
      fillAmount,
      buyAmount
    );

    return true;
  }

  function matchOrders(
    LibOrder.Order memory makerOrder,
    LibOrder.Order memory takerOrder,
    bytes memory makerSignature,
    bytes memory takerSignature
  ) public returns (bool) {
    // check that tokens address match
    require(takerOrder.sellToken == makerOrder.buyToken, 'mismatched tokens');
    require(takerOrder.buyToken == makerOrder.sellToken, 'mismatched tokens');

    // no self-swap
    require(takerOrder.user != makerOrder.user, 'self swap not allowed');

    LibOrder.OrderInfo memory makerOrderInfo = getOpenOrder(makerOrder);
    LibOrder.OrderInfo memory takerOrderInfo = getOpenOrder(takerOrder);

    //validate signature
    require(_isValidSignatureHash(takerOrder.user, takerOrderInfo.orderHash, takerSignature), 'invalid taker signature');
    require(_isValidSignatureHash(makerOrder.user, makerOrderInfo.orderHash, makerSignature), 'invalid maker signature');

    // Make sure both orders are crossed.
    // The orders are crossed if the cost per unit bought (OrderA.SellAmount/OrderA.BuyAmount) for **each** order is greater
    // than the profit per unit sold of the matched order (OrderB.BuyAmount/OrderB.SellAmount).
    // This is satisfied by the equations below:
    // <makerOrder.sellAmount> / <makerOrder.buyAmount> >= <takerOrder.buyAmount> / <takerOrder.sellAmount>
    // AND
    // <takerOrder.sellAmount> / <takerOrder.buyAmount> >= <makerOrder.buyAmount> / <makerOrder.sellAmount>
    // These equations can be combined to get the following:
    require(makerOrder.sellAmount * takerOrder.sellAmount >= makerOrder.buyAmount * takerOrder.buyAmount, 'orders not crossed');


    // Calculate the maximum fill results for the maker and taker assets. At least one of the orders will be fully filled.
    //
    // The maximum that the maker maker can possibly buy is the amount that the taker order can sell.
    // The maximum that the taker maker can possibly buy is the amount that the maker order can sell.
    //
    // There are two cases to consider:
    // Case 1.
    //   If the maker can buy more or the same as the taker can sell, then the taker order is fully filled, at the price of the maker order.
    // Case 2.
    //   Else the taker can buy more or the same as the maker can sell, then the maker order is fully filled, at the price of the maker order.
    uint makerSellAmountRemaining = makerOrder.sellAmount - makerOrderInfo.orderSellFilledAmount;
    uint takerSellAmountRemaining = takerOrder.sellAmount - takerOrderInfo.orderSellFilledAmount;
    uint makerBuyAmountRemaining = makerSellAmountRemaining * makerOrder.buyAmount / makerOrder.sellAmount;

    uint makerSellAmount;
    uint takerSellAmount;
    if (makerBuyAmountRemaining >= takerSellAmountRemaining) {
      makerSellAmount = takerSellAmountRemaining * makerOrder.sellAmount / makerOrder.buyAmount;
      takerSellAmount = takerSellAmountRemaining;
    } else {
      makerSellAmount = makerSellAmountRemaining;
      takerSellAmount = makerBuyAmountRemaining;
    }

    // Verify balances
    require(IERC20(takerOrder.sellToken).balanceOf(takerOrder.user) >= takerSellAmount, 'taker order not enough balance');
    require(IERC20(makerOrder.sellToken).balanceOf(makerOrder.user) >= makerSellAmount, 'maker order not enough balance');

    // mark fills in storage
    filled[makerOrder.getOrderHash()] += makerSellAmount;
    filled[takerOrder.getOrderHash()] += takerSellAmount;

    _settleMatchedOrders(
      makerOrder.user,
      takerOrder.user,
      makerOrder.sellToken,
      takerOrder.sellToken,
      makerSellAmount,
      takerSellAmount
    );

    return true;
  }

  function _settleMatchedOrders(
      address maker, 
      address taker,
      address makerSellToken, 
      address takerSellToken,
      uint makerSellAmount,
      uint takerSellAmount
  ) internal {

    // The fee gets subtracted from the buy amounts so they deduct from the total instead of adding on to it
    // The taker fee comes out of the maker sell quantity, so the taker ends up with less
    // The maker fee comes out of the taker sell quantity, so the maker ends up with less
    // takerBuyAmount = makerSellAmount
    // makerBuyAmount = takerSellAmount
    uint takerFee = makerSellAmount * taker_fee_numerator / taker_fee_denominator;
    uint makerFee = takerSellAmount * maker_fee_numerator / maker_fee_denominator;

    // Taker fee -> fee recipient
    if (takerFee > 0) {
      IERC20(makerSellToken).transferFrom(maker, FEE_ADDRESS, takerFee);
    }

    // Maker fee -> fee recipient
    if (makerFee > 0) {
      IERC20(takerSellToken).transferFrom(taker, FEE_ADDRESS, makerFee);
    }

    // taker -> maker
    IERC20(takerSellToken).transferFrom(taker, maker, takerSellAmount - makerFee);

    // maker -> taker
    IERC20(makerSellToken).transferFrom(maker, taker, makerSellAmount - takerFee);

    emit Swap(
      maker,
      taker,
      makerSellToken,
      takerSellToken,
      makerSellAmount,
      takerSellAmount,
      makerFee,
      takerFee
    );
  }

  function getOpenOrder(LibOrder.Order memory order) public view returns (LibOrder.OrderInfo memory orderInfo) {
    orderInfo.orderHash = order.getOrderHash();
    orderInfo.orderSellFilledAmount = filled[orderInfo.orderHash];

    require(orderInfo.orderSellFilledAmount < order.sellAmount, 'order is filled');
    require(block.timestamp <= order.expirationTimeSeconds, 'order expired');
    require(!cancelled[orderInfo.orderHash], 'order canceled');
  }

  function isValidSignature(LibOrder.Order memory order, bytes memory signature) public view returns (bool) {
    bytes32 orderHash = order.getOrderHash();

    return _isValidSignatureHash(order.user, orderHash, signature);
  }

  function _isValidSignatureHash(
    address user,
    bytes32 orderHash,
    bytes memory signature
  ) private view returns (bool) {
    bytes32 digest = _hashTypedDataV4(orderHash);

    return SignatureChecker.isValidSignatureNow(user, digest, signature);
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
