//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract ZigZagBTCBridge is ERC20 {
  // The manager of a vault is allowed to sign orders that a vault can execute
  address public manager;

  // Set this address on construction to restrict token transfers
  address immutable public WBTC_ADDRESS;
  uint public constant WBTC_DECIMALS = 8;

  // Deposit Rates are on a per second basis
  uint public DEPOSIT_RATE_NUMERATOR = 0;
  uint public constant DEPOSIT_RATE_DENOMINATOR = 1e12;

  // LP_PRICE is calculated against WBTC
  // The initial price is set to 1, then updated based on the deposit rate
  uint public LP_PRICE_NUMERATOR = DEPOSIT_RATE_DENOMINATOR;
  uint public constant LP_PRICE_DENOMINATOR = DEPOSIT_RATE_DENOMINATOR;
  uint public LAST_PRICE_UPDATE;

  // Hash Tracking for swaps
  // The key for the mappings is the hash
  struct HTLC {
    address counterparty;
    uint wbtc_amount;
    uint expiry;
  }
  mapping(bytes32 => HTLC) DEPOSIT_HASHES;
  mapping(bytes32 => HTLC) WITHDRAW_HASHES;

  constructor(address _manager, address _wbtc_address) ERC20("ZigZag WBTC LP", "ZWBTCLP") {
    manager = _manager;
    WBTC_ADDRESS = _wbtc_address;
    LAST_PRICE_UPDATE = block.timestamp;
  }

  function updateManager(address newManager) public {
    require(msg.sender == manager, "only manager can update manager");
    manager = newManager;
  }

  function setDepositRate(uint deposit_rate_numerator) public {
    require(msg.sender == manager, "only manager can set deposit rate");
    updateLPPrice();
    DEPOSIT_RATE_NUMERATOR = deposit_rate_numerator;
  }

  function updateLPPrice() public {
    LP_PRICE_NUMERATOR += DEPOSIT_RATE_NUMERATOR * (block.timestamp - LAST_PRICE_UPDATE);
    LAST_PRICE_UPDATE = block.timestamp;
  }

  function depositWBTCToLP(uint wbtc_amount) public {
    IERC20(WBTC_ADDRESS).transferFrom(msg.sender, address(this), wbtc_amount);

    updateLPPrice();
    uint lp_amount = wbtc_amount * LP_PRICE_DENOMINATOR * 10**decimals() / 10**WBTC_DECIMALS / LP_PRICE_NUMERATOR;

    _mint(msg.sender, lp_amount);
  }

  function withdrawWBTCFromLP(uint lp_amount) public {
    updateLPPrice();
    uint wbtc_amount = lp_amount * LP_PRICE_NUMERATOR * 10**WBTC_DECIMALS / LP_PRICE_DENOMINATOR / 10**decimals();

    _burn(msg.sender, lp_amount);
    IERC20(WBTC_ADDRESS).transfer(msg.sender, wbtc_amount);
  }

  function createDepositHash(uint wbtc_amount, bytes32 hash, uint expiry) public {
    IERC20(WBTC_ADDRESS).transferFrom(msg.sender, address(this), wbtc_amount);
    DEPOSIT_HASHES[hash] = HTLC(msg.sender, wbtc_amount, expiry);    
  }

  function unlockDepositHash(bytes32 hash, bytes memory preimage) public {
    require(sha256(preimage) == hash, "preimage does not match hash");
    require(DEPOSIT_HASHES[hash].expiry > block.timestamp, "HTLC is expired");
    delete DEPOSIT_HASHES[hash];
  }

  function reclaimDepositHash(bytes32 hash) public {
    require(DEPOSIT_HASHES[hash].expiry < block.timestamp, "HTLC is active");
    IERC20(WBTC_ADDRESS).transfer(DEPOSIT_HASHES[hash].counterparty, DEPOSIT_HASHES[hash].wbtc_amount);
    delete DEPOSIT_HASHES[hash];
  }

  function createWithdrawHash(address counterparty, uint wbtc_amount, bytes32 hash, uint expiry) public {
    require(msg.sender == manager, "only manager can create withdraw hashes");
    WITHDRAW_HASHES[hash] = HTLC(counterparty, wbtc_amount, expiry);    
  }

  function unlockWithdrawHash(bytes32 hash, bytes memory preimage) public {
    require(sha256(preimage) == hash, "preimage does not match hash");
    require(WITHDRAW_HASHES[hash].expiry > block.timestamp, "HTLC is expired");
    IERC20(WBTC_ADDRESS).transfer(WITHDRAW_HASHES[hash].counterparty, WITHDRAW_HASHES[hash].wbtc_amount);
    delete WITHDRAW_HASHES[hash];
  }

  function reclaimWithdrawHash(bytes32 hash) public {
    require(WITHDRAW_HASHES[hash].expiry < block.timestamp, "HTLC is active");
    delete WITHDRAW_HASHES[hash];
  }
}
