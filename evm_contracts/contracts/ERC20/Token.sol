//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Token is ERC20{

    constructor() ERC20("Token", "TK"){

    }

    function mint(uint256 amount, address recipient) external{
        _mint( recipient, amount);
    }
}