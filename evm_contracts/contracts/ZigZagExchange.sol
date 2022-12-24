//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './LibOrder.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { EIP712 } from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import { SignatureChecker } from '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';

// import "hardhat/console.sol";

interface IWETH9 {
  function deposit() external payable;
  function withdraw(uint256) external;
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
  address FEE_ADDRESS;
  address WETH_ADDRESS;
  address EXCHANGE_ADDRESS;

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
  function cancelOrder(LibOrder.Order memory order) public {
    require(msg.sender == order.user, 'only user may cancel order');
    bytes32 orderHash = LibOrder.getOrderHash(order);
    require(filled[orderHash] < order.sellAmount, 'order already filled');
    cancelled[orderHash] = true;
    emit CancelOrder(orderHash);
  }

  /// @notice Cancel an order so it can no longer be filled with an EIP712 signature
  /// @param order order that should get cancelled
  /// @param cancelSignature signature using the EIP712 format
  function cancelOrderWithSig(LibOrder.Order memory order, bytes memory cancelSignature) public {
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
    LibOrder.Order memory makerOrder,
    bytes memory makerSignature,
    uint takerSellAmount,
    bool fillAvailable
  ) public payable returns (bool) {
    //validate signature
    LibOrder.OrderInfo memory makerOrderInfo = getOpenOrder(makerOrder);
    require(_isValidSignatureHash(makerOrder.user, makerOrderInfo.orderHash, makerSignature), 'invalid maker signature');

    uint takerBuyAmount = (takerSellAmount * makerOrder.sellAmount) / makerOrder.buyAmount;
    uint availableTakerSellSize = makerOrder.sellAmount - makerOrderInfo.orderSellFilledAmount;
    if (fillAvailable && availableTakerSellSize < takerBuyAmount) takerBuyAmount = availableTakerSellSize;
    takerSellAmount = (takerBuyAmount * makerOrder.buyAmount) / makerOrder.sellAmount;

    require(takerBuyAmount <= availableTakerSellSize, 'amount exceeds available size');

    // mark fills in storage
    filled[makerOrderInfo.orderHash] += takerBuyAmount;

    if (makerOrder.buyToken == WETH_ADDRESS) {
      IWETH9(WETH_ADDRESS).deposit{ value: takerSellAmount }();

      // settle sellToken (WETH): this -> maker
      // settle buyToken: maker -> caller
      _settleMatchedOrders(
        makerOrder.user,
        EXCHANGE_ADDRESS,
        makerOrder.user,
        msg.sender,
        makerOrder.sellToken,
        makerOrder.buyToken,
        takerBuyAmount,
        takerSellAmount
      );
    } else if (makerOrder.sellToken == WETH_ADDRESS) {
      // settle sellToke: caller -> maker
      // settle buyToken (WETH): maker -> this
      _settleMatchedOrders(
        makerOrder.user,
        msg.sender,
        makerOrder.user,
        EXCHANGE_ADDRESS,
        makerOrder.sellToken,
        makerOrder.buyToken,
        takerBuyAmount,
        takerSellAmount
      );

      IWETH9(WETH_ADDRESS).withdrawTo(msg.sender, takerBuyAmount - (takerBuyAmount * taker_fee_numerator) / taker_fee_denominator);
    } else {
      return false; // todo better error
    }

    uint makerOrderFilled = filled[makerOrderInfo.orderHash];
    emit OrderStatus(makerOrderInfo.orderHash, makerOrderFilled, makerOrder.sellAmount - makerOrderFilled);

    return true;
  }

