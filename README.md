ZigZag Websocket API
====================

Rinkeby Base URL: wss://zigzag-rinkeby.herokuapp.com

Mainnet Base URL: Currently Unsupported

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

Arguments: `[accountId]`   

Description: Associate zksync account ID with connection


```json
{"op":"login", "args": [27334]}
```

---

Operation: **sumbitorder**    

Arguments: `[zkOrder]`   

Description: Submit an order. zkorder is the output of zksync.wallet.getOrder


```json
{
  "op": "submitorder",
  "args": [
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

Operation: **indicatemaker**    

Arguments: `[market, spread, side]`

Description: Used by market makers to indicate liquidity at a spread from spot price. side = {'b','s','d'} (buy, sell, double-sided)


```json
{"op":"indicatemaker", "args": ["ETH-USDT", 0.003, "d"]}
```

---

Operation: **fillrequest**    

Arguments: `[orderId, fillOrder]`    

Description: Fill an open order. fillOrder is the output of zksync.wallet.getOrder. The ratio and tokens in the fillOrder must match the ones of the orderId it is attempting to fill.


```json
{
  "op": "fillrequest",
  "args": [
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

Arguments: `[takerOrder, makerOrder]                                     

Description: Matched orders should be broadcasted by the client using zksync.wallet.syncSwap

```json
NO EXAMPLE AVAILABLE YET
```

---

Operation: **openorders**    

Arguments: `[market, orders]`

Description: Current open orders for a market. order = [id,market,side,price,baseQuantity,quoteQuantity,expires]

```json
{
  "op": "openorders",
  "args": [
      [
        [ 5, "ETH-USDT", "s", 3370.93, 0.1, 337.093, 4294967295 ],
        [ 6, "ETH-USDT", "s", 3380.93, 0.1, 338.093, 4294967295 ],
        [ 7, "ETH-USDT", "b", 3350.93, 0.001, 3.35093, 4294967295 ]
      ]
  ]
}
```

---

Operation: **liquidity**    

Arguments: `[market, liquidity]`

Description: Indications of market maker interest by spread. liquidity = [quantity,spread]

```json
{
  "op": "liquidity",
  "args": [
      [
        [ 0.1, 0.003 ],
        [ 0.5, 0.005 ]
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

Arguments: `[market,price,24hi,24lo,pricechange,baseVolume,quoteVolume]`  

Description: Price action summary over the last 24 hours 

```json
{"op":"marketsummary","args":["ETH-USDT",2989.19,3048.42,2782,149.06,100,300000]}
```

---

Operation: **subscribemarket**    

Arguments: `[market]`

Description: Subscribe to orderbook and price data for a market

```json
{"op":"subscribemarket","args":["ETH-USDT"]}
```

---

Operation: **unsubscribemarket**    

Arguments: `[market]`

Description: Unsubscribe from a market

```json
{"op":"unsubscribemarket","args":["ETH-USDT"]}
```

---

Operation: **userorderack**    

Arguments: `[id,market,side,price,baseQuantity,quoteQuantity,expires]` 

Description: ack message for a submitorder message

```json
{ "op":"userorderack", "args": [5,"ETH-USDT","s",3370.93,0.1,337.093,4294967295]}
```
