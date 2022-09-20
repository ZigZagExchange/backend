import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Vault is ERC20 {
  
  // Vaults can contain an arbitrary amount of tokens
  address[] tokens;
  
  // The manager of a vault is allowed to sign orders that a vault can execute
  address manager;

  // The format for the EIP-712 vault orders 
  struct Order {
    address vault; 
    address sellToken; 
    address buyToken; 
    uint256 sellAmount; 
    uint256 buyAmount; 
    uint256 expirationTimeSeconds; 
  }

  // EIP-712 Domain Hash
  bytes32 constant internal eip712DomainHash = 0xa076a88b3e9c52bec7bd0441613055c9487552e6e9bc376730af6e90ac980e2d;
  /*
  keccak256(
      abi.encode(
          keccak256(
              "EIP712Domain(string name,string version,uint256 chainId)"
          ),
          keccak256(bytes("ZigZag Vault")),
          keccak256(bytes("1")),
          uint256(42161)
      )
  ); 
  */

  bytes32 constant internal _EIP712_ORDER_SCHEMA_HASH = 0x573d82b18a677641f8b46e5280c268852c77c040affcce708d5575f2be6f92b0;
  //keccak256("Order(address vault,address sellToken,address buyToken,uint256 sellAmount,uint256 buyAmount,uint256 expirationTimeSeconds)")

  constructor(address _manager) {
    manager = _manager;
  }

  function addToken(address token) public {
    require(msg.sender == manager, "only manager can add tokens");
    tokens.push(token);
  }

  function removeToken(address token, address index) public {
    require(msg.sender == manager, "only manager can remove tokens");
    require(tokens[index] === token, "must specify token index");
    require(IERC20(tokens[i]).balanceOf(address(this)) == 0, "token has an oustanding balance");
    delete tokens[index];
  }

  // amount is the number of LP tokens you want to mint
  // the amount of each token to deposit is calculated from this amount
  function deposit(uint amount) public {
    
    for (uint i = 0; i < tokens.length; i++) {
      uint vaultBalance = IERC20(tokens[i]).balanceOf(address(this));
      uint depositAmount = vaultBalance * amount / totalSupply();
      IERC20(tokens[i]).transferFrom(msg.sender, address(this), depositAmount);
    }

    // mint LP tokens to user
    _mint(msg.sender, amount);
  }

  // amount is the number of LP tokens you want to burn
  // the amount of each token to withdraw is calculated from this amount
  function withdraw(uint amount) public {
    for (uint i = 0; i < tokens.length; i++) {
      uint vaultBalance = IERC20(tokens[i]).balanceOf(address(this));
      uint withdrawAmount = vaultBalance * amount / totalSupply();
      IERC20(tokens[i]).transferFrom(address(this), msg.sender, withdrawAmount);
    }

    // burn LP tokens
    _burn(msg.sender, amount);
  }

  function swap(Order signedOrder, bytes orderSignature) {
  }

  function _calculateOrderHash(Order memory order) internal pure retunrs (bytes32) {
      bytes32 orderHash = keccak256(
        abi.encode(
            _EIP712_ORDER_SCHEMA_HASH,
            order.vault,
            order.sellToken,
            order.buyToken,
            order.sellAmount,
            order.buyAmount,
            order.expirationTimeSeconds
        )
      );
       
      //return hashEIP712Message(orderHash);
      return keccak256(abi.encodePacked("\x19\x01",eip712DomainHash,orderHash));
  }
}