  /// @notice Fills an order with an exact amount to buy, taking or returning ETH
  /// @param makerOrder Order that will be used to make this swap, buyToken or sellToken must be WETH
  /// @param makerSignature  Signature for the order used
  /// @param takerBuyAmount amount send to the sender from the maker
  /// @param fillAvailable Should the maximum buyAmount possible be used
  /// @return returns true if successfull
  function fillOrderExactOutputETH(
    LibOrder.Order memory makerOrder,
    bytes memory makerSignature,
    uint takerBuyAmount,
    bool fillAvailable
  ) public payable returns (bool) {    
    if (makerOrder.buyToken == WETH_ADDRESS) {
      return fillOrderExactInputETH (
        makerOrder,
        makerSignature,
        msg.value,
        fillAvailable
      );
    }

    //validate signature
    LibOrder.OrderInfo memory makerOrderInfo = getOpenOrder(makerOrder);
    require(_isValidSignatureHash(makerOrder.user, makerOrderInfo.orderHash, makerSignature), 'invalid maker signature');

    // add the takerFee to the buy amount to recive the exact amount after fees
    takerBuyAmount = (takerBuyAmount * taker_fee_denominator) / (taker_fee_denominator - taker_fee_numerator);
    uint availableTakerSellSize = makerOrder.sellAmount - makerOrderInfo.orderSellFilledAmount;
    if (fillAvailable && availableTakerSellSize < takerBuyAmount) takerBuyAmount = availableTakerSellSize;
    uint takerSellAmount = (takerBuyAmount * makerOrder.buyAmount) / makerOrder.sellAmount;

    require(takerBuyAmount <= availableTakerSellSize, 'amount exceeds available size');

    // mark fills in storage
    filled[makerOrderInfo.orderHash] += takerBuyAmount;
    if (makerOrder.sellToken == WETH_ADDRESS) {
      // settle sellToke: caller -> maker
      // settle buyToken (WETH): maker -> this
      _settleMatchedOrders(
        makerOrder.user,
        msg.sender,
        makerOrder.user,
        EXCHANGE_ADDRESS,
        makerOrder.sellToken,
        makerOrder.buyToken,
        takerBuyAmount,
        takerSellAmount
      );

      IWETH9(WETH_ADDRESS).withdrawTo(msg.sender, takerBuyAmount - (takerBuyAmount * taker_fee_numerator) / taker_fee_denominator);
    } else {
      return false; // todo better error
    }   

    uint makerOrderFilled = filled[makerOrderInfo.orderHash];
    emit OrderStatus(makerOrderInfo.orderHash, makerOrderFilled, makerOrder.sellAmount - makerOrderFilled);

    return true;
  }

  /// @notice Fills an order with an exact amount to sell
  /// @param makerOrder Order that will be used to make this swap
  /// @param makerSignature  Signature for the order used
  /// @param takerSellAmount amount send from the sender to the maker
  /// @return returns true if successfull
  function fillOrderExactInput(
    LibOrder.Order memory makerOrder,
    bytes memory makerSignature,
    uint takerSellAmount,
    bool fillAvailable
  ) public returns (bool) {
    //validate signature
    LibOrder.OrderInfo memory makerOrderInfo = getOpenOrder(makerOrder);
    require(_isValidSignatureHash(makerOrder.user, makerOrderInfo.orderHash, makerSignature), 'invalid maker signature');

    uint takerBuyAmount = (takerSellAmount * makerOrder.sellAmount) / makerOrder.buyAmount;
    uint availableTakerSellSize = makerOrder.sellAmount - makerOrderInfo.orderSellFilledAmount;
    if (fillAvailable && availableTakerSellSize < takerBuyAmount) takerBuyAmount = availableTakerSellSize;
    takerSellAmount = (takerBuyAmount * makerOrder.buyAmount) / makerOrder.sellAmount;

    require(takerBuyAmount <= availableTakerSellSize, 'amount exceeds available size');

    // mark fills in storage
    filled[makerOrderInfo.orderHash] += takerBuyAmount;

    _settleMatchedOrders(
      makerOrder.user,
      msg.sender,
      makerOrder.user,
      msg.sender,
      makerOrder.sellToken,
      makerOrder.buyToken,
      takerBuyAmount,
      takerSellAmount
    );

    uint makerOrderFilled = filled[makerOrderInfo.orderHash];
    emit OrderStatus(makerOrderInfo.orderHash, makerOrderFilled, makerOrder.sellAmount - makerOrderFilled);

    return true;
  }

  /// @notice Fills an order with an exact amount to buy
  /// @param makerOrder Order that will be used to make this swap
  /// @param makerSignature  Signature for the order used
  /// @param takerBuyAmount amount send to the sender from the maker
  /// @param fillAvailable Should the maximum buyAmount possible be used
  /// @return returns true if successfull
  function fillOrderExactOutput(
    LibOrder.Order memory makerOrder,
    bytes memory makerSignature,
    uint takerBuyAmount,
    bool fillAvailable
  ) public returns (bool) {
    //validate signature
    LibOrder.OrderInfo memory makerOrderInfo = getOpenOrder(makerOrder);
    require(_isValidSignatureHash(makerOrder.user, makerOrderInfo.orderHash, makerSignature), 'invalid maker signature');

    // add the takerFee to the buy amount to recive the exact amount after fees
    takerBuyAmount = (takerBuyAmount * taker_fee_denominator) / (taker_fee_denominator - taker_fee_numerator);

    uint availableTakerSellSize = makerOrder.sellAmount - makerOrderInfo.orderSellFilledAmount;
    if (fillAvailable && availableTakerSellSize < takerBuyAmount) takerBuyAmount = availableTakerSellSize;
    uint takerSellAmount = (takerBuyAmount * makerOrder.buyAmount) / makerOrder.sellAmount;

    require(takerBuyAmount <= availableTakerSellSize, 'amount exceeds available size');

    // mark fills in storage
    filled[makerOrderInfo.orderHash] += takerBuyAmount;

    _settleMatchedOrders(
      makerOrder.user,
      msg.sender,
      makerOrder.user,
      msg.sender,
      makerOrder.sellToken,
      makerOrder.buyToken,
      takerBuyAmount,
      takerSellAmount
    );

    uint makerOrderFilled = filled[makerOrderInfo.orderHash];
    emit OrderStatus(makerOrderInfo.orderHash, makerOrderFilled, makerOrder.sellAmount - makerOrderFilled);

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
    _settleMatchedOrders(
      makerOrder.user,
      takerOrder.user,
      makerOrder.user,
      takerOrder.user,
      makerOrder.sellToken,
      takerOrder.sellToken,
      makerSellAmount,
      takerSellAmount
    );

    emit OrderStatus(makerOrderInfo.orderHash, filled[makerOrderInfo.orderHash], makerOrder.sellAmount - filled[makerOrderInfo.orderHash]);
    emit OrderStatus(takerOrderInfo.orderHash, filled[takerOrderInfo.orderHash], takerOrder.sellAmount - filled[takerOrderInfo.orderHash]);

    return true;
  }

