//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './LibOrder.sol';
import './LibMath.sol';
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

  function cancelOrder(LibOrder.Order memory order) public {
    require(msg.sender == order.user, 'only user may cancel order');

    bytes32 orderHash = order.getOrderHash();

    cancelled[orderHash] = true;
  }

  function fillOrder(
    LibOrder.Order memory makerOrder,
    bytes memory makerSignature,
    uint fillAmount,
    bool fillAvailable
  ) public returns (bool) {
    LibOrder.OrderInfo memory makerOrderInfo = getOrderInfo(makerOrder);

    //validate signature
    require(_isValidSignatureHash(makerOrder.user, makerOrderInfo.orderHash, makerSignature), 'invalid maker signature');

    // adjust size if the user wants to fill whatever is available
    uint availableSize = makerOrder.buyAmount - makerOrderInfo.orderBuyFilledAmount;
    if (fillAvailable) fillAmount = availableSize;
    require(fillAmount <= availableSize, 'fill amount exceeds available size');

    LibOrder.Order memory takerOrder;
    takerOrder.user = msg.sender;
    takerOrder.buyAmount = fillAmount;
    takerOrder.sellAmount = (makerOrder.sellAmount / makerOrder.buyAmount) * fillAmount;

    (uint makerSellAmount, uint _takerSellAmount) = _settleMatchedOrders(makerOrder, takerOrder, makerOrderInfo.orderBuyFilledAmount, 0);
    _updateFilledState(makerOrderInfo.orderHash, makerSellAmount);
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

    LibOrder.OrderInfo memory makerOrderInfo = getOrderInfo(makerOrder);
    LibOrder.OrderInfo memory takerOrderInfo = getOrderInfo(takerOrder);

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

    (uint makerSellAmount, uint takerSellAmount) = _settleMatchedOrders(
      makerOrder,
      takerOrder,
      makerOrderInfo.orderBuyFilledAmount,
      takerOrderInfo.orderBuyFilledAmount
    );

    _updateFilledState(makerOrderInfo.orderHash, makerSellAmount);
    _updateFilledState(takerOrderInfo.orderHash, takerSellAmount);
    return true;
  }

  function _settleMatchedOrders(
    LibOrder.Order memory makerOrder,
    LibOrder.Order memory takerOrder,
    uint256 makerFilledAmount,
    uint256 takerFilledAmount
  ) internal returns (uint makerSellAmount, uint takerSellAmount) {
    uint makerBuyAmountRemaining = makerOrder.buyAmount - makerFilledAmount;
    uint takerBuyAmountRemaining = takerOrder.buyAmount - takerFilledAmount;
    uint takerSellAmountRemaining = LibMath.safeGetPartialAmountFloor(takerOrder.sellAmount, takerOrder.buyAmount, takerBuyAmountRemaining);
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
    if (makerBuyAmountRemaining >= takerSellAmountRemaining) {
      makerSellAmount = LibMath.safeGetPartialAmountFloor(makerOrder.sellAmount, makerOrder.buyAmount, takerSellAmountRemaining);
      takerSellAmount = takerSellAmountRemaining;
    } else {
      makerSellAmount = LibMath.safeGetPartialAmountFloor(makerOrder.sellAmount, makerOrder.buyAmount, makerBuyAmountRemaining);
      takerSellAmount = makerBuyAmountRemaining;
    }

    require(IERC20(makerOrder.buyToken).balanceOf(takerOrder.user) >= takerSellAmount, 'taker order not enough balance');
    require(IERC20(makerOrder.sellToken).balanceOf(makerOrder.user) >= makerSellAmount, 'maker order not enough balance');

    // Right maker asset -> maker maker
    IERC20(makerOrder.buyToken).transferFrom(takerOrder.user, makerOrder.user, takerSellAmount);

    // Left maker asset -> taker maker
    IERC20(makerOrder.sellToken).transferFrom(makerOrder.user, takerOrder.user, makerSellAmount);

    uint makerFee = (makerSellAmount * maker_fee_numerator) / maker_fee_denominator;
    uint takerFee = (takerSellAmount * taker_fee_numerator) / taker_fee_denominator;
    /* Fees Paid */
    // Taker fee + gas fee -> fee recipient
    if (takerFee > 0) {
      require(IERC20(makerOrder.buyToken).balanceOf(takerOrder.user) >= takerFee, 'taker order not enough balance for fee');
      IERC20(makerOrder.buyToken).transferFrom(takerOrder.user, FEE_ADDRESS, takerFee);
    }

    // Maker fee -> fee recipient
    if (makerFee > 0) {
      require(IERC20(makerOrder.sellToken).balanceOf(makerOrder.user) >= makerFee, 'maker order not enough balance for fee');
      IERC20(makerOrder.sellToken).transferFrom(makerOrder.user, FEE_ADDRESS, makerFee);
    }

    emit Swap(
      makerOrder.user,
      takerOrder.user,
      makerOrder.sellToken,
      makerOrder.buyToken,
      makerSellAmount,
      takerSellAmount,
      makerFee,
      takerFee
    );
  }

  function _updateFilledState(bytes32 orderHash, uint256 orderBuyFilledAmount) internal {
    filled[orderHash] += orderBuyFilledAmount;
  }

  function getOrderInfo(LibOrder.Order memory order) public view returns (LibOrder.OrderInfo memory orderInfo) {
    (orderInfo.orderHash, orderInfo.orderBuyFilledAmount) = _getOrderHashAndFilledAmount(order);

    require(orderInfo.orderBuyFilledAmount < order.buyAmount, 'order is filled');
    require(block.timestamp <= order.expirationTimeSeconds, 'order expired');
    require(!cancelled[orderInfo.orderHash], 'order canceled');

    orderInfo.orderStatus = LibOrder.OrderStatus.FILLABLE;
  }

  function _getOrderHashAndFilledAmount(LibOrder.Order memory order)
    internal
    view
    returns (bytes32 orderHash, uint256 orderBuyFilledAmount)
  {
    orderHash = order.getOrderHash();
    orderBuyFilledAmount = filled[orderHash];
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
