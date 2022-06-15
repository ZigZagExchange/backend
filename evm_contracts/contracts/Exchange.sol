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

        require(msg.sender == order.makerAddress, "only maker may cancel order");

        LibOrder.OrderInfo memory orderInfo = getOrderInfo(order);

        cancelled[orderInfo.orderHash] = true;
    }
    
   function matchOrders(
       LibOrder.Order memory leftOrder,
       LibOrder.Order memory rightOrder,
       bytes memory leftSignature,
       bytes memory rightSignature,
       bool shouldMaximallyFillOrders
   )
   public returns(LibFillResults.MatchedFillResults memory matchedFillResults){

        //check that tokens address match, will fail in signature check if false
        rightOrder.makerToken = leftOrder.takerToken;
        rightOrder.takerToken = leftOrder.makerToken;

        LibOrder.OrderInfo memory leftOrderInfo = getOrderInfo(leftOrder);
        LibOrder.OrderInfo memory rightOrderInfo = getOrderInfo(rightOrder);
       
     
        require(rightOrderInfo.orderStatus == LibOrder.OrderStatus.FILLABLE, "right order status not Fillable");
        require(leftOrderInfo.orderStatus == LibOrder.OrderStatus.FILLABLE, "left order status not Fillable");

        //validate signature
        require(_isValidOrderWithHashSignature(rightOrderInfo.orderHash, rightSignature, rightOrder.makerAddress),"invalid right signature");
        require(_isValidOrderWithHashSignature(leftOrderInfo.orderHash, leftSignature, leftOrder.makerAddress),"invalid left signature");
        
        address takerAddress = msg.sender;

        // Make sure there is a profitable spread.
        // There is a profitable spread iff the cost per unit bought (OrderA.MakerAmount/OrderA.TakerAmount) for each order is greater
        // than the profit per unit sold of the matched order (OrderB.TakerAmount/OrderB.MakerAmount).
        // This is satisfied by the equations below:
        // <leftOrder.makerAssetAmount> / <leftOrder.takerAssetAmount> >= <rightOrder.takerAssetAmount> / <rightOrder.makerAssetAmount>
        // AND
        // <rightOrder.makerAssetAmount> / <rightOrder.takerAssetAmount> >= <leftOrder.takerAssetAmount> / <leftOrder.makerAssetAmount>
        // These equations can be combined to get the following:
        require(!(leftOrder.makerAssetAmount * rightOrder.makerAssetAmount <
            leftOrder.takerAssetAmount * rightOrder.takerAssetAmount),"not profitable spread");

        matchedFillResults = LibFillResults.calculateMatchedFillResults(
            leftOrder,
            rightOrder,
            leftOrderInfo.orderTakerAssetFilledAmount,
            rightOrderInfo.orderTakerAssetFilledAmount,
            shouldMaximallyFillOrders
        );
        
        
        _updateFilledState(
            leftOrderInfo.orderHash,
            matchedFillResults.left.takerAssetFilledAmount
        );

        _updateFilledState(
            rightOrderInfo.orderHash,
            matchedFillResults.right.takerAssetFilledAmount
        );

        _settleMatchedOrders(
            leftOrder,
            rightOrder,
            takerAddress,
            matchedFillResults
        );

        return matchedFillResults;
   }



    function _settleMatchedOrders(
        LibOrder.Order memory leftOrder,
        LibOrder.Order memory rightOrder,
        address takerAddress,
        LibFillResults.MatchedFillResults memory matchedFillResults
    )
    internal{
        
        // Right maker asset -> left maker
        IERC20(rightOrder.makerToken).transferFrom(rightOrder.makerAddress, leftOrder.makerAddress, matchedFillResults.left.takerAssetFilledAmount);
       
        // Left maker asset -> right maker
        IERC20(leftOrder.makerToken).transferFrom(leftOrder.makerAddress, rightOrder.makerAddress, matchedFillResults.right.takerAssetFilledAmount);
        
        // Right maker fee -> right fee recipient
        IERC20(rightOrder.makerToken).transferFrom(rightOrder.makerAddress, rightOrder.feeRecipientAddress, matchedFillResults.right.makerFeePaid);
       
        // Left maker fee -> left fee recipient
        IERC20(leftOrder.makerToken).transferFrom(leftOrder.makerAddress, leftOrder.feeRecipientAddress, matchedFillResults.left.makerFeePaid);
 

        // Settle taker profits.
        IERC20(rightOrder.makerToken).transferFrom(rightOrder.makerAddress, takerAddress, matchedFillResults.profitInRightMakerAsset);
        IERC20(leftOrder.makerToken).transferFrom(leftOrder.makerAddress, takerAddress, matchedFillResults.profitInLeftMakerAsset);
       

        // In 0x they transfer taker fee to the fee recipient skipped this for now
        //IERC20(rightOrder.makerToken).transferFrom(takerAddress, rightOrder.feeRecipientAddress, matchedFillResults.right.takerFeePaid);
        //IERC20(leftOrder.makerToken).transferFrom(takerAddress, leftOrder.feeRecipientAddress, matchedFillResults.left.takerFeePaid);
    }


    function _updateFilledState(bytes32 orderHash, uint256 orderTakerAssetFilledAmount) internal{
       
        filled[orderHash] += orderTakerAssetFilledAmount;
    }

    function getOrderInfo(LibOrder.Order memory order) public view returns(LibOrder.OrderInfo memory orderInfo){
        (orderInfo.orderHash, orderInfo.orderTakerAssetFilledAmount) = _getOrderHashAndFilledAmount(order);
        
        if (order.makerAssetAmount == 0) {
            orderInfo.orderStatus = LibOrder.OrderStatus.INVALID_MAKER_ASSET_AMOUNT;
            return orderInfo;
        }

        if (order.takerAssetAmount == 0) {
            orderInfo.orderStatus = LibOrder.OrderStatus.INVALID_TAKER_ASSET_AMOUNT;
            return orderInfo;
        }

        if (orderInfo.orderTakerAssetFilledAmount >= order.takerAssetAmount) {
            orderInfo.orderStatus = LibOrder.OrderStatus.FULLY_FILLED;
            return orderInfo;
        }

        //Not yet implemented
        // if (block.timestamp >= order.expirationTimeSeconds) {
        //     orderInfo.orderStatus = LibOrder.OrderStatus.EXPIRED;
        //     return orderInfo;
        // }

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
        returns (bytes32 orderHash, uint256 orderTakerAssetFilledAmount)
    {
        orderHash = order.getOrderHash();
        orderTakerAssetFilledAmount = filled[orderHash];
        return (orderHash, orderTakerAssetFilledAmount);
    }

}