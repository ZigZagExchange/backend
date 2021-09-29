ZigZag Websocket API
====================

Rinkeby Base URL: https://ws.rinkeby.zigzag.exchange
Base URL: https://ws.zigzag.exchange

All messages the Zigzag Websocket API have the following structure

```json
{"op":"operation", "args": ["list", "of", "args"]}
```

An example is this:

```json
{"op":"subscribe_l2", "args": ["ETH-USDT"]}
```

The full list of operations and arguments is below:


| Operation      | Arguments                                                    | Description |
| -------------- | ---------                                                    | --------    |  
| ping           |                                                              |
| pong           |                                                              |
| login          | [accountId]                                                  |
| submitorder    | [zkorder]                                                    | zkorder is the output of zksync.syncWallet.getOrder
| indicatemaker  | [market, spread, side]                                       | Used by market makers to indicate liquidity at a spread from spot price. side = {'b','s','d'} (buy, sell, double-sided)
| fillrequest    | [orderId, fillOrder]                                         | fillOrder is the output of zksync.wallet.getOrder. it must match the ratios and market of the orderId it is attmempting to fill
| matchedorders  | [takerOrder, makerOrder]                                     | Matched orders should be broadcasted by the client using zksync.wallet.syncSwap
| openorders     | [market, orders]                                             | current open orders for a market. order = [id,market,side,price,baseQuantity,quoteQuantity,expires]
| liquidity      | [market, liquidity]                                          | indications of market maker interest by spread. liquidity = [quantity,spread]
| lastprice      | [priceUpdates]                                               | a group of market price updates. priceUpdate = [market,price]
| marketsummary  | [market,price,24hi,24lo,pricechange,baseVolume,quoteVolume]  | price action summary over the last 24 hours 
