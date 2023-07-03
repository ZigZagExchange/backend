# ZigZag API

# URLs

## Mainnet

Websocket Base URL: wss://zigzag-exchange.herokuapp.com  
HTTPS Base URL: https://zigzag-exchange.herokuapp.com

# Chain IDs

The following is a list of Zigzag Chain IDs. Note that there is no relation between this and Ethereum Chain IDs.

IDs < 1000 are mainnet contracts. IDs >= 1000 are testnet contracts.

| Name              | ID     |
| ----------------- | ----   |
| zkSync Mainnet    | 1      |

# Websocket vs REST

Our API is designed to be used as a Websocket API. The message structures and response methods are optimized for Websocket use. However, we understand in some cases a REST API is just more convenient, so a couple select methods in our API are available over HTTP POST.

The HTTP POST API uses the same endpoint as the websocket API. It is a single endpoint API where messages are passed in the exact same structure as the Websocket message. See [Structure](#Structure) for how POST and Websocket messages should be structured.

The current list of operations available over HTTP POST are: `submitorder3`, `requestquote`, `orderreceiptreq`, `refreshliquidity`, `dailyvolumereq`, `marketsreq` and `cancelorder2`.

# Sending orders on zksync

The Zksync limit order system is pretty complicated, so we've simplified it down into an RFQ.

There's a `requestquote` operation you can use to get an all in price including gas fees charged for relaying. The smaller the amount, the further away from spot it's going to be because of the variable fee.

Using the price from the `quote` response, you can send a limit order with `submitorder3`. An order sent at the `quote` price will fill like a market order.

## Structure

All messages the Zigzag Websocket API have the following structure

```json
{ "op": "operation", "args": ["list", "of", "args"] }
```

Messages to the HTTP POST API have a similar structure. An example curl command is found below.

```
curl -X POST "https://zigzag-exchange.herokuapp.com/" --header "Content-Type: application/json" -d '{"op":"requestquote", "args": [1002, "ETH-USDT", "b", "0.232"]}'
```

## Pings

The server sends a ping message every 30 seconds to assure the connection is alive. A pong response is expected in return.

Most websocket clients handle the ping message automatically, so no extra work should be required on your part.

Dead connections are auto closed.

## Order Statuses

| Shorthand | Status                                                     |
| --------- | ---------------------------------------------------------- |
| c         | canceled                                                   |
| o         | open                                                       |
| e         | expired                                                    |
| m         | matched, but not committed to chain. price listed in args. |
| r         | rejected. txhash and error listed in args                  |
| f         | filled and committed. txhash listed in args.               |
| b         | broadcasted. txhash listed in args.                        |
| pf        | partial fill. quantity and price listed in args.           |
| pm        | partial match.                                             |

## Operations

###### Operation: **login**

Arguments: `[chainId, userId]`

Description: Associate userId with connection. Note that userId is a **string**, not an integer, even though zkSync represents account IDs as integers. This is to maintain compatibility with other chains that might use string fields (ETH addresses, ENS account names, etc) for account IDs.

```json
{ "op": "login", "args": [1002, "27334"] }
```

---

###### Operation: **submitorder3**

Arguments: `[chainId, market, zkOrder]`

Description: Submit an order.

For zksync, zkOrder is the output of zksync.wallet.getOrder in the Javascript library.

An example of how to submit an order with Javascript in zksync can be found [here](https://github.com/ZigZagExchange/frontend/blob/master/src/lib/api/providers/APIZKProvider/APIZKProvider.js) in the `submitorder` function.

This operation is also available over HTTP POST and returns a `userorderack` message.

**Zksync 1.0**

```json
{
  "op": "submitorder3",
  "args": [
    1002,
    "ETH-DAI",
    {
      "accountId": 202976,
      "recipient": "0x88D23A44D07F86B2342B4B06BD88b1ea313B6976",
      "nonce": 8,
      "amount": "100000000000000000",
      "tokenSell": 0,
      "tokenBuy": 1,
      "validFrom": 0,
      "validUntil": 4294967295,
      "ratio": ["1000000000000000000", "3370930000"],
      "signature": {
        "pubKey": "d68168338b475c39bba9efe1451bd17986f0e27cca68232737f2c6953cd6ea9e",
        "signature": "43ffeb5e4c6722f6562d7a1946401764bb2de98565df59ecf3a7911c7f3ad615fba49fda67c154c4cd329da35121ceb376f960968c2da615fdb61cd64eb07a04"
      },
      "ethSignature": {
        "type": "EthereumSignature",
        "signature": "0x03d07fecdc1cdc5b454c14701007201a49c35b5015dae062c7c2e30c5be44aaf27ff753ee8ee2635035979dd2006ffe4d37f3648da01c755970a70e57245db621b"
      }
    }
  ]
}
```

###### Operation: **indicateliq2**

Arguments: `[chainId, market, liquidity]`

liquidity = `[[side, price, baseQuantity, expires], ...]`

Description: Used by market makers to indicate liquidity. side = {"b","s"} (buy, sell).

Expiration is a UNIX timestamp in seconds. If an expiration is not set or is set to greater than 15 seconds, it is defaulted to 15 seconds.

```json
{
  "op": "indicateliq2",
  "args": [
    1002,
    "ETH-USDT",
    [
      ["b", 3100, 1.2322, 1642677967],
      ["b", 3200, 2.2324, 1642677967],
      ["s", 3300, 0.2822, 1642677967],
      ["s", 3500, 1.2832, 1642677967]
    ]
  ]
}
```

---

###### Operation: **fillrequest**

Arguments: `[chainId, orderId, fillOrder]`

Description: Fill an open order. fillOrder is the output of zksync.wallet.getOrder. The ratio and tokens in the fillOrder must match the ones of the orderId it is attempting to fill.

```json
{
  "op": "fillrequest",
  "args": [
    1002,
    123332,
    {
      "accountId": 202976,
      "recipient": "0x88D23A44D07F86B2342B4B06BD88b1ea313B6976",
      "nonce": 8,
      "amount": "100000000000000000",
      "tokenSell": 0,
      "tokenBuy": 1,
      "validFrom": 0,
      "validUntil": 4294967295,
      "ratio": ["1000000000000000000", "3370930000"],
      "signature": {
        "pubKey": "d68168338b475c39bba9efe1451bd17986f0e27cca68232737f2c6953cd6ea9e",
        "signature": "43ffeb5e4c6722f6562d7a1946401764bb2de98565df59ecf3a7911c7f3ad615fba49fda67c154c4cd329da35121ceb376f960968c2da615fdb61cd64eb07a04"
      },
      "ethSignature": {
        "type": "EthereumSignature",
        "signature": "0x03d07fecdc1cdc5b454c14701007201a49c35b5015dae062c7c2e30c5be44aaf27ff753ee8ee2635035979dd2006ffe4d37f3648da01c755970a70e57245db621b"
      }
    }
  ]
}
```

---

###### Operation: **userordermatch**

Arguments: `[chainId, takerOrder, makerOrder]

Description: Indicates a successful `fillrequest`. Matched orders should be broadcasted by the client using zksync.wallet.syncSwap

---

###### Operation: **orderreceiptreq**

Arguments: `[chainid,orderid]`

Description: Get an order receipt. Returns an orderreceipt. That is a message with the same format as userorderack, but with one extra field at the end for the transaction hash, instead of the token.

```json
{ "op": "orderreceiptreq", "args": [1002, 40] }
```

---

###### Operation: **orderreceipt**

Arguments: `[chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,remaining,txhash]`

Description: Get an order receipt. Returns a message with the same format as userorderack, but with one extra field at the end for the transaction hash, instead of the token.

```json
{ 
  "op": "orderreceipt", 
  "args": [
    1002,
    40,
    "ETH-USDT",
    "s",
    3370.93,
    0.1,
    337.093,
    4294967295,
    "23",
    "f",
    0,
    "0x...24a12"
  ] 
}
```

---

###### Operation: **fillreceiptreq**

Arguments: `[chainid,orderid]`

Description: Get an fill receipt. Returns an fillreceipt. That is a message with the same format as fills. OrderId can be an array of up to 25 orderIds.

```json
{ "op": "fillreceiptreq", "args": [1002, 40] }
```

---

###### Operation: **fillreceipt**

Arguments: `[chainId,id,market,side,price,baseQuantity,fillstatus,txhash,takeruserid,makeruserid,feeamount,feetoken,timestamp]`

Description: Get an fill receipt. Returns a message with the same format as fills.

---

###### Operation: **orders**

Arguments: `[chainId,id,market,side,price,baseQuantity,quoteQuantity,expires,userid,orderstatus,remaining]`

```json
{
  "op": "orders",
  "args": [
    [
      [
        1002,
        5,
        "ETH-USDT",
        "s",
        3370.93,
        0.1,
        337.093,
        4294967295,
        "23",
        "o",
        0.1
      ],
      [
        1002,
        6,
        "ETH-USDT",
        "s",
        3380.93,
        0.1,
        338.093,
        4294967295,
        "24",
        "pf",
        0.05
      ],
      [
        1002,
        7,
        "ETH-USDT",
        "b",
        3350.93,
        0.001,
        3.35093,
        4294967295,
        "174",
        "pm",
        0.02
      ]
    ]
  ]
}
```

---

###### Operation: **fills**

Arguments: `[fills]`

Description: Latest fills for a market. order = [chainId,id,market,side,price,baseQuantity,fillstatus,txhash,takeruserid,makeruserid,feeamount,feetoken,timestamp]

```json
{
  "op": "fills",
  "args": [
    [
      [
        1001,
        402,
        "ETH-USDT",
        "s",
        4406.829995978547,
        0.0677283,
        "f",
        "0xe5e306e147d21740c9798e31b764cd65de148f8df41359693b6ed1cfeff527",
        "0xe386d09808b7b87507e6483deea09a32c688ef47616416c967d639d1283bc0",
        "0xa74303fe0bc93dac0e702c96b854914dc7fe2c8e04db6903fcee2dec38a4ba",
        0.48,
        "USDC",
        1646476058552
      ],
      [
        1001,
        401,
        "ETH-USDT",
        "b",
        4405.759991924418,
        0.0322717,
        "f",
        "0x55c01db07f251fa539ae0e2fa61a8a275af6f4ca57fda5044f54b1e8ca0dd66",
        "0xe386d09808b7b87507e6483deea09a32c688ef47616416c967d639d1283bc0",
        "0xa74303fe0bc93dac0e702c96b854914dc7fe2c8e04db6903fcee2dec38a4ba",
        0.000072,
        "ETH",
        1646476027148
      ],
      [
        1001,
        400,
        "ETH-USDT",
        "s",
        4405.759991924418,
        0.0647607,
        "f",
        "0x4387a5860db3b3b028ba277fadf5c309c595664359f6c2b267d2eac9e106459",
        "0xe386d09808b7b87507e6483deea09a32c688ef47616416c967d639d1283bc0",
        "0xa74303fe0bc93dac0e702c96b854914dc7fe2c8e04db6903fcee2dec38a4ba",
        0.203,
        "DAI",
        1646475999960
      ]
    ]
  ]
}
```

---

###### Operation: **orderstatus**

Arguments: `[orderupdates]`

Description: A series of order status updates. orderupdate = `[chainId,orderId,status,txHash,remaining/error]`. See [Order Status](#order-statuses) for status flags.

```json
{
  "op": "orderstatus",
  "args": [
    [
      [
        1002,
        5,
        "m",
        "0x5c633d31817a9b95973670733aed5feb8255d67f36f74517462063659bcd7dd",
        12.5
      ],
      [
        1002,
        890013,
        "f",
        "0x51c23f8bcb7aa2cc64c8da28827df6906b8bdc53818eaf398f5198a6850310f0",
        "Not enough balance"
      ]
    ]
  ]
}
```

---

###### Operation: **fillstatus**

Description: An update about the fill status of an active order. These numbers might get updated after the match is send on chain. fillstatus = `[chainId,fillId,status,txHash,remaining,feeamount,feetoken,timestamp,price]`. See [Order Status](#order-statuses) for status flags. 

```json
{
  "op": "fillstatus",
  "args": [
    [
      [
        1002,
        9258,
        "f",
        "51c23f8bcb7aa2cc64c8da28827df6906b8bdc53818eaf398f5198a6850310f0",
        null,
        0.000072,
        "ETH",
        1646476058552,
        1460.21
      ]
    ]
  ]
}
```

---

###### Operation: **liquidity2**

Arguments: `[chainId, market, liquidity]`

Description: Indications of market maker interest. liquidity = [side,price,baseQuantity]

```json
{
  "op": "liquidity2",
  "args": [
    1002,
    "ETH-USDT",
    [
      ["b", 3100, 1.2322],
      ["b", 3200, 2.2324],
      ["s", 3300, 0.2822],
      ["s", 3500, 1.2832]
    ]
  ]
}
```

---

###### Operation: **refreshliquidity**

Arguments: `[chainId, market]`

Description: Liquidity is usually sent out every 3-5 seconds. If you want it more often than that you can use this to get a fresh snapshot.

Available over REST.

```json
{ "op": "refreshliquidity", "args": [1002, "ETH-USDT"] }
```

---

###### Operation: **lastprice**

Arguments: `[priceUpdates, chainId]`

Description: A group of market price updates. priceUpdate = [market,price,change,quoteVolume]

```json
{
  "op": "lastprice",
  "args": [
    [
      ["ETH-BTC", 0.069431, 0.0023, 1.0223],
      ["ETH-USDT", 2989.19, 43.1, 2343.43],
      ["BTC-USDT", 43048, 2003.2, 38383.23]
    ],
    1002
  ]
}
```

---

###### Operation: **marketsummary**

Arguments: `[chainId,market,price,24hi,24lo,pricechange,baseVolume,quoteVolume]`

Description: Price action summary over the last 24 hours

```json
{
  "op": "marketsummary",
  "args": ["ETH-USDT", 2989.19, 3048.42, 2782, 149.06, 100, 300000]
}
```

---

###### Operation: **subscribemarket**

Arguments: `[chainId,market]`

Description: Subscribe to orderbook and price data for a market

```json
{ "op": "subscribemarket", "args": [1002, "ETH-USDT"] }
```

---

###### Operation: **unsubscribemarket**

Arguments: `[chainId,market]`

Description: Unsubscribe from a market

To unsubscibe from all markets, you can leave the args empty: `"args": []`

```json
{ "op": "unsubscribemarket", "args": [1002, "ETH-USDT"] }
```

---

###### Operation: **userorderack**

Arguments: `[chainId,id,market,side,price,baseQuantity,quoteQuantity,expires,userid,orderstatus,remaining,token]`

Description: ack message for a submitorder3 message

```json
{
  "op": "userorderack",
  "args": [
    1002,
    5,
    "ETH-USDT",
    "s",
    3370.93,
    0.1,
    337.093,
    4294967295,
    "23",
    "o",
    0.1,
    "23782f238c923b...233e"
  ]
}
```

###### Operation: **cancelorder2**

Arguments: `[chainId, orderId, signedMessage]`

Description: Cancel an order. To verify the sender is the original user that placed the order, the 'signedMessage' argument is used. The messaged needs to be formated like this: 'cancelorder2:_chainId_:_orderId_' - eg here 'cancelorder2:1002:122'. This needs to be signed by the user.


```json
{ "op": "cancelorder2", "args": [1002, 122, "0x6bfd....5a8b4e"] }
```

```js
// Javascript

const provider = new ethers.providers.JsonRpcProvider(...);
const WALLET = new ethers.Wallet(privateKey, provider);

async function cancelorder(order) {
    const CHAIN_ID = 1;
    const orderid = 1050;
    const message = `cancelorder2:${CHAIN_ID}:${orderid}`;
    const signature = await WALLET.signMessage(message);
    zigzagws.send(JSON.stringify({ op: "cancelorder2", args: [CHAIN_ID, orderid, signature] }));
}
```

---

###### Operation: **cancelorder3**

Arguments: `[chainId, orderId, token]`

Description: Cancel an order. To verify the sender is the original user that placed the order, the a token is used. The token is send togherther with the 'userorderack'.


```json
{ "op": "cancelorder3", "args": [1002, 122, "6bfd....5a8b4e"] }
```

---

###### Operation: **cancelall2**

Arguments: `[chainId, userId, validUntil, signedMessage]`

Description: Cancel all orders for a user. To verify the sender is the original user that placed the order, the 'signedMessage' argument is used. Use `chianId = 0` to cancel all orders on every chain. `validUntil` is in UNIX (seconds) and needs to be atlest now + 10sec. The messaged needs to be formated like this: 'cancelall2:_chainId_:_validUntil_' - eg here 'cancelall2:1002:1655990893'. This needs to be signed by the user.

```json
{ "op": "cancelall2", "args": [1002, "12232", 1655990893, "0x6bfd....5a8b4e"] }
```

---

###### Operation: **cancelall3**

Arguments: `[chainId, userId, tokenArray]`

Description: Cancel all orders for a user. To verify the sender is the original user that placed the order, the 'tokenArray' argument is used. Use `chianId = 0` to cancel all orders on every chain. The tokenArray is an array contaning the tokens for each open order. if you dont have access to all tokens, use cancelall2. The token is send togherther with the 'userorderack'.

```json
{ "op": "cancelall3", "args": [1002, "12232", ["0x6bfd....5a8b4e", "...", "a728f982...e232"]] }
```

---

###### Operation: **requestquote**

Arguments: `[chainid, market, side, baseQuantity, quoteQuantity]`

Description: Request a quote for a purchase. 

Note: **For zkSync** quotes are all in prices including gas fees, so they may differ from the market price substantially.

Only one of baseQuantity or quoteQuantity should be set.

This operation is also available over HTTP POST and returns a `quote` message.

```json
{ "op":"requestquote", "args": [1, "ETH-USDT", "b", "0.032"] }
{ "op":"requestquote", "args": [1, "ETH-USDT", "b", "0.032", null] }
{ "op":"requestquote", "args": [1, "ETH-USDT", "b", null, "2000"] }
```

---

###### Operation: **quote**

Arguments: `[chainid, market, side, baseQuantity, price, quoteQuantity]`

Description: Response to requestquote. Returns a fully filled quote with baseQuantity, price, and quoteQuantity. The price can then be used with submitorder3 to ensure a fill.

```json
{ "op": "quote", "args": [1, "ETH-USDT", "b", 0.032, "4900", "156.8"] }
```

---

###### Operation: **marketinfo**

Arguments: `[marketInfoJson]`

Description: Returns a standard market info JSON from the Zigzag Markets API. Returned on every `subscribemarket` call

```json
{
  "op": "marketinfo",
  "args": [
    {
      "baseAssetId": "65",
      "quoteAssetId": "1",
      "baseFee": 1,
      "quoteFee": 1,
      "minSize": 1,
      "maxSize": 100,
      "zigzagChainId": 1,
      "pricePrecisionDecimal": 6,
      "baseAsset": {
        "id": 65,
        "address": "0x19ebaa7f212b09de2aee2a32d40338553c70e2e3",
        "symbol": "ARTM",
        "decimals": 18,
        "enabledForFees": false
      },
      "quoteAsset": {
        "id": 1,
        "address": "0x6b175474e89094c44da98b954eedeac495271d0f",
        "symbol": "DAI",
        "decimals": 18,
        "enabledForFees": true
      },
      "id": "nORHCLNmmeS5Cp5or2Xt4gMMovgfVsbwYXA941zq0ks",
      "alias": "ARTM-DAI"
    }
  ]
}
```

---

###### Operation: **marketinfo2**

A `marketinfo2` message is the same as a marketinfo message but it contains information for multiple markets instead of 1.

It's returned by calling `marketsreq` with the detailed flag turned on.

```json
{
  "op": "marketinfo2",
  "args": [
    [
      {
        "baseAssetId": "65",
        "quoteAssetId": "1",
        "baseFee": 1,
        "quoteFee": 1,
        "minSize": 1,
        "maxSize": 100,
        "zigzagChainId": 1,
        "pricePrecisionDecimal": 6,
        "baseAsset": {
          "id": 65,
          "address": "0x19ebaa7f212b09de2aee2a32d40338553c70e2e3",
          "symbol": "ARTM",
          "decimals": 18,
          "enabledForFees": false
        },
        "quoteAsset": {
          "id": 1,
          "address": "0x6b175474e89094c44da98b954eedeac495271d0f",
          "symbol": "DAI",
          "decimals": 18,
          "enabledForFees": true
        },
        "id": "nORHCLNmmeS5Cp5or2Xt4gMMovgfVsbwYXA941zq0ks",
        "alias": "ARTM-DAI"
      }
    ]
  ]
}
```

---

###### Operation: **marketsreq**

Arguments: `[chainid, detailed]`

Description: Request a list of markets. Available over REST. Response is a markets message if detailed flag is unset, or a marketinfo2 message if the detailed flag is set.

```json
{"op":"marketsreq","args":[1]}
{"op":"marketsreq","args":[1, true]}
```

```bash
curl "https://zigzag-exchange.herokuapp.com/" -X POST -H 'Content-Type:application/json' -d '{"op":"marketsreq","args":[1, true]}'
```

---

###### Operation: **dailyvolumereq**

Arguments: `[chainreq]`

Description: Request daily volumes by pairs.

Available over HTTP.

```json
{ "op": "dailyvolumereq", "args": [1002] }
```

```bash
curl "https://zigzag-exchange.herokuapp.com/" -H 'Content-Type:application/json' -d '{"op":"dailyvolumereq", "args":[1002]}'
```

---

###### Operation: **dailyvolume**

Arguments: `[volumes]`. volume = `[chainid,market,date,baseVolume,quoteVolume]`

Description: Daily volume by pair.

```json
{
  "op": "dailyvolume",
  "args": [
    [
      [
        1001,
        "ETH-USDT",
        "2021-11-28T18:30:00.000Z",
        14.5387724,
        63882.260941443
      ],
      [1002, "USDC-USDT", "2022-01-16T18:30:00.000Z", 115, 119.99047],
      [1, "WBTC-USDT", "2021-12-05T18:30:00.000Z", 1.927e-5, 1.93041]
    ]
  ]
}
```

---

###### Operation: **error**

Arguments: `[operation, error]`

Description: Error message from a requested operation

```json
{ "op": "error", "args": ["fillrequest", "Order 234 is not open"] }
```


## zigzag endpoints

###### /api/v1/markets/:chainId?

Example: `/api/v1/markets/421613`or `/api/v1/markets/421613?market=eth-ust`

Arguments: `?market=ETH-UST` (optional, like: /api/v1/markets/421613?market=eth-ust)

Description: Returns a JSON containing all markets. If an argument is set, it will only return that summary.

```
{
  "USDC-USDT":
    {
      "market":"USDC-USDT",
      "baseSymbol":"USDC",
      "quoteSymbol":"USDT",
      "lastPrice":0.99985,
      "lowestAsk":1.00024994,
      "highestBid":0.99945006,
      "baseVolume":1801.15,
      "quoteVolume":1800.88,
      "priceChange":-0.002004,
      "priceChangePercent_24h":-0.002004,
      "highestPrice_24h":1.001854,
      "lowestPrice_24h":0.99805
    },
  "DAI-USDT": 
  ....
}  

```

###### /api/v1/ticker/:chainId?

Example: `/api/v1/ticker/421613`or `/api/v1/ticker/421613?market=eth-ust`

Arguments: `?market=ETH-UST` (optional, like: /api/v1/ticker/421613?market=eth-ust)

Description: Returns a JSON containing all price information. If an argument is set, it will only return this price information.


```
{
  "USDC-USDT":
    {
      "lastPrice":0.99985,
      "priceChange":-0.002004,
      "baseVolume":"2614.65",
      "quoteVolume":"2614.26"
    },
  "DAI-USDT":
  ...
}

```

###### /api/v1/orderbook/:market/:chainId?

Example: `/api/v1/orderbook/eth-ust/421613?depth=5&level=3`

Arguments: 
* `:market` 
* `?depth` (optional)
* `?level` (optional)

Description:
Returns a JSON containing all orderbook informations for that market. The volume is in the corresponding base asset.
* With `depth` you can set how many orders you want to aggregate. If you set 50, that returns 25 per ask/bid.
* With `level` you can set the returned level:
  * 1 -> best bid and ask
  * 2 -> bids and asks aggregated by 0.05% steps
  * 3 -> full order book with every bid and ask

```
{
  "timestamp": 1646402828755,
  "bids": [
    [3000, 1],
    [2999, 2],
    ...
  ],
  "asks": [
    [3010, 1],
    [3011, 2],
    ...
  ]
}

```

###### /api/v1/trades/:chainId?

Example: `/api/v1/trades/421613?market=eth-ust&type=s&order_id=4518`

Arguments: 
* `?market` (optional)
* `?type` (optional)
* `?limit` (optional)
* `?order_id` (optional)
* `?start_time` (optional in UNIX)
* `?end_time` (optional in UNIX)
* `?account_id` (optional)
* `?direction` (optional - 'older' or 'newer')

Description:
Returns a JSON containing the last trades in decending order.
* With `market` you can choose to only return trades for one market. Use 'eth-ust' or 'eth_ust'
* With `type` you can choose to only return buy or ask side. You can set 's', 'b', 'sell' or 'buy'.
* With `limit` you can set the maximum number of trades returned. MAX 25 for now.
* With `order_id` you can set the first order you want to get returned. This can be used to loop over all trades.
                Use the last orderId returned from the last request and send that as first `order_id`.
* With `start_time` you can set the first retuned trade. Set using UNIX time.
* With `end_time` you can set the last retuned trade. Set using UNIX time.
* With `account_id` you can get trades corresponding to a given account ID.
* With `direction` you set the direction, best used together with a account_id (eg. get all new trades starting from x)

.


```
[
  {
    "chainId":1002,
    "orderId":4162,
    "market":"ETH-USDC",
    "price":2914.15,
    "baseVolume":0.09966024999,
    "quoteVolume":290.42491750835853,
    "timestamp":1646307989024,
    "side":"sell",
    "txHash":"3e870f76771a37e9da5d0d3d82c3d0a83699e359254c0c2fb4c0aee8fe64a01f",
    "takerId": 674945,
    "makerId": 354861,
    "feeAmount":0.00003025,
    "feeToken":"ETH"
  },
  {
    "chainId":1002,
    ....
  }
]

```

###### /api/v1/marketinfos/:chainId?

Example: `/api/v1/marketinfos/421613?market=ETH-USDC`

Arguments: 
* `:chain_id`
* `?market` - can be a list of markets "...&market=ETH-USDC,ETH-USDT,ETH-UST"

{
  "ETH-USDC": {
    "zigzagChainId":1,
    "baseAssetId":0,
    "quoteAssetId":2,
    "baseFee":0.00008977500000000001,
    "quoteFee":0.28980000000000006,
    "tradingViewChart":"BINANCE:ETHUSDC",
    "pricePrecisionDecimal":6,
    "baseAsset": {
      "id":0,
      "address":"0x0000000000000000000000000000000000000000",
      "symbol":"ETH",
      "decimals":18,
      "enabledForFees":true,
      "usdPrice":3226.65,
      "name":"Ethereum"
    },
    "quoteAsset": {
      "id":2,
      "address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "symbol":"USDC",
      "decimals":6,
      "enabledForFees":true,
      "usdPrice":0.997891,
      "name":"USD Coin"
    },
    "alias":"ETH-USDC"
  }
}
