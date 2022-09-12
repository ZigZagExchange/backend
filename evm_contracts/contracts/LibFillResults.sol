//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./LibOrder.sol";
import "./LibMath.sol";


library LibFillResults {

    struct MatchedFillResults {
        uint256 makerSellFilledAmount;      // The amount sold by the maker in the maker sell token
        uint256 takerSellFilledAmount;      // The amount received by the taker in the taker sell token
        uint256 makerFeePaid;               // The fee paid by the maker in the maker sell token
        uint256 takerFeePaid;               // The fee paid by the taker in the taker sell token
    }

    function calculateMatchedFillResults(
        LibOrder.Order memory makerOrder,
        LibOrder.Order memory takerOrder,
        uint256 makerOrderBuyFilledAmount,
        uint256 takerOrderBuyFilledAmount,
        uint256 maker_fee_numerator,
        uint256 maker_fee_denominator,
        uint256 taker_fee_numerator,
        uint256 taker_fee_denominator
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
        

        // Compute volume fees
        matchedFillResults.makerFeePaid = matchedFillResults.makerSellFilledAmount * maker_fee_numerator / maker_fee_denominator;
        matchedFillResults.takerFeePaid = matchedFillResults.takerSellFilledAmount * taker_fee_numerator / taker_fee_denominator;
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
            matchedFillResults.makerSellFilledAmount = LibMath.safeGetPartialAmountFloor(
                makerOrder.sellAmount,
                makerOrder.buyAmount,
                takerSellAmountRemaining
            );
            matchedFillResults.takerSellFilledAmount = takerSellAmountRemaining;
        }
        else {
            matchedFillResults.makerSellFilledAmount = makerSellAmountRemaining;
            matchedFillResults.takerSellFilledAmount = makerBuyAmountRemaining;
        }

        return matchedFillResults;
    }

}
