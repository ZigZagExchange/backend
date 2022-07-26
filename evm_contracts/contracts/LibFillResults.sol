//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./LibOrder.sol";
import "./LibMath.sol";


library LibFillResults {

    struct FillResults {
        uint256 makerAssetFilledAmount;  // Total amount of makerAsset(s) filled.
        uint256 takerAssetFilledAmount;  // Total amount of takerAsset(s) filled.
        uint256 makerFeePaid;            // Total amount of fees paid by maker(s) to feeRecipient(s).
        uint256 takerFeePaid;            // Total amount of fees paid by taker to feeRecipients(s).
    }

    struct MatchedFillResults {
        FillResults left;                // Amounts filled and fees paid of left order.
        FillResults right;               // Amounts filled and fees paid of right order.
    }

    function calculateMatchedFillResults(
        LibOrder.Order memory leftOrder,
        LibOrder.Order memory rightOrder,
        uint256 leftOrderTakerAssetFilledAmount,
        uint256 rightOrderTakerAssetFilledAmount
     ) internal pure returns(MatchedFillResults memory matchedFillResults){


        uint256 leftTakerAssetAmountRemaining = leftOrder.takerAssetAmount - leftOrderTakerAssetFilledAmount;
        uint256 leftMakerAssetAmountRemaining = LibMath.safeGetPartialAmountFloor(
            leftOrder.makerAssetAmount,
            leftOrder.takerAssetAmount,
            leftTakerAssetAmountRemaining
        );

        uint256 rightTakerAssetAmountRemaining = rightOrder.takerAssetAmount - rightOrderTakerAssetFilledAmount;
        uint256 rightMakerAssetAmountRemaining = LibMath.safeGetPartialAmountFloor(
            rightOrder.makerAssetAmount,
            rightOrder.takerAssetAmount,
            rightTakerAssetAmountRemaining
        ) ;

        matchedFillResults = _calculateMatchedFillResultsWithMaximalFill(leftOrder,
            rightOrder,
            leftMakerAssetAmountRemaining,
            leftTakerAssetAmountRemaining,
            rightMakerAssetAmountRemaining,
            rightTakerAssetAmountRemaining
        );
        

        // Compute fees for left order
        matchedFillResults.left.makerFeePaid = LibMath.safeGetPartialAmountFloor(
            matchedFillResults.left.makerAssetFilledAmount,
            leftOrder.makerAssetAmount,
            leftOrder.makerVolumeFee
        );
        matchedFillResults.right.takerFeePaid = LibMath.safeGetPartialAmountFloor(
            matchedFillResults.right.makerAssetFilledAmount,
            rightOrder.makerAssetAmount,
            rightOrder.takerVolumeFee
        );

    }

    function _calculateMatchedFillResultsWithMaximalFill(
        LibOrder.Order memory leftOrder,
        LibOrder.Order memory rightOrder,
        uint256 leftMakerAssetAmountRemaining,
        uint256 leftTakerAssetAmountRemaining,
        uint256 rightMakerAssetAmountRemaining,
        uint256 rightTakerAssetAmountRemaining
    )
        private
        pure
        returns (MatchedFillResults memory matchedFillResults)
    {
        
        // Calculate the maximum fill results for the maker and taker assets. At least one of the orders will be fully filled.
        //
        // The maximum that the left maker can possibly buy is the amount that the right order can sell.
        // The maximum that the right maker can possibly buy is the amount that the left order can sell.
        //
        // If the left order is fully filled, profit will be paid out in the left maker asset. If the right order is fully filled,
        // the profit will be out in the right maker asset.
        //
        // There are three cases to consider:
        // Case 1.
        //   If the left maker can buy more or the same as the right maker can sell, then the right order is fully filled, but at the price of the left order.
        // Case 2.
        //   If the right maker can buy more or the same as the left maker can sell, then the left order is fully filled, at the price of the left order.

        if (leftTakerAssetAmountRemaining >= rightMakerAssetAmountRemaining) {
            matchedFillResults.left.takerAssetFilledAmount = rightMakerAssetAmountRemaining;
            matchedFillResults.left.makerAssetFilledAmount = LibMath.safeGetPartialAmountFloor(
                leftOrder.makerAssetAmount,
                leftOrder.takerAssetAmount,
                rightMakerAssetAmountRemaining
            );
            matchedFillResults.right.makerAssetFilledAmount = rightMakerAssetAmountRemaining;
            matchedFillResults.right.takerAssetFilledAmount = matchedFillResults.left.makerAssetFilledAmount;
        }
        else if (rightTakerAssetAmountRemaining >= leftMakerAssetAmountRemaining) {
            matchedFillResults.left.makerAssetFilledAmount = leftMakerAssetAmountRemaining;
            matchedFillResults.left.takerAssetFilledAmount = leftTakerAssetAmountRemaining;
            matchedFillResults.right.makerAssetFilledAmount = LibMath.safeGetPartialAmountCeil(
                rightOrder.makerAssetAmount,
                rightOrder.takerAssetAmount,
                leftMakerAssetAmountRemaining
            );
            matchedFillResults.right.takerAssetFilledAmount = leftMakerAssetAmountRemaining;
        }
        else {
            require(false, "not profitable spread");
        }

        return matchedFillResults;
    }

}
