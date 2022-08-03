//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./LibOrder.sol";
import "./LibFillResults.sol";
import "./SignatureValidator.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

//import "hardhat/console.sol";

contract Exchange is SignatureValidator{

    using LibOrder for LibOrder.Order;

    mapping (bytes32 => uint256) public filled;

    mapping (bytes32 => bool) public cancelled;

    function cancelOrder(
        LibOrder.Order memory order
    ) public{   

        require(msg.sender == order.user, "only user may cancel order");

        LibOrder.OrderInfo memory orderInfo = getOrderInfo(order);

        cancelled[orderInfo.orderHash] = true;
    }
    
   function matchOrders(
       LibOrder.Order memory makerOrder, 
       LibOrder.Order memory takerOrder,
       bytes memory makerSignature,
       bytes memory takerSignature
   )
   public returns(LibFillResults.MatchedFillResults memory matchedFillResults){

        //check that tokens address match, will fail in signature check if false
        takerOrder.sellToken = makerOrder.buyToken;
        takerOrder.buyToken = makerOrder.sellToken;

        LibOrder.OrderInfo memory makerOrderInfo = getOrderInfo(makerOrder);
        LibOrder.OrderInfo memory takerOrderInfo = getOrderInfo(takerOrder);
       
     
        require(takerOrderInfo.orderStatus == LibOrder.OrderStatus.FILLABLE, "taker order status not Fillable");
        require(makerOrderInfo.orderStatus == LibOrder.OrderStatus.FILLABLE, "maker order status not Fillable");

        //validate signature
        require(msg.sender == takerOrder.user || _isValidOrderWithHashSignature(takerOrderInfo.orderHash, takerSignature, takerOrder.user), "invalid taker signature");
        require(msg.sender == makerOrder.user || _isValidOrderWithHashSignature(makerOrderInfo.orderHash, makerSignature, makerOrder.user),"invalid maker signature");
        
        // Make sure there is a profitable spread.
        // There is a profitable spread iff the cost per unit bought (OrderA.SellAmount/OrderA.BuyAmount) for each order is greater
        // than the profit per unit sold of the matched order (OrderB.BuyAmount/OrderB.SellAmount).
        // This is satisfied by the equations below:
        // <makerOrder.sellAmount> / <makerOrder.buyAmount> >= <takerOrder.buyAmount> / <takerOrder.sellAmount>
        // AND
        // <takerOrder.sellAmount> / <takerOrder.buyAmount> >= <makerOrder.buyAmount> / <makerOrder.sellAmount>
        // These equations can be combined to get the following:
        require(
            makerOrder.sellAmount * takerOrder.sellAmount >= makerOrder.buyAmount * takerOrder.buyAmount, 
            "not profitable spread"
        );

        matchedFillResults = LibFillResults.calculateMatchedFillResults(
            makerOrder,
            takerOrder,
            makerOrderInfo.orderBuyFilledAmount,
            takerOrderInfo.orderBuyFilledAmount
        );
        
        
        _updateFilledState(
            makerOrderInfo.orderHash,
            matchedFillResults.maker.buyFilledAmount
        );

        _updateFilledState(
            takerOrderInfo.orderHash,
            matchedFillResults.taker.buyFilledAmount
        );

        _settleMatchedOrders(
            makerOrder,
            takerOrder,
            matchedFillResults
        );

        return matchedFillResults;
   }



    function _settleMatchedOrders(
        LibOrder.Order memory makerOrder,
        LibOrder.Order memory takerOrder,
        LibFillResults.MatchedFillResults memory matchedFillResults
    )
    internal{
        require(
            IERC20(takerOrder.sellToken).balanceOf(takerOrder.user) >= matchedFillResults.maker.buyFilledAmount,
            "taker order not enough balance"
        );
        require(
            IERC20(makerOrder.sellToken).balanceOf(makerOrder.user) >= matchedFillResults.taker.buyFilledAmount,
            "maker order not enough balance"
        );
        
        // Right maker asset -> maker maker
        IERC20(takerOrder.sellToken).transferFrom(takerOrder.user, makerOrder.user, matchedFillResults.maker.buyFilledAmount);
       
        // Left maker asset -> taker maker
        IERC20(makerOrder.sellToken).transferFrom(makerOrder.user, takerOrder.user, matchedFillResults.taker.buyFilledAmount);


        /*
            Fees Paid 
        */
        // Taker fee + gas fee -> fee recipient
        uint takerOrderFees = matchedFillResults.taker.feePaid + takerOrder.gasFee;
        if (takerOrderFees > 0) {
            require(
                IERC20(takerOrder.sellToken).balanceOf(takerOrder.user) >= takerOrderFees,
                "taker order not enough balance for fee"
            );
            IERC20(takerOrder.sellToken).transferFrom(takerOrder.user, takerOrder.feeRecipientAddress, takerOrderFees);
        }
       
        // Maker fee -> fee recipient
        if (matchedFillResults.maker.feePaid > 0) {
            require(
                IERC20(makerOrder.sellToken).balanceOf(makerOrder.user) >= matchedFillResults.maker.feePaid,
                "maker order not enough balance for fee"
            );
            IERC20(makerOrder.sellToken).transferFrom(makerOrder.user, makerOrder.feeRecipientAddress, matchedFillResults.maker.feePaid);
        }

    }


    function _updateFilledState(bytes32 orderHash, uint256 orderBuyFilledAmount) internal{
       
        filled[orderHash] += orderBuyFilledAmount;
    }

    function getOrderInfo(LibOrder.Order memory order) public view returns(LibOrder.OrderInfo memory orderInfo){
        (orderInfo.orderHash, orderInfo.orderBuyFilledAmount) = _getOrderHashAndFilledAmount(order);
        
        if (order.sellAmount == 0) {
            orderInfo.orderStatus = LibOrder.OrderStatus.INVALID_MAKER_ASSET_AMOUNT;
            return orderInfo;
        }

        if (order.buyAmount == 0) {
            orderInfo.orderStatus = LibOrder.OrderStatus.INVALID_TAKER_ASSET_AMOUNT;
            return orderInfo;
        }

        if (orderInfo.orderBuyFilledAmount >= order.buyAmount) {
            orderInfo.orderStatus = LibOrder.OrderStatus.FULLY_FILLED;
            return orderInfo;
        }

       
        if (block.timestamp >= order.expirationTimeSeconds) {
            orderInfo.orderStatus = LibOrder.OrderStatus.EXPIRED;
            return orderInfo;
        }

        if (cancelled[orderInfo.orderHash]) {
            orderInfo.orderStatus = LibOrder.OrderStatus.CANCELLED;
            return orderInfo;
        }

        orderInfo.orderStatus = LibOrder.OrderStatus.FILLABLE;
        return orderInfo;
    }

    function _getOrderHashAndFilledAmount(LibOrder.Order memory order)
        internal
        view
        returns (bytes32 orderHash, uint256 orderBuyFilledAmount)
    {
        orderHash = order.getOrderHash();
        orderBuyFilledAmount = filled[orderHash];
        return (orderHash, orderBuyFilledAmount);
    }

}
