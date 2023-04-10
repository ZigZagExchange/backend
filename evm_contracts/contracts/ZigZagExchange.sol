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
    address indexed taker,
    address indexed makerSellToken,
    address indexed takerSellToken,
    uint256 makerSellAmount,
    uint256 takerSellAmount
  );

  event CancelOrder(bytes32 indexed orderHash);
  event OrderStatus(bytes32 indexed orderHash, uint filled, uint remaining);

  mapping(bytes32 => uint256) public filled;

  mapping(bytes32 => bool) public cancelled;

  address immutable WETH_ADDRESS;
  address immutable EXCHANGE_ADDRESS;
  address immutable TRUSTED_FORWARDER;
  address constant ETH_ADDRESS = address(0);

  // initialize fee address
  constructor(string memory name, string memory version, address weth_address, address trusted_forwarder) EIP712(name, version) {
    WETH_ADDRESS = weth_address;
    EXCHANGE_ADDRESS = address(this);
    TRUSTED_FORWARDER = trusted_forwarder;
  }

  receive() external payable {}

  /// @notice Cancel an order so it can no longer be filled
  /// @param order order that should get cancelled
  function cancelOrder(LibOrder.Order calldata order) public {
    require(_msgSender() == order.user, 'only user may cancel order');
    bytes32 orderHash = getOrderHash(order);
    require(filled[orderHash] < order.sellAmount, 'order already filled');
    cancelled[orderHash] = true;
    emit CancelOrder(orderHash);
  }

  function fillOrderBookETH(
    LibOrder.Order[] calldata makerOrder,
    bytes[] calldata makerSignature,
    uint takerAmount
  ) public payable returns (bool) {
    require(makerOrder.length == makerSignature.length, 'Length of makerOrders and makerSignatures does not match');
    require(makerOrder.length > 0, 'Length of makerOrders can not be 0');

    address payable sender = _msgSender();
    uint256 n = makerOrder.length - 1;
    for (uint i = 0; i <= n && takerAmount > 0; i++) {
      takerAmount -= _fillOrderETH(makerOrder[i], makerSignature[i], sender, sender, takerAmount, true);
    }
    require(takerAmount == 0, 'Taker amount not filled');

    _refundETH();
    return true;
  }

  function fillOrderBook(LibOrder.Order[] calldata makerOrder, bytes[] calldata makerSignature, uint takerAmount) public returns (bool) {
    require(makerOrder.length == makerSignature.length, 'Length of makerOrders and makerSignatures does not match');
    require(makerOrder.length > 0, 'Length of makerOrders can not be 0');

    address payable sender = _msgSender();
    uint256 n = makerOrder.length - 1;
    for (uint i = 0; i <= n && takerAmount > 0; i++) {
      takerAmount -= _fillOrder(
        makerOrder[i],
        makerSignature[i],
        sender,
        sender,
        makerOrder[i].sellToken,
        makerOrder[i].buyToken,
        takerAmount,
        true
      );
    }
    require(takerAmount == 0, 'Taker amount not filled');

    return true;
  }

  function fillOrderRouteETH(
    LibOrder.Order[] calldata makerOrder,
    bytes[] calldata makerSignature,
    uint takerAmount,
    bool fillAvailable
  ) public payable returns (bool) {
    require(makerOrder.length == makerSignature.length, 'Length of makerOrders and makerSignatures does not match');
    require(makerOrder.length > 0, 'Length of makerOrders can not be 0');

    if (makerOrder.length == 1) {
      return fillOrderExactInputETH(makerOrder[0], makerSignature[0], takerAmount, fillAvailable);
    }

    address payable sender = _msgSender();
    for (uint i = 0; i < makerOrder.length; i++) {
      require(i == 0 || makerOrder[i - 1].sellToken == makerOrder[i].buyToken, 'Tokens on route do not match');

      // takerAmountOut = takerAmountIn * price
      takerAmount = (takerAmount * makerOrder[i].sellAmount) / makerOrder[i].buyAmount;

      // first or last tx might need to (un-)wrap ETH
      if (i == 0 && makerOrder[0].buyToken == WETH_ADDRESS) {
        takerAmount = _fillOrderETH(makerOrder[0], makerSignature[0], sender, EXCHANGE_ADDRESS, takerAmount, fillAvailable);
      } else if (i == makerOrder.length - 1 && makerOrder[makerOrder.length - 1].sellToken == WETH_ADDRESS) {
        takerAmount = _fillOrderETH(
          makerOrder[makerOrder.length - 1],
          makerSignature[makerOrder.length - 1],
          EXCHANGE_ADDRESS,
          sender,
          takerAmount,
          fillAvailable
        );
      } else {
        takerAmount = _fillOrder(
          makerOrder[i],
          makerSignature[i],
          i == 0 ? sender : EXCHANGE_ADDRESS,
          i == makerOrder.length - 1 ? sender : EXCHANGE_ADDRESS,
          makerOrder[i].sellToken,
          makerOrder[i].buyToken,
          takerAmount,
          fillAvailable
        );
      }
    }

    _refundETH();
    return true;
  }

  function fillOrderRoute(
    LibOrder.Order[] calldata makerOrder,
    bytes[] calldata makerSignature,
    uint takerAmount,
    bool fillAvailable
  ) public payable returns (bool) {
    require(makerOrder.length == makerSignature.length, 'Length of makerOrders and makerSignatures does not match');
    require(makerOrder.length > 0, 'Length of makerOrders can not be 0');

    if (makerOrder.length == 1) {
      return fillOrderExactInput(makerOrder[0], makerSignature[0], takerAmount, fillAvailable);
    }

    address payable sender = _msgSender();
    for (uint i = 0; i < makerOrder.length; i++) {
      require(i == 0 || makerOrder[i - 1].sellToken == makerOrder[i].buyToken, 'Tokens on route do not match');

      // takerAmountOut = takerAmountIn * price
      takerAmount = (takerAmount * makerOrder[i].sellAmount) / makerOrder[i].buyAmount;

      takerAmount = _fillOrder(
        makerOrder[i],
        makerSignature[i],
        i == 0 ? sender : EXCHANGE_ADDRESS,
        i == makerOrder.length - 1 ? sender : EXCHANGE_ADDRESS,
        makerOrder[i].sellToken,
        makerOrder[i].buyToken,
        takerAmount,
        fillAvailable
      );
    }

    return true;
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
    address payable sender = _msgSender();
    uint takerBuyAmount = (takerSellAmount * makerOrder.sellAmount) / makerOrder.buyAmount;
    _fillOrderETH(makerOrder, makerSignature, sender, sender, takerBuyAmount, fillAvailable);
    _refundETH();
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
    address payable sender = _msgSender();
    _fillOrderETH(makerOrder, makerSignature, sender, sender, takerBuyAmount, fillAvailable);
    _refundETH();
    return true;
  }

  function _fillOrderETH(
    LibOrder.Order calldata makerOrder,
    bytes calldata makerSignature,
    address taker,
    address takerReciver,
    uint takerBuyAmountAdjusted,
    bool fillAvailable
  ) internal returns (uint256) {
    require(makerOrder.buyToken == WETH_ADDRESS || makerOrder.sellToken == WETH_ADDRESS, 'Either buy or sell token should be WETH');

    if (makerOrder.buyToken == WETH_ADDRESS) {
      return
        _fillOrder(
          makerOrder,
          makerSignature,
          taker,
          takerReciver,
          makerOrder.sellToken,
          ETH_ADDRESS,
          takerBuyAmountAdjusted,
          fillAvailable
        );
    } else {
      return
        _fillOrder(
          makerOrder,
          makerSignature,
          taker,
          takerReciver,
          ETH_ADDRESS,
          makerOrder.buyToken,
          takerBuyAmountAdjusted,
          fillAvailable
        );
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
    address payable sender = _msgSender();
    uint takerBuyAmount = (takerSellAmount * makerOrder.sellAmount) / makerOrder.buyAmount;
    _fillOrder(makerOrder, makerSignature, sender, sender, makerOrder.sellToken, makerOrder.buyToken, takerBuyAmount, fillAvailable);
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
    address payable sender = _msgSender();
    _fillOrder(makerOrder, makerSignature, sender, sender, makerOrder.sellToken, makerOrder.buyToken, takerBuyAmount, fillAvailable);
    return true;
  }

  function _fillOrder(
    LibOrder.Order calldata makerOrder,
    bytes calldata makerSignature,
    address taker,
    address takerReciver,
    address sellToken,
    address buyToken,
    uint takerBuyAmountAdjusted,
    bool fillAvailable
  ) internal returns (uint256) {
    require(takerReciver != ETH_ADDRESS, "Can't recive to zero address");

    LibOrder.OrderInfo memory makerOrderInfo = getOpenOrder(makerOrder);

    // Check if the order is valid. We dont want to revert if the user wants to fill whats available, worst case that is 0.
    {
      (bool isValidOrder, string memory errorMsgOrder) = _isValidOrder(makerOrderInfo, makerOrder, makerSignature);
      if (!isValidOrder && fillAvailable) return 0;
      require(isValidOrder, errorMsgOrder);
    }

    // adjust taker amount
    uint256 takerSellAmount;
    {
      uint256 availableTakerSellSize = makerOrder.sellAmount - makerOrderInfo.orderSellFilledAmount;
      if (fillAvailable && availableTakerSellSize < takerBuyAmountAdjusted) takerBuyAmountAdjusted = availableTakerSellSize;
      takerSellAmount = (takerBuyAmountAdjusted * makerOrder.buyAmount) / makerOrder.sellAmount;
      require(takerBuyAmountAdjusted <= availableTakerSellSize, 'amount exceeds available size');
    }

    // check the maker balance/allowance with the adjusted taker amount
    {
      (bool isValidMaker, string memory errorMsgMaker) = _isValidMaker(makerOrder.user, sellToken, takerBuyAmountAdjusted);
      if (!isValidMaker && fillAvailable) return 0;
      require(isValidMaker, errorMsgMaker);
    }

    // mark fills in storage
    _updateOrderStatus(makerOrderInfo, makerOrder.sellAmount, takerBuyAmountAdjusted);

    _settleMatchedOrders(makerOrder.user, taker, takerReciver, sellToken, buyToken, takerBuyAmountAdjusted, takerSellAmount);

    return takerBuyAmountAdjusted;
  }

  function _settleMatchedOrders(
    address maker,
    address taker,
    address takerReciver,
    address makerSellToken,
    address takerSellToken,
    uint makerSellAmount,
    uint takerSellAmount
  ) internal {
    if (takerSellToken == ETH_ADDRESS) {
      require(msg.value >= takerSellAmount, 'msg value not high enough');
    } else if (taker != EXCHANGE_ADDRESS) {
      require(IERC20(takerSellToken).balanceOf(taker) >= takerSellAmount, 'taker order not enough balance');
      require(IERC20(takerSellToken).allowance(taker, EXCHANGE_ADDRESS) >= takerSellAmount, 'taker order not enough allowance');
    }

    // taker -> maker
    if (takerSellToken == ETH_ADDRESS) {
      IWETH9(WETH_ADDRESS).depositTo{ value: takerSellAmount }(maker);
    } else if (taker == EXCHANGE_ADDRESS) {
      IERC20(takerSellToken).transfer(maker, takerSellAmount);
    } else {
      IERC20(takerSellToken).transferFrom(taker, maker, takerSellAmount);
    }

    // maker -> taker
    if (makerSellToken == ETH_ADDRESS) {
      IERC20(WETH_ADDRESS).transferFrom(maker, EXCHANGE_ADDRESS, makerSellAmount);
      IWETH9(WETH_ADDRESS).withdrawTo(takerReciver, makerSellAmount);
    } else {
      IERC20(makerSellToken).transferFrom(maker, takerReciver, makerSellAmount);
    }

    emit Swap(maker, taker, makerSellToken, takerSellToken, makerSellAmount, takerSellAmount);
  }

  function getOpenOrder(LibOrder.Order calldata order) public view returns (LibOrder.OrderInfo memory orderInfo) {
    orderInfo.orderHash = getOrderHash(order);
    orderInfo.orderSellFilledAmount = filled[orderInfo.orderHash];
  }

  function getOrderHash(LibOrder.Order calldata order) public view returns (bytes32 orderHash) {
    bytes32 contentHash = LibOrder.getContentHash(order);
    orderHash = _hashTypedDataV4(contentHash);
  }

  function isValidOrderSignature(LibOrder.Order calldata order, bytes calldata signature) public view returns (bool) {
    bytes32 orderHash = getOrderHash(order);
    return _isValidSignatureHash(order.user, orderHash, signature);
  }

  function _isValidSignatureHash(address user, bytes32 hash, bytes calldata signature) private view returns (bool) {
    return SignatureChecker.isValidSignatureNow(user, hash, signature);
  }

  // always refund the one sending the msg, metaTx or nativeTx
  function _refundETH() internal {
    if (address(this).balance > 0) {
      (bool success, ) = msg.sender.call{ value: address(this).balance }(new bytes(0));
      require(success, 'ETH transfer failed');
    }
  }

  function _isValidOrder(
    LibOrder.OrderInfo memory orderInfo,
    LibOrder.Order calldata order,
    bytes calldata signature
  ) internal view returns (bool, string memory) {
    if (!_isValidSignatureHash(order.user, orderInfo.orderHash, signature)) return (false, 'invalid maker signature');
    if (cancelled[orderInfo.orderHash]) return (false, 'order canceled');
    if (block.timestamp > order.expirationTimeSeconds) return (false, 'order expired');
    if (order.sellAmount - orderInfo.orderSellFilledAmount == 0) return (false, 'order is filled');

    return (true, '');
  }

  function _isValidMaker(address maker, address makerSellToken, uint256 takerAmount) internal view returns (bool, string memory) {
    if (makerSellToken == ETH_ADDRESS) makerSellToken = WETH_ADDRESS;
    uint256 balance = IERC20(makerSellToken).balanceOf(maker);
    uint256 allowance = IERC20(makerSellToken).allowance(maker, EXCHANGE_ADDRESS);
    if (balance < takerAmount) return (false, 'maker order not enough balance');
    if (allowance < takerAmount) return (false, 'maker order not enough allowance');

    return (true, '');
  }

  function _updateOrderStatus(LibOrder.OrderInfo memory makerOrderInfo, uint256 makerSellAmount, uint256 takerBuyAmount) internal {
    uint makerOrderFilled = makerOrderInfo.orderSellFilledAmount + takerBuyAmount;
    filled[makerOrderInfo.orderHash] = makerOrderFilled;

    emit OrderStatus(makerOrderInfo.orderHash, makerOrderFilled, makerSellAmount - makerOrderFilled);
  }

  // EIP2771 implementation, see https://eips.ethereum.org/EIPS/eip-2771
  function isTrustedForwarder(address forwarder) public view returns (bool) {
    return forwarder == TRUSTED_FORWARDER;
  }

  function _msgSender() internal view returns (address payable signer) {
    signer = payable(msg.sender);
    if (msg.data.length >= 20 && isTrustedForwarder(signer)) {
      assembly {
        signer := shr(96, calldataload(sub(calldatasize(), 20)))
      }
    }
  }
}
