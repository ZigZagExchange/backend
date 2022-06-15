//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./LibOrder.sol";
import "./LibBytes.sol";

contract SignatureValidator{

    using LibOrder for LibOrder.Order;
    using LibBytes for bytes;

    function isValidSignature(LibOrder.Order memory order, bytes memory signature) public pure returns (bool isValid){
        bytes32 orderHash = order.getOrderHash();

        address signerAddress = order.makerAddress;

           uint8 v = uint8(signature[0]);
           bytes32 r = signature.readBytes32(1);
           bytes32 s = signature.readBytes32(33);
           address recovered = ecrecover(
                orderHash,
                v,
                r,
                s
            );
           isValid = recovered == signerAddress;
            return isValid;
    }
    
    function _isValidOrderWithHashSignature(bytes32 orderHash, bytes memory signature, address signerAddress) internal pure returns( bool isValid){
            uint8 v = uint8(signature[0]);
            bytes32 r = signature.readBytes32(1);
            bytes32 s = signature.readBytes32(33);
            address recovered = ecrecover(
                    orderHash,
                    v,
                    r,
                    s
                );
            isValid = recovered == signerAddress;
            return isValid;
    }
    
}