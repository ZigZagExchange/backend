//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./LibOrder.sol";
import "./LibMath.sol";


library LibFillResults {

    struct FillResults {
        uint256 sellFilledAmount;      // The amount sold by the user in the sell token
        uint256 buyFilledAmount;       // The amount received by the user in the buy token
        uint256 feePaid;               // Total amount of fees paid in sell token to feeRecipient(s).
    }

    struct MatchedFillResults {
        FillResults maker;                // Amounts filled and fees paid of maker order.
        FillResults taker;               // Amounts filled and fees paid of taker order.
    }

    function calculateMatchedFillResults(
        LibOrder.Order memory makerOrder,
        LibOrder.Order memory takerOrder,
        uint256 makerOrderBuyFilledAmount,
        uint256 takerOrderBuyFilledAmount
     ) internal pure returns(MatchedFillResults memory matchedFillResults){


        uint256 makerBuyAmountRemaining = makerOrder.buyAmount - makerOrderBuyFilledAmount;
        uint256 makerSellAmountRemaining = LibMath.safeGetPartialAmountFloor(
            makerOrder.sellAmount,
            makerOrder.buyAmount,
            makerBuyAmountRemaining
        );

        uint256 takerBuyAmountRemaining = takerOrder.buyAmount - takerOrderBuyFilledAmount;
        uint256 takerSellAmountRemaining = LibMath.safeGetPartialAmountFloor(
            takerOrder.sellAmount,
            takerOrder.buyAmount,
            takerBuyAmountRemaining
        ) ;

        matchedFillResults = _calculateMatchedFillResultsWithMaximalFill(
            makerOrder,
            makerSellAmountRemaining,
            makerBuyAmountRemaining,
            takerSellAmountRemaining
        );
        

        // Compute fees for maker order
        matchedFillResults.maker.feePaid = LibMath.safeGetPartialAmountFloor(
            matchedFillResults.maker.sellFilledAmount,
            makerOrder.sellAmount,
            makerOrder.makerVolumeFee
        );
        matchedFillResults.taker.feePaid = LibMath.safeGetPartialAmountFloor(
            matchedFillResults.taker.sellFilledAmount,
            takerOrder.sellAmount,
            takerOrder.takerVolumeFee
        );

    }

    function _calculateMatchedFillResultsWithMaximalFill(
        LibOrder.Order memory makerOrder,
        uint256 makerSellAmountRemaining,
        uint256 makerBuyAmountRemaining,
        uint256 takerSellAmountRemaining
    )
        private
        pure
        returns (MatchedFillResults memory matchedFillResults)
    {
        
        // Calculate the maximum fill results for the maker and taker assets. At least one of the orders will be fully filled.
        //
        // The maximum that the maker maker can possibly buy is the amount that the taker order can sell.
        // The maximum that the taker maker can possibly buy is the amount that the maker order can sell.
        //
        // If the maker order is fully filled, profit will be paid out in the maker maker asset. If the taker order is fully filled,
        // the profit will be out in the taker maker asset.
        //
        // There are three cases to consider:
        // Case 1.
        //   If the maker can buy more or the same as the taker can sell, then the taker order is fully filled, but at the price of the maker order.
        // Case 2.
        //   If the taker can buy more or the same as the maker can sell, then the maker order is fully filled, at the price of the maker order.
        // Case 3.
        //   Both orders can be filled fully so we can default to case 2

        if (makerBuyAmountRemaining >= takerSellAmountRemaining) {
            matchedFillResults.maker.buyFilledAmount = takerSellAmountRemaining;
            matchedFillResults.maker.sellFilledAmount = LibMath.safeGetPartialAmountFloor(
                makerOrder.sellAmount,
                makerOrder.buyAmount,
                takerSellAmountRemaining
            );
            matchedFillResults.taker.sellFilledAmount = takerSellAmountRemaining;
            matchedFillResults.taker.buyFilledAmount = matchedFillResults.maker.sellFilledAmount;
        }
        else {
            matchedFillResults.maker.sellFilledAmount = makerSellAmountRemaining;
            matchedFillResults.maker.buyFilledAmount = makerBuyAmountRemaining;
            matchedFillResults.taker.sellFilledAmount = makerBuyAmountRemaining;
            matchedFillResults.taker.buyFilledAmount = makerSellAmountRemaining;
        }

        return matchedFillResults;
    }

}
