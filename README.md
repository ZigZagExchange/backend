ZigZag Websocket API
====================

Rinkeby Base URL: https://ws.rinkeby.zigzag.exchange
Base URL: https://ws.zigzag.exchange

All messages the Zigzag Websocket API have the following structure

```json
{"op":"operation", args: ["list", "of", "args"]}
```

An example is this:

```
{"op":"subscribe_l2", args: ["ETH-USDT"]}
```

The full list of operations and arguments is below:


| Operation      | Arguments                                     | Description |
| -------------- | ---------                                     | --------    |  
| ping           |                                               |
| pong           |                                               |
| login          | [accountId]                                   |
| submitorder    | [zkorder]                                     | zkorder is the output of zksync.syncWallet.getOrder
| indicatemaker  | [market, quantity, price]                     | 
| fillrequest    | [orderId, fillOrder]                          | fillOrder is the output of zksync.syncWallet.getOrder. it must match the ratios and market of the orderId it is attmempting to fill
| matchedorders  | [takerOrder, makerOrder]                      |
| getopenorders  | [market]                                      |
| openorders     |                                               |
