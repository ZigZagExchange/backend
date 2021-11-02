ZigZag Websocket API
====================

Rinkeby Base URL: wss://zigzag-rinkeby.herokuapp.com

Mainnet Base URL: Currently Unsupported

# Chain IDs

The following is a list of Zigzag Chain IDs. Note that there is no relation between this and Ethereum Chain IDs. 

| Name                  | ID        
|--------------         |-----------
| zkSync Mainnet        | 1
| zkSync Rinkeby        | 1000

## Structure

All messages the Zigzag Websocket API have the following structure

```json
{"op":"operation", "args": ["list", "of", "args"]}
```

## Operations

Operation: **ping**    

Arguments: `[]`   

Description: Ping server for reply. Server responds with pong


```json
{"op":"ping", "args": []}
```

---

Operation: **pong**    

Arguments: `[]`   

Description: Reply to ping message


```json
{"op":"pong", "args": []}
```

---

Operation: **login**    

Arguments: `[chainId, accountId]`   

Description: Associate zksync account ID with connection


```json
{"op":"login", "args": [1000, 27334]}
```

---

Operation: **sumbitorder**    

Arguments: `[chainId, zkOrder]`   

Description: Submit an order. zkorder is the output of zksync.wallet.getOrder


```json
{
  "op": "submitorder",
  "args": [
    1000,
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

Operation: **indicateliq**    

Arguments: `[chainId, market, spread, side]`

Description: Used by market makers to indicate liquidity at a spread from spot price. side = {'b','s','d'} (buy, sell, double-sided)


```json
{"op":"indicatemaker", "args": [1000, "ETH-USDT", 0.003, "d"]}
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

Operation: **matchedorders**    

Arguments: `[chainId, takerOrder, makerOrder]                                     

Description: Matched orders should be broadcasted by the client using zksync.wallet.syncSwap

```json
NO EXAMPLE AVAILABLE YET
```

---

Operation: **openorders**    

Arguments: `[orders]`

Description: Current open orders for a market. order = [chainId,id,market,side,price,baseQuantity,quoteQuantity,expires,userid]

```json
{
  "op": "openorders",
  "args": [
      [
        [ 1000, 5, "ETH-USDT", "s", 3370.93, 0.1, 337.093, 4294967295, 23 ],
        [ 1000, 6, "ETH-USDT", "s", 3380.93, 0.1, 338.093, 4294967295, 24 ],
        [ 1000, 7, "ETH-USDT", "b", 3350.93, 0.001, 3.35093, 4294967295, 17 ]
      ]
  ]
}
```

---

Operation: **liquidity**    

Arguments: `[chainId, market, liquidity]`

Description: Indications of market maker interest by spread. liquidity = [quantity,spread,side]

```json
{
  "op": "liquidity",
  "args": [
      1000,
      "ETH-USDT",
      [
        [ 0.1, 0.003, "d" ],
        [ 0.5, 0.005, "d" ]
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

Arguments: `[chainId,id,market,side,price,baseQuantity,quoteQuantity,expires]` 

Description: ack message for a submitorder message

```json
{ "op":"userorderack", "args": [1000,5,"ETH-USDT","s",3370.93,0.1,337.093,4294967295]}
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

Arguments: `[orderId]`

Description: Cancel an order

```json
{ "op":"cancelorder", "args": [122] }
```

---

Operation: **cancelall**    

Arguments: `[chainId,userId]`

Description: Cancel all orders for a user

```json
{ "op":"cancelall", "args": [1000, 12232] }
```

---

Operation: **cancelorderack**    

Arguments: `[canceledIds]`

Description: Ack messasge for canceled orders with a list of canceled IDs

```json
{ "op":"cancelorderack", "args": [[1,8,99,323]] }
```