  function _settleMatchedOrders(
    address maker,
    address taker,
    address makerReceiver,
    address takerReceiver,
    address makerSellToken,
    address takerSellToken,
    uint makerSellAmount,
    uint takerSellAmount
  ) internal {
    // Verify balances
    require(IERC20(takerSellToken).balanceOf(taker) >= takerSellAmount, 'taker order not enough balance');
    require(IERC20(makerSellToken).balanceOf(maker) >= makerSellAmount, 'maker order not enough balance');

    // Verify allowance
    require(
      taker == EXCHANGE_ADDRESS || IERC20(takerSellToken).allowance(taker, EXCHANGE_ADDRESS) >= takerSellAmount,
      'taker order not enough allowance'
    );
    require(IERC20(makerSellToken).allowance(maker, EXCHANGE_ADDRESS) >= makerSellAmount, 'maker order not enough allowance');

    // The fee gets subtracted from the buy amounts so they deduct from the total instead of adding on to it
    // The taker fee comes out of the maker sell quantity, so the taker ends up with less
    // The maker fee comes out of the taker sell quantity, so the maker ends up with less
    // takerBuyAmount = makerSellAmount
    // makerBuyAmount = takerSellAmount
    uint takerFee = (makerSellAmount * taker_fee_numerator) / taker_fee_denominator;
    uint makerFee = (takerSellAmount * maker_fee_numerator) / maker_fee_denominator;

    // Taker fee -> fee recipient
    _transfer(makerSellToken, maker, FEE_ADDRESS, takerFee);

    // Maker fee -> fee recipient
    _transfer(takerSellToken, taker, FEE_ADDRESS, makerFee);

    // taker -> maker
    _transfer(takerSellToken, taker, makerReceiver, takerSellAmount - makerFee);

    // maker -> taker
    _transfer(makerSellToken, maker, takerReceiver, makerSellAmount - takerFee);

    emit Swap(maker, taker, makerSellToken, takerSellToken, makerSellAmount, takerSellAmount, makerFee, takerFee);
  }

  function _transfer(address token, address from, address to, uint256 amount) internal {
    if (amount > 0) {
      if (from == EXCHANGE_ADDRESS) {
        IERC20(token).transfer(to, amount);
      } else {
        IERC20(token).transferFrom(from, to, amount);
      }
    }
  }

  function getOpenOrder(LibOrder.Order memory order) public view returns (LibOrder.OrderInfo memory orderInfo) {
    orderInfo.orderHash = LibOrder.getOrderHash(order);
    orderInfo.orderSellFilledAmount = filled[orderInfo.orderHash];

    require(orderInfo.orderSellFilledAmount < order.sellAmount, 'order is filled');
    require(block.timestamp <= order.expirationTimeSeconds, 'order expired');
    require(!cancelled[orderInfo.orderHash], 'order canceled');
  }

  function isValidOrderSignature(LibOrder.Order memory order, bytes memory signature) public view returns (bool) {
    bytes32 orderHash = LibOrder.getOrderHash(order);
    return _isValidSignatureHash(order.user, orderHash, signature);
  }

  function isValidCancelSignature(LibOrder.Order memory order, bytes memory signature) public view returns (bool) {
    bytes32 orderHash = LibOrder.getOrderHash(order);
    bytes32 cancelHash = LibOrder.getCancelOrderHash(orderHash);
    return _isValidSignatureHash(order.user, cancelHash, signature);
  }

  // hash can be an order hash or a cancel order hash
  function _isValidSignatureHash(address user, bytes32 hash, bytes memory signature) private view returns (bool) {
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
}
