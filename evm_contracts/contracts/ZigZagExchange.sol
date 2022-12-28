//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './LibOrder.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { EIP712 } from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import { SignatureChecker } from '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';

// import "hardhat/console.sol";

interface IWETH9 {
  function depositTo(address) external payable;

  function withdrawTo(address, uint256) external;

  function balanceOf(address) external view returns (uint256);
}

contract ZigZagExchange is EIP712 {
  event Swap(
    address maker,
    address taker,
    address indexed makerSellToken,
    address indexed takerSellToken,
    uint256 makerSellAmount,
    uint256 takerSellAmount,
    uint256 makerVolumeFee,
    uint256 takerVolumeFee
  );

  event CancelOrder(bytes32 orderHash);
  event OrderStatus(bytes32 orderHash, uint filled, uint remaining);

  mapping(bytes32 => uint256) public filled;

  mapping(bytes32 => bool) public cancelled;

  // fees
  address immutable FEE_ADDRESS;
  address immutable WETH_ADDRESS;
  address immutable EXCHANGE_ADDRESS;
  address constant ETH_ADDRESS = address(0);

  uint256 maker_fee_numerator = 0;
  uint256 maker_fee_denominator = 10000;
  uint256 taker_fee_numerator = 5;
  uint256 taker_fee_denominator = 10000;

  // initialize fee address
  constructor(string memory name, string memory version, address fee_address, address weth_address) EIP712(name, version) {
    FEE_ADDRESS = fee_address;
    WETH_ADDRESS = weth_address;
    EXCHANGE_ADDRESS = address(this);
  }

  receive() external payable {}

  /// @notice Cancel an order so it can no longer be filled
  /// @param order order that should get cancelled
  function cancelOrder(LibOrder.Order calldata order) public {
    require(msg.sender == order.user, 'only user may cancel order');
    bytes32 orderHash = LibOrder.getOrderHash(order);
    require(filled[orderHash] < order.sellAmount, 'order already filled');
    cancelled[orderHash] = true;
    emit CancelOrder(orderHash);
  }

  /// @notice Cancel an order so it can no longer be filled with an EIP712 signature
  /// @param order order that should get cancelled
  /// @param cancelSignature signature using the EIP712 format
  function cancelOrderWithSig(LibOrder.Order calldata order, bytes calldata cancelSignature) public {
    bytes32 orderHash = LibOrder.getOrderHash(order);
    require(filled[orderHash] < order.sellAmount, 'order already filled');
    bytes32 cancelHash = LibOrder.getCancelOrderHash(orderHash);
    require(_isValidSignatureHash(order.user, cancelHash, cancelSignature), 'invalid cancel signature');
    cancelled[orderHash] = true;
    emit CancelOrder(orderHash);
  }

  /// @notice Fills an order with an exact amount to sell, taking or returning ETH
  /// @param makerOrder Order that will be used to make this swap, buyToken or sellToken must be WETH
  /// @param makerSignature  Signature for the order used
  /// @param takerSellAmount amount send from the sender to the maker
  /// @return returns true if successfull
  function fillOrderExactInputETH(
    LibOrder.Order calldata makerOrder,
    bytes calldata makerSignature,
    uint takerSellAmount,
    bool fillAvailable
  ) public payable returns (bool) {
    uint takerBuyAmount = (takerSellAmount * makerOrder.sellAmount) / makerOrder.buyAmount;
    _fillOrderETH(makerOrder, makerSignature, takerBuyAmount, fillAvailable);
    return true;
  }

  /// @notice Fills an order with an exact amount to buy, taking or returning ETH
  /// @param makerOrder Order that will be used to make this swap, buyToken or sellToken must be WETH
  /// @param makerSignature  Signature for the order used
  /// @param takerBuyAmount amount send to the sender from the maker
  /// @param fillAvailable Should the maximum buyAmount possible be used
  /// @return returns true if successfull
  function fillOrderExactOutputETH(
    LibOrder.Order calldata makerOrder,
    bytes calldata makerSignature,
    uint takerBuyAmount,
    bool fillAvailable
  ) public payable returns (bool) {
    // add the takerFee to the buy amount to recive the exact amount after fees
    takerBuyAmount = (takerBuyAmount * taker_fee_denominator) / (taker_fee_denominator - taker_fee_numerator);
    _fillOrderETH(makerOrder, makerSignature, takerBuyAmount, fillAvailable);
    return true;
  }

  function _fillOrderETH (
    LibOrder.Order calldata makerOrder,
    bytes calldata makerSignature,
    uint takerBuyAmountAdjusted,
    bool fillAvailable
  ) internal {
    require(makerOrder.buyToken == WETH_ADDRESS || makerOrder.sellToken == WETH_ADDRESS, 'Either buy or sell token should be WETH');

    if (makerOrder.buyToken == WETH_ADDRESS) {
      _fillOrder(makerOrder, makerSignature, makerOrder.sellToken, ETH_ADDRESS, takerBuyAmountAdjusted, fillAvailable);
      _refundETH();
    } else {
      _fillOrder(makerOrder, makerSignature, ETH_ADDRESS, makerOrder.buyToken, takerBuyAmountAdjusted, fillAvailable);
    }
  }

  /// @notice Fills an order with an exact amount to sell
  /// @param makerOrder Order that will be used to make this swap
  /// @param makerSignature  Signature for the order used
  /// @param takerSellAmount amount send from the sender to the maker
  /// @return returns true if successfull
  function fillOrderExactInput(
    LibOrder.Order calldata makerOrder,
    bytes calldata makerSignature,
    uint takerSellAmount,
    bool fillAvailable
  ) public returns (bool) {
    uint takerBuyAmount = (takerSellAmount * makerOrder.sellAmount) / makerOrder.buyAmount;
    _fillOrder(makerOrder, makerSignature, makerOrder.sellToken, makerOrder.buyToken, takerBuyAmount, fillAvailable);
    return true;
  }

  /// @notice Fills an order with an exact amount to buy
  /// @param makerOrder Order that will be used to make this swap
  /// @param makerSignature  Signature for the order used
  /// @param takerBuyAmount amount send to the sender from the maker
  /// @param fillAvailable Should the maximum buyAmount possible be used
  /// @return returns true if successfull
  function fillOrderExactOutput(
    LibOrder.Order calldata makerOrder,
    bytes calldata makerSignature,
    uint takerBuyAmount,
    bool fillAvailable
  ) public returns (bool) {
    // add the takerFee to the buy amount to recive the exact amount after fees
    takerBuyAmount = (takerBuyAmount * taker_fee_denominator) / (taker_fee_denominator - taker_fee_numerator);
    _fillOrder(makerOrder, makerSignature, makerOrder.sellToken, makerOrder.buyToken, takerBuyAmount, fillAvailable);
    return true;
  }

  function _fillOrder(
    LibOrder.Order calldata makerOrder,
    bytes calldata makerSignature,
    address sellToken,
    address buyToken,
    uint takerBuyAmountAdjusted,
    bool fillAvailable
  ) internal {
    //validate signature
    LibOrder.OrderInfo memory makerOrderInfo = getOpenOrder(makerOrder);
    require(_isValidSignatureHash(makerOrder.user, makerOrderInfo.orderHash, makerSignature), 'invalid maker signature');

    uint availableTakerSellSize = makerOrder.sellAmount - makerOrderInfo.orderSellFilledAmount;
    if (fillAvailable && availableTakerSellSize < takerBuyAmountAdjusted) takerBuyAmountAdjusted = availableTakerSellSize;
    uint takerSellAmount = (takerBuyAmountAdjusted * makerOrder.buyAmount) / makerOrder.sellAmount;

    require(takerBuyAmountAdjusted <= availableTakerSellSize, 'amount exceeds available size');

    // mark fills in storage
    uint makerOrderFilled = makerOrderInfo.orderSellFilledAmount + takerBuyAmountAdjusted;
    filled[makerOrderInfo.orderHash] = makerOrderFilled;

    _settleMatchedOrders(makerOrder.user, msg.sender, sellToken, buyToken, takerBuyAmountAdjusted, takerSellAmount);

    emit OrderStatus(makerOrderInfo.orderHash, makerOrderFilled, makerOrder.sellAmount - makerOrderFilled);
  }

  function matchOrders(
    LibOrder.Order calldata makerOrder,
    LibOrder.Order calldata takerOrder,
    bytes calldata makerSignature,
    bytes calldata takerSignature
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
    uint makerSellAmount;
    uint takerSellAmount;
    {
      uint makerSellAmountRemaining = makerOrder.sellAmount - makerOrderInfo.orderSellFilledAmount;
      uint takerSellAmountRemaining = takerOrder.sellAmount - takerOrderInfo.orderSellFilledAmount;
      uint makerBuyAmountRemaining = (makerSellAmountRemaining * makerOrder.buyAmount) / makerOrder.sellAmount;

      if (makerBuyAmountRemaining >= takerSellAmountRemaining) {
        makerSellAmount = (takerSellAmountRemaining * makerOrder.sellAmount) / makerOrder.buyAmount;
        takerSellAmount = takerSellAmountRemaining;
      } else {
        makerSellAmount = makerSellAmountRemaining;
        takerSellAmount = makerBuyAmountRemaining;
      }

      // mark fills in storage
      filled[makerOrderInfo.orderHash] += makerSellAmount;
      filled[takerOrderInfo.orderHash] += takerSellAmount;
    }
    _settleMatchedOrders(makerOrder.user, takerOrder.user, makerOrder.sellToken, takerOrder.sellToken, makerSellAmount, takerSellAmount);

    emit OrderStatus(makerOrderInfo.orderHash, filled[makerOrderInfo.orderHash], makerOrder.sellAmount - filled[makerOrderInfo.orderHash]);
    emit OrderStatus(takerOrderInfo.orderHash, filled[takerOrderInfo.orderHash], takerOrder.sellAmount - filled[takerOrderInfo.orderHash]);

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
    if (takerSellToken == ETH_ADDRESS) {
      require(msg.value >= takerSellAmount, 'msg value not high enough');
    } else {
      require(IERC20(takerSellToken).balanceOf(taker) >= takerSellAmount, 'taker order not enough balance');
      require(IERC20(takerSellToken).allowance(taker, EXCHANGE_ADDRESS) >= takerSellAmount, 'taker order not enough allowance');
    }

    if (makerSellToken == ETH_ADDRESS) {
      require(IERC20(WETH_ADDRESS).balanceOf(maker) >= makerSellAmount, 'maker order not enough balance');
      require(IERC20(WETH_ADDRESS).allowance(maker, EXCHANGE_ADDRESS) >= makerSellAmount, 'maker order not enough allowance');
    } else {
      require(IERC20(makerSellToken).balanceOf(maker) >= makerSellAmount, 'maker order not enough balance');
      require(IERC20(makerSellToken).allowance(maker, EXCHANGE_ADDRESS) >= makerSellAmount, 'maker order not enough allowance');
    }

    // The fee gets subtracted from the buy amounts so they deduct from the total instead of adding on to it
    // The taker fee comes out of the maker sell quantity, so the taker ends up with less
    // The maker fee comes out of the taker sell quantity, so the maker ends up with less
    // takerBuyAmount = makerSellAmount
    // makerBuyAmount = takerSellAmount
    uint takerFee = (makerSellAmount * taker_fee_numerator) / taker_fee_denominator;
    uint makerFee = (takerSellAmount * maker_fee_numerator) / maker_fee_denominator;

    // Taker fee -> fee recipient
    // taker fee is collected in takerBuyToken
    if (takerFee > 0) {
      if (makerSellToken == ETH_ADDRESS) {
        IERC20(WETH_ADDRESS).transferFrom(maker, FEE_ADDRESS, takerFee);
      } else {
        IERC20(makerSellToken).transferFrom(maker, FEE_ADDRESS, takerFee);
      }
    }

    // Maker fee -> fee recipient
    // Maker fee is collected in makerBuyToken
    if (makerFee > 0) {
      if (takerSellToken == ETH_ADDRESS) {
        IWETH9(WETH_ADDRESS).depositTo{ value: makerFee }(FEE_ADDRESS);
      } else {
        IERC20(takerSellToken).transferFrom(taker, FEE_ADDRESS, makerFee);
      }
    }

    // taker -> maker
    if (takerSellToken == ETH_ADDRESS) {
      IWETH9(WETH_ADDRESS).depositTo{ value: takerSellAmount - makerFee }(maker);
    } else {
      IERC20(takerSellToken).transferFrom(taker, maker, takerSellAmount - makerFee);
    }

    // maker -> taker
    if (makerSellToken == ETH_ADDRESS) {
      IERC20(WETH_ADDRESS).transferFrom(maker, EXCHANGE_ADDRESS, makerSellAmount - takerFee);
      IWETH9(WETH_ADDRESS).withdrawTo(taker, makerSellAmount - takerFee);
    } else {
      IERC20(makerSellToken).transferFrom(maker, taker, makerSellAmount - takerFee);
    }

    emit Swap(maker, taker, makerSellToken, takerSellToken, makerSellAmount, takerSellAmount, makerFee, takerFee);
  }

  function getOpenOrder(LibOrder.Order calldata order) public view returns (LibOrder.OrderInfo memory orderInfo) {
    orderInfo.orderHash = LibOrder.getOrderHash(order);
    orderInfo.orderSellFilledAmount = filled[orderInfo.orderHash];

    require(orderInfo.orderSellFilledAmount < order.sellAmount, 'order is filled');
    require(block.timestamp <= order.expirationTimeSeconds, 'order expired');
    require(!cancelled[orderInfo.orderHash], 'order canceled');
  }

  function isValidOrderSignature(LibOrder.Order calldata order, bytes calldata signature) public view returns (bool) {
    bytes32 orderHash = LibOrder.getOrderHash(order);
    return _isValidSignatureHash(order.user, orderHash, signature);
  }

  function isValidCancelSignature(LibOrder.Order calldata order, bytes calldata signature) public view returns (bool) {
    bytes32 orderHash = LibOrder.getOrderHash(order);
    bytes32 cancelHash = LibOrder.getCancelOrderHash(orderHash);
    return _isValidSignatureHash(order.user, cancelHash, signature);
  }

  // hash can be an order hash or a cancel order hash
  function _isValidSignatureHash(address user, bytes32 hash, bytes calldata signature) private view returns (bool) {
    bytes32 digest = _hashTypedDataV4(hash);
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

  function _refundETH() internal {
    if (address(this).balance > 0) {
      (bool success, ) = msg.sender.call{ value: address(this).balance }(new bytes(0));
      require(success, 'ETH transfer failed');
    }
  }
}
