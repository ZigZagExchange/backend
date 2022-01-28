ZigZag API
====================

Websocket Base URL: wss://zigzag-exchange.herokuapp.com  

HTTPS Base URL: https://zigzag-exchange.herokuapp.com

# Chain IDs

The following is a list of Zigzag Chain IDs. Note that there is no relation between this and Ethereum Chain IDs. 

IDs < 1000 are mainnet contracts. IDs >= 1000 are testnet contracts.

| Name                  | ID        
|--------------         |-----------
| zkSync Mainnet        | 1
| zkSync Rinkeby        | 1000
| Starknet Goerli       | 1001

# Websocket vs REST

Our API is designed to be used as a Websocket API. The message structures and response methods are optimized for Websocket use. However, we understand in some cases a REST API is just more convenient, so a couple select methods in our API are available over HTTP POST. 

The HTTP POST API uses the same endpoint as the websocket API. It is a single endpoint API where messages are passed in the exact same structure as the Websocket message. See [Structure](#Structure) for how POST and Websocket messages should be structured. 

The current list of operations available over HTTP POST are: `submitorder2`, `requestquote`, `orderreceiptreq`

# Sending orders on zksync

The Zksync limit order system is pretty complicated, so we've simplified it down into an RFQ. 

There's a `requestquote` operation you can use to get an all in price including gas fees charged for relaying. The smaller the amount, the further away from spot it's going to be because of the $1 flat fee.

Using the price from the `quote` response, you can send a limit order with `submitorder2`. An order sent at the `quote` price will fill like a market order. 

## Structure

All messages the Zigzag Websocket API have the following structure

```json
{"op":"operation", "args": ["list", "of", "args"]}
```

Messages to the HTTP POST API have a similar structure. An example curl command is found below.

```
curl -X POST "https://zigzag-exchange.herokuapp.com/" --header "Content-Type: application/json" -d '{"op":"requestquote", "args": [1000, "ETH-USDT", "b", "0.232"]}'
```

## Limitations

Currently a user can only receive order updates on one connection at a time per chain. This may be upgraded in the future. 

## Pings

The server sends a ping message every 10 seconds to assure the connection is alive. A pong response is expected in return. 

Most websocket clients handle the ping message automatically, so no extra work should be required on your part. 

Dead connections are auto closed. 

## Order Statuses

Shorthand | Status
--------- | ------
c  | canceled
o  | open
e  | expired
m  | matched, but not committed to chain. price listed in args.
r  | rejected. txhash and error listed in args
f  | filled and committed. txhash listed in args.
b  | broadcasted. txhash listed in args. 
pf | partial fill. quantity and price listed in args.
pm | partial match. 

## Operations

Operation: **login**    

Arguments: `[chainId, userId]`   

Description: Associate userId with connection. Note that userId is a **string**, not an integer, even though zkSync represents account IDs as integers. This is to maintain compatibility with other chains that might use string fields (ETH addresses, ENS account names, etc) for account IDs.


```json
{"op":"login", "args": [1000, "27334"]}
```

---

Operation: **submitorder2**    

Arguments: `[chainId, market, zkOrder]`   

Description: Submit an order. 

For zksync, zkOrder is the output of zksync.wallet.getOrder in the Javascript library.

For Starknet, a zkOrder is the calldata for an Order struct in the Zigzag [smart contract](https://github.com/ZigZagExchange/starknet-contracts/blob/master/zigzag.cairo). For an example of how to send a Starknet order, see the `submitorderstarknet` function in the [helpers](https://github.com/ZigZagExchange/frontend/blob/master/src/helpers.js) file in our frontend.

An example of how to submit an order with Javascript can be found [here](https://github.com/ZigZagExchange/zksync-frontend/blob/master/src/helpers.js) in the `submitorder` function. 

This operation is also available over HTTP POST and returns a `userorderack` message.

Zksync

```json
{
  "op": "submitorder2",
  "args": [
    1000,
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
      "ratio": [
        "1000000000000000000",
        "3370930000"
      ],
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

Starknet

```json
{
  "op": "submitorder2",
  "args": [
    1001,
    "ETH-USDT",
    [
      "1001",
      "0xe386d09808b7b87507e6483deea09a32c688ef47616416c967d639d1283bc0",
      "0x06a75fdd9c9e376aebf43ece91ffb315dbaa753f9c0ddfeb8d7f3af0124cd0b6",
      "0x03d3af6e3567c48173ff9b9ae7efc1816562e558ee0cc9abc0fe1862b2931d9a",
      "0",
      "25252900000000000",
      "1",
      "211376718",
      "1638413195932",
      "239163444802039150939555844808313706381087721975693276317756200101630683732",
      "3563164837021092402584684943417251345107665423524603528021630345938863767190"
    ]
  ]
}
```

---

Operation: **indicateliq2**    

Arguments: `[chainId, market, liquidity]`

liquidity = `[[side, price, baseQuantity, expires], ...]`

Description: Used by market makers to indicate liquidity. side = {'b','s'} (buy, sell).

Expiration is a UNIX timestamp in seconds. If an expiration is not set or is set to greater than 15 seconds, it is defaulted to 15 seconds.

```json
{
  "op": "indicateliq2",
  "args": [
    1000,
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

Operation: **fillrequest**    

Arguments: `[chainId, orderId, fillOrder]`    

Description: Fill an open order. fillOrder is the output of zksync.wallet.getOrder. The ratio and tokens in the fillOrder must match the ones of the orderId it is attempting to fill.


```json
{
  "op": "fillrequest",
  "args": [
    1000,
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
      "ratio": [
        "1000000000000000000",
        "3370930000"
      ],
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

Operation: **userordermatch**    

Arguments: `[chainId, takerOrder, makerOrder]                                     

Description: Indicates a successful `fillrequest`. Matched orders should be broadcasted by the client using zksync.wallet.syncSwap

```json
NO EXAMPLE AVAILABLE YET
```

---

Operation: **orderreceiptreq**    

Arguments: `[chainid,orderid]`

Description: Get an order receipt. Returns a message with the same format as userorderack, but with one extra field at the end for the transaction hash.

```json
{ "op": "orderreceiptreq", "args": [1000, 40] }
```

---

Operation: **orders**    

Arguments: `[orders]`

Description: Current open orders for a market. order = [chainId,id,market,side,price,baseQuantity,quoteQuantity,expires,userid,orderstatus,remaining]

```json
{
  "op": "orders",
  "args": [
      [
        [ 1000, 5, "ETH-USDT", "s", 3370.93, 0.1, 337.093, 4294967295, "23", "o", 0.1 ],
        [ 1000, 6, "ETH-USDT", "s", 3380.93, 0.1, 338.093, 4294967295, "24", "pf",0.05 ],
        [ 1000, 7, "ETH-USDT", "b", 3350.93, 0.001, 3.35093, 4294967295, "174", "pm", 0.02 ]
      ]
  ]
}
```

---

Operation: **fills**    

Arguments: `[fills]`

Description: Latest fills for a market. order = [chainId,id,market,side,price,baseQuantity,fillstatus,txhash,takeruserid,makeruserid]

```json
{
    "op":"fills",
    "args":[
      [
        [1001,402,"ETH-USDT",'s',4406.829995978547,0.0677283,"f","0xe5e306e147d21740c9798e31b764cd65de148f8df41359693b6ed1cfeff527","0xe386d09808b7b87507e6483deea09a32c688ef47616416c967d639d1283bc0","0xa74303fe0bc93dac0e702c96b854914dc7fe2c8e04db6903fcee2dec38a4ba"],
        [1001,401,"ETH-USDT",'b',4405.759991924418,0.0322717,"f","0x55c01db07f251fa539ae0e2fa61a8a275af6f4ca57fda5044f54b1e8ca0dd66","0xe386d09808b7b87507e6483deea09a32c688ef47616416c967d639d1283bc0","0xa74303fe0bc93dac0e702c96b854914dc7fe2c8e04db6903fcee2dec38a4ba"],
        [1001,400,"ETH-USDT",'s',4405.759991924418,0.0647607,"f","0x4387a5860db3b3b028ba277fadf5c309c595664359f6c2b267d2eac9e106459","0xe386d09808b7b87507e6483deea09a32c688ef47616416c967d639d1283bc0","0xa74303fe0bc93dac0e702c96b854914dc7fe2c8e04db6903fcee2dec38a4ba"]
      ]
    ]
}
```

---

Operation: **orderstatus**    

Arguments: `[orderupdates]`

Description: A series of order status updates. orderupdate = `[chainId,orderId,status,...args]`


```json
{ 
    "op": "orderstatus", 
    "args": [[
        [ 1000, 5, "m", 4700.23]
    ]]
}
```

---

Operation: **orderstatusupdate**    

Arguments: `[orderupdates]`

Description: Used by market makers to submit chain commitment information on a matched order. orderupdate =  `[chainId,orderId,status,...args]`

Only 'f' and 'r' status updates are permitted, and only for matched orders.


```json
{ 
    "op": "orderstatusupdate", 
    "args": [[
        [ 1000, 5, "f", 4700.23, "9ddba58f75a6b8e65828c2fb5e7e6d80001fccbd6ce0c931181dfdcdb4721162"]
    ]]
}
```
```

---

Operation: **liquidity2**    

Arguments: `[chainId, market, liquidity]`

Description: Indications of market maker interest. liquidity = [side,price,baseQuantity]

```json
{
  "op": "liquidity2",
  "args": [
      1000,
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

Operation: **lastprice**    

Arguments: `[priceUpdates]`

Description: A group of market price updates. priceUpdate = [market,price,change]

```json
{
  "op": "lastprice",
  "args": [
      [
        [ "ETH-BTC", 0.069431, 0.0023 ],
        [ "ETH-USDT", 2989.19, 43.1 ],
        [ "BTC-USDT", 43048, 2003.2 ]
      ]
  ]
}
```

---

Operation: **marketsummary**    

Arguments: `[chainId,market,price,24hi,24lo,pricechange,baseVolume,quoteVolume]`  

Description: Price action summary over the last 24 hours 

```json
{"op":"marketsummary","args":["ETH-USDT",2989.19,3048.42,2782,149.06,100,300000]}
```

---

Operation: **subscribemarket**    

Arguments: `[chainId,market]`

Description: Subscribe to orderbook and price data for a market

```json
{"op":"subscribemarket","args":[1000,"ETH-USDT"]}
```

---

Operation: **unsubscribemarket**    

Arguments: `[chainId,market]`

Description: Unsubscribe from a market

```json
{"op":"unsubscribemarket","args":[1000,"ETH-USDT"]}
```

---

Operation: **userorderack**    

Arguments: `[chainId,id,market,side,price,baseQuantity,quoteQuantity,expires,userid,orderstatus,remaining]`

Description: ack message for a submitorder2 message

```json
{ "op":"userorderack", "args": [ 1000, 5, "ETH-USDT", "s", 3370.93, 0.1, 337.093, 4294967295, "23", "o", 0.1 ]}
```

---

Operation: **userordermatch**    

Arguments: `[orderId,zkOrder,zkFillOrder]`

Description: Indicates that an order match has occurred and requests the user to broadcast the swap to the chain

```json
No example available
```

---

Operation: **cancelorder**    

Arguments: `[chainId, orderId]`

Description: Cancel an order

```json
{ "op":"cancelorder", "args": [1000, 122] }
```

---

Operation: **cancelall**    

Arguments: `[chainId,userId]`

Description: Cancel all orders for a user

```json
{ "op":"cancelall", "args": [1000, "12232"] }
```

---

Operation: **requestquote**

Arguments: `[chainid, market, side, baseQuantity, quoteQuantity]`

Description: Request a quote for a purchase. Quotes are all in prices including gas fees, so they may differ from the market price substantially.

Only one of baseQuantity or quoteQuantity should be set.

This operation is also available over HTTP POST and returns a `quote` message.

```json
{ "op":"requestquote", "args": [1, "ETH-USDT", "b", "0.032"] }
{ "op":"requestquote", "args": [1, "ETH-USDT", "b", "0.032", null] }
{ "op":"requestquote", "args": [1, "ETH-USDT", "b", null, "2000"] }
```

---

Operation: **quote**

Arguments: `[chainid, market, side, baseQuantity, price, quoteQuantity]`

Description: Response to requestquote. Returns a fully filled quote with baseQuantity, price, and quoteQuantity. The price can then be used with submitorder2 to ensure a fill. 

```json
{ "op":"quote", "args": [1, "ETH-USDT", "b", 0.032, "4900", "156.8"] }
```

---

Operation: **marketinfo**

Arguments: `[marketInfoJson]`

Description: Returns a standard market info JSON from the Zigzag Markets API. Returned on every `subscribemarket` call

```json
{ 
    "op":"marketinfo", 
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

Operation: **marketsreq**

Arguments: `[chainid]`

Description: Request a list of markets. Available over REST. Response is a markets message.

```json
{"op":"marketsreq","args":[1]}
```

```bash
curl "https://zigzag-exchange.herokuapp.com/" -X POST -H 'Content-Type:application/json' -d '{"op":"marketsreq","args":[1]}'
```

---

Operation: **markets**

Arguments: `[markets]`. market = `[marketId,lastPrice,priceChange24h]`

Description: Request a list of markets. Available over REST. Response is a `markets` message. 

```json
{
  "op": "markets",
  "args": [
    [
      [ "ETH-USDT", "3500", 120 ],
      [ "ETH-USDC", "3500", 122 ],
      [ "USDC-USDT", "0.9993", 0.0001 ]
    ]
  ]
}

```

---

Operation: **dailyvolumereq**

Arguments: `[chainreq]`

Description: Request daily volumes by pairs.

Available over HTTP.

```json
{ "op":"dailyvolumereq", "args": [1000] }
```

```bash
curl "https://zigzag-exchange.herokuapp.com/" -H 'Content-Type:application/json' -d '{"op":"dailyvolumereq", "args":[1000]}'
```

---

Operation: **dailyvolume**

Arguments: `[volumes]`. volume = `[chainid,market,date,baseVolume,quoteVolume]`

Description: Daily volume by pair.

```json
{
  "op": "dailyvolume",
  "args": [
    [
      [ 1001, "ETH-USDT", "2021-11-28T18:30:00.000Z", 14.5387724, 63882.260941443 ],
      [ 1000, "USDC-USDT", "2022-01-16T18:30:00.000Z", 115, 119.99047 ],
      [ 1, "WBTC-USDT", "2021-12-05T18:30:00.000Z", 1.927e-05, 1.93041 ]
    ]
  ]
}

```

---

Operation: **error**

Arguments: `[operation, error]`

Description: Error message from a requested operation

```json
{ "op":"error", "args": ["fillrequest", "Order 234 is not open"] }
```
