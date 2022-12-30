//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract ZigZagFutures is ERC20 {

  /////////////////////////////////////////////////////////////////////
  // Definitions & Variables

  struct Order {
    address user; //address of the Order Creator making the sale
    string asset ; // unique identifier for the asset being traded
    address buyToken; // address of the Token the Order Creator wants to receive in return
    uint256 sellAmount; // amount of Token that the Order Creator wants to sell
    uint256 buyAmount; // amount of Token that the Order Creator wants to receive in return
    uint256 expirationTimeSeconds; //time after which the order is no longer valid
  }

  // The manager of a vault is allowed to sign orders that a vault can execute
  address public manager;

  // Only USDC is permitted as collateral
  address public USDC_ADDRESS;

  // Track USDC collateral 
  mapping(address => uint) collateral;

  // Track positions, first by address then by asset
  mapping(address => mapping (address => uint)) positions;


  /////////////////////////////////////////////////////////////////////
  // Basic Functions

  constructor(address _manager, address _usdc_address, string memory _name, string memory _symbol) ERC20(_name, _symbol) {
    manager = _manager;
    USDC_ADDRESS = _usdc_address;
  }

  function updateManager(address newManager) public {
    require(msg.sender == manager, "only manager can update manager");
    manager = newManager;
  }

  /////////////////////////////////////////////////////////////////////
  // The manager can use mintLPToken and burnLPToken to set LP limits 
  // The LP tokens are then swapped for user funds

  function mintLPToken(uint amount) public {
    require(msg.sender == manager, "only manager can mint LP tokens");
    _mint(address(this), amount);
  }

  function burnLPToken(uint amount) public {
    require(msg.sender == manager, "only manager can burn LP tokens");
    _burn(address(this), amount);
  }

  // LP token circulating supply does not include balance of vault
  function circulatingSupply() public view returns (uint) {
    return totalSupply() - balanceOf(address(this));
  }


  //////////////////////////////////////////////////////////////////////
  // Exchange Functionality

}
