//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library LibBytes {

    using LibBytes for bytes;

    function readBytes32(
        bytes memory b,
        uint256 index
    )
        internal
        pure
        returns (bytes32 result)
    {
        require(b.length >= index, "BytesLib: length");

        // Arrays are prefixed by a 256 bit length parameter
        index += 32;

        // Read the bytes32 from array memory
        assembly {
            result := mload(add(b, index))
        }
        return result;
    }


}