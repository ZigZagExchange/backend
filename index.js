import WebSocket, { WebSocketServer } from 'ws';
import SqliteDatabase from 'better-sqlite3';

const db = new SqliteDatabase('zigzag.db');

const zkTokenIds = {
    0: {name:'ETH',decimals:18},
    1: {name:'USDT',decimals:6}
}
const validMarkets = {
    "ETH-BTC": 1,
    "ETH-USDT": 1,
    "BTC-USDT": 1
}

const wss = new WebSocketServer({
  port: 3004,
});

const active_connections = []
const user_connections = {}

wss.on('connection', function connection(ws) {
    active_connections.push(ws);
    ws.on('message', function incoming(json) {
        console.log('Received: %s', json);
        const msg = JSON.parse(json);
        handleMessage(msg, ws);
    });
});

async function handleMessage(msg, ws) {
    switch (msg.op) {
        case "ping":
            const response = {"op": "pong"}
            ws.send(JSON.stringify(response))
            break
        case "login":
            const address = msg.args[0];
            user_connections[address] = ws;
            break
        case "neworder":
            const zktx = msg.args[0];
            const tokenSell = zkTokenIds[zktx.tokenSell];
            const tokenBuy = zkTokenIds[zktx.tokenBuy];
            let market = tokenSell.name + "-" + tokenBuy.name;
            let base_token = tokenSell;
            let quote_token = tokenBuy;
            let base_quantity = zktx.ratio[0] / Math.pow(10, base_token.decimals);
            let quote_quantity = zktx.ratio[1] / Math.pow(10, quote_token.decimals);
            if (!validMarkets[market]) {
                market = tokenBuy.name + "-" + tokenSell.name;
                base_token = tokenBuy;
                quote_token = tokenSell;
                base_quantity = zktx.ratio[1] / Math.pow(10, base_token.decimals);
                quote_quantity = zktx.ratio[0] / Math.pow(10, quote_token.decimals);
            }
            const price = Math.round(base_quantity / quote_quantity, 2);
            const order_type = 'limit';
            const expires = zktx.validUntil;
            const queryargs = {
                user: zktx.accountId,
                market,
                price,
                base_quantity, 
                quote_quantity,
                order_type,
                expires,
                zktx: JSON.stringify(zktx)
            }
            // save order to DB
            const insert = db.prepare('INSERT INTO orders(user, market, price, base_quantity, quote_quantity, order_type, expires, zktx) VALUES(@user, @market, @price, @base_quantity, @quote_quantity, @order_type, @expires, @zktx) RETURNING id');
            const insertstatus = insert.run(queryargs);
            const id = insertstatus.lastInsertRowid;
            // broadcast new order
            const orderreceipt = [id,market,price,base_quantity,quote_quantity,expires];
            broadcastMessage({"op":"neworder_l2", args: orderreceipt});
            ws.send(JSON.stringify({"op":"neworderack", args: orderreceipt}));
            break
        case "subscribe_l2":
            // respond with market data
            break
        default:
            break
    }
}

async function broadcastMessage(msg) {
    for (let i in active_connections) {
        active_connections[i].send(JSON.stringify(msg));
    }
}
