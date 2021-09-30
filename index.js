import WebSocket, { WebSocketServer } from 'ws';
import SqliteDatabase from 'better-sqlite3';
import fs from 'fs';
import fetch from 'node-fetch';

const db = new SqliteDatabase('zigzag.db');
const migration = fs.readFileSync('schema.sql', 'utf8');
db.exec(migration);


const zkTokenIds = {
    0: {name:'ETH',decimals:18},
    1: {name:'USDT',decimals:6}
}
const validMarkets = {
    "ETH-BTC": {},
    "ETH-USDT": {},
    "BTC-USDT": {}
}

Object.keys(validMarkets).forEach(function (product) {
    updateMarketSummary(product);
    setInterval(function () {
        updateMarketSummary(product);
    }, 300000);
    setInterval(function () {
        broadcastLastPrice(product);
    }, 30000);
});

const wss = new WebSocketServer({
  port: process.env.PORT || 3004,
});

const active_connections = []
const user_connections = {}
const market_subscriptions = {}
Object.keys(validMarkets).forEach(market => market_subscriptions[market] = []);

wss.on('connection', function connection(ws) {
    active_connections.push(ws);
    sendLastPriceData(ws);
    ws.on('message', function incoming(json) {
        console.log('Received: %s', json);
        const msg = JSON.parse(json);
        handleMessage(msg, ws);
    });
});

async function handleMessage(msg, ws) {
    let orderId, zktx;
    switch (msg.op) {
        case "ping":
            const response = {"op": "pong"}
            ws.send(JSON.stringify(response))
            break
        case "login":
            const address = msg.args[0];
            user_connections[address] = ws;
            ws.send(JSON.stringify(marketSummaryMsg))
            break
        case "indicatemaker":
            break
        case "submitorder":
            zktx = msg.args[0];
            processorder(zktx);
            break
        case "fillrequest":
            orderId = msg.args[0];
            const fillOrder = msg.args[1];
            zktx = matchorder(orderId, fillOrder);
            ws.send(JSON.stringify({op:"userordermatch",args:[zktx,fillOrder]}));
            break
        case "subscribemarket":
            const market = msg.args[0];
            const openorders = getopenorders(market);
            const priceData = validMarkets[market].marketSummary.price;
            try {
                const marketSummaryMsg = {op: 'marketsummary', args: [market, priceData.last, priceData.high, priceData.low, priceData.change.absolute, 100, 300000]};
                ws.send(JSON.stringify(marketSummaryMsg));
            } catch (e) {
                console.log(validMarkets);
                console.error(e);
            }
            ws.send(JSON.stringify({"op":"openorders", args: [openorders]}))
            // TODO: send real liquidity
            ws.send(JSON.stringify({"op":"liquidity", args: []}))
            break
        default:
            break
    }
}

async function processorder(zktx) {
    const tokenSell = zkTokenIds[zktx.tokenSell];
    const tokenBuy = zkTokenIds[zktx.tokenBuy];
    let side, base_token, quote_token, base_quantity, quote_quantity, price;
    let market = tokenSell.name + "-" + tokenBuy.name;
    if (validMarkets[market]) {
        side = 's';
        base_token = tokenSell;
        quote_token = tokenBuy;
        price = ( zktx.ratio[1] / Math.pow(10, quote_token.decimals) ) / 
                ( zktx.ratio[0] / Math.pow(10, base_token.decimals) );
        base_quantity = zktx.amount / Math.pow(10, base_token.decimals);
        quote_quantity = base_quantity * price;
    }
    else {
        market = tokenBuy.name + "-" + tokenSell.name;
        side = 'b'
        base_token = tokenBuy;
        quote_token = tokenSell;
        price = ( zktx.ratio[0] / Math.pow(10, quote_token.decimals) ) / 
                ( zktx.ratio[1] / Math.pow(10, base_token.decimals) );
        quote_quantity = zktx.amount / Math.pow(10, quote_token.decimals);
        base_quantity = quote_quantity / price;
    }
    const order_type = 'limit';
    const expires = zktx.validUntil;
    const user = zktx.accountId;
    const queryargs = {
        user,
        nonce: zktx.nonce,
        market,
        side,
        price,
        base_quantity, 
        quote_quantity,
        order_type,
        order_status: 'o',
        expires,
        zktx: JSON.stringify(zktx)
    }
    // save order to DB
    const insert = db.prepare('INSERT INTO orders(user, nonce, market, side, price, base_quantity, quote_quantity, order_type, order_status, expires, zktx) VALUES(@user, @nonce, @market, @side, @price, @base_quantity, @quote_quantity, @order_type, @order_status, @expires, @zktx)');
    const insertstatus = insert.run(queryargs);
    const orderId = insertstatus.lastInsertRowid;
    const orderreceipt = [orderId,market,side,price,base_quantity,quote_quantity,expires];
    
    // broadcast new order
    broadcastMessage({"op":"openorders", args: [[orderreceipt]]});
    user_connections[user].send(JSON.stringify({"op":"userorderack", args: [orderreceipt]}));

    return orderId
}

function matchorder(orderId, fillOrder) {
    // TODO: Validation logic to make sure the orders match and the user is getting a good fill
    const update = db.prepare("UPDATE orders SET order_status='m' WHERE id=@orderId");
    const updateresult = update.run({orderId});
    const select = db.prepare("SELECT zktx FROM orders WHERE id=@orderId");
    const selectresult = select.get({orderId});
    const zktx = JSON.parse(selectresult.zktx);
    return zktx;
}


async function broadcastMessage(msg) {
    for (let i in active_connections) {
        active_connections[i].send(JSON.stringify(msg));
    }
}

function getopenorders(market) {
    const select = db.prepare("SELECT id,market,side,price,base_quantity,quote_quantity,expires FROM orders WHERE market=@market AND order_status='o'");
    const selectresult = select.raw().all({market});
    return selectresult;
}

async function updateMarketSummary (product) {
    const cryptowatch_market = product.replace('-','').toLowerCase();
    const url = `https://api.cryptowat.ch/markets/binance/${cryptowatch_market}/summary`;
    const r = await fetch(url);
    const data = await r.json();
    const priceData = data.result.price;
    validMarkets[product].marketSummary = data.result;
    return data;
}

function broadcastLastPrice (product) {
    try {
        const lastPrice = validMarkets[product].marketSummary.price.last;
        broadcastMessage({"op":"lastprice", args: [[product, lastPrice]]});
    } catch (e) {
        console.error(e);
    }
}

function sendLastPriceData (ws) {
    const prices = [];
    Object.keys(validMarkets).forEach(function (product) {
        try {
            const lastPrice = validMarkets[product].marketSummary.price.last;
            prices.push([product, lastPrice]);
        } catch (e) {
            console.error(e);
        }
    });
    ws.send(JSON.stringify({op:"lastprice", args: [prices]}));
}
