//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library LibMath {
  function safeGetPartialAmountFloor(
    uint256 numerator,
    uint256 denominator,
    uint256 target
  ) internal pure returns (uint256 partialAmount) {
    require(!isRoundingErrorFloor(numerator, denominator, target), 'floor rounding error >= 0.1%');
    partialAmount = (numerator * target) / denominator;
  }

  function safeGetPartialAmountCeil(
    uint256 numerator,
    uint256 denominator,
    uint256 target
  ) internal pure returns (uint256 partialAmount) {
    require(!isRoundingErrorCeil(numerator, denominator, target), 'ceil rounding error >= 0.1%');

    // safeDiv computes `floor(a / b)`. We use the identity (a, b integer):
    //       ceil(a / b) = floor((a + b - 1) / b)
    // To implement `ceil(a / b)` using safeDiv.
    partialAmount = (numerator * (target + (denominator - 1))) / denominator;
  }

  function isRoundingErrorFloor(
    uint256 numerator,
    uint256 denominator,
    uint256 target
  ) internal pure returns (bool isError) {
    require(denominator != 0, 'error denominator is zero');
    if (target == 0 || numerator == 0) {
      return false;
    }
    uint256 remainder = mulmod(target, numerator, denominator);
    isError = remainder * 1000 >= numerator * target;
  }

  function isRoundingErrorCeil(
    uint256 numerator,
    uint256 denominator,
    uint256 target
  ) internal pure returns (bool isError) {
    require(denominator != 0, 'error denominator is zero');

    // See the comments in `isRoundingError`.
    if (target == 0 || numerator == 0) {
      // When either is zero, the ideal value and rounded value are zero
      // and there is no rounding error. (Although the relative error
      // is undefined.)
      return false;
    }
    // Compute remainder as before
    uint256 remainder = mulmod(target, numerator, denominator);
    remainder = (denominator - remainder) % denominator;
    isError = remainder * 1000 >= numerator * target;
  }
}
