import WebSocket, { WebSocketServer } from 'ws';
import pg from 'pg'
import fs from 'fs';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config()

const { Pool } = pg;
pg.types.setTypeParser(20, parseInt);
pg.types.setTypeParser(23, parseInt);
pg.types.setTypeParser(1700, parseFloat);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
})
const migration = fs.readFileSync('schema.sql', 'utf8');
pool.query(migration)
    .catch(console.error);


const zkTokenIds = {
    // zkSync Mainnet
    1: {
        0: {name:'ETH',decimals:18},
        4: {name:'USDT',decimals:6},
        2: {name:'USDC',decimals:6},
    },

    // zkSync Rinkeby
    1000: {
        0: {name:'ETH',decimals:18},
        1: {name:'USDT',decimals:6},
        2: {name:'USDC',decimals:6},
    }
}
const validMarkets = {
    // zkSync Mainnet
    1: {
        "ETH-USDT": {},
    },
    
    // zkSync Rinkeby
    1000: {
        "ETH-USDT": {},
    }
}

const active_connections = {}
const user_connections = {}

for (let chain in validMarkets) {
    user_connections[chain] = {}
    for (let market in validMarkets[chain]) {
        validMarkets[chain][market].subscriptions = new Set();
    }
}

updateMarketSummaries();
setInterval(async function () {
    clearDeadConnections();
    await updateMarketSummaries();
    const lastprices = getLastPrices();
    broadcastMessage({"op":"lastprice", args: [lastprices]});
}, 10000);

const wss = new WebSocketServer({
  port: process.env.PORT || 3004,
});


wss.on('connection', function connection(ws) {
    ws.uuid = randomUUID();
    active_connections[ws.uuid] = {
        lastPing: Date.now(),
        chainid: null,
        userid: null,
        marketSubscriptions: [],
        ws
    };
    const lastprices = getLastPrices();
    ws.send(JSON.stringify({op:"lastprice", args: [lastprices]}));
    ws.on('message', function incoming(json) {
        console.log('Received: %s', json);
        const msg = JSON.parse(json);
        handleMessage(msg, ws);
    });
});

async function handleMessage(msg, ws) {
    let orderId, zktx, userid, chainid, market;
    switch (msg.op) {
        case "ping":
            active_connections[ws.uuid].lastPing = Date.now();
            const response = {"op": "pong"}
            ws.send(JSON.stringify(response))
            break
        case "login":
            chainid = msg.args[0];
            userid = msg.args[1];
            active_connections[ws.uuid].chainid = chainid;
            active_connections[ws.uuid].userid = userid;
            user_connections[chainid][userid] = ws;
            break
        case "indicatemaker":
            break
        case "submitorder":
            chainid = msg.args[0];
            zktx = msg.args[1];
            processorder(chainid, zktx);
            break
        case "cancelorder":
            chainid = msg.args[0];
            orderId = msg.args[1];
            let cancelresult;
            try {
                await cancelorder(chainid, orderId, ws);
            }
            catch (e) {
                ws.send(JSON.stringify({op:"cancelorderreject",args:[orderId, e.message]}));
                break
            }
            ws.send(JSON.stringify({op:"cancelorderack",args:[[orderId]]}));
            break
        case "cancelall":
            chainid = msg.args[0];
            userid = msg.args[1];
            if (user_connections[chainid][userid] != ws) {
                ws.send(JSON.stringify({op:"cancelallreject",args:[userid, "Unauthorized"]}));
            }
            const canceled_orders = await cancelallorders(userid);
            ws.send(JSON.stringify({op:"cancelorderack",args:[canceled_orders]}));
            break
        case "fillrequest":
            orderId = msg.args[0];
            const fillOrder = msg.args[1];
            zktx = await matchorder(orderId, fillOrder);
            ws.send(JSON.stringify({op:"userordermatch",args:[orderId, zktx,fillOrder]}));
            break
        case "subscribemarket":
            chainid = msg.args[0];
            market = msg.args[1];
            const openorders = await getopenorders(chainid, market);
            const priceData = validMarkets[chainid][market].marketSummary.price;
            try {
                const priceChange = parseFloat(priceData.change.absolute.toFixed(6));
                const marketSummaryMsg = {op: 'marketsummary', args: [market, priceData.last, priceData.high, priceData.low, priceChange, 100, 300000]};
                ws.send(JSON.stringify(marketSummaryMsg));
            } catch (e) {
                console.log(validMarkets);
                console.error(e);
            }
            ws.send(JSON.stringify({"op":"openorders", args: [openorders]}))
            const liquidity = getLiquidity(chainid, market);
            ws.send(JSON.stringify({"op":"liquidity", args: [chainid, market, liquidity]}))
            active_connections[ws.uuid].marketSubscriptions.push([chainid,market]);
            validMarkets[chainid][market].subscriptions.add(ws.uuid);
            break
        case "unsubscribemarket":
            chainid = msg.args[0];
            market = msg.args[1];
            active_connections[ws.uuid].marketSubscriptions.filter(m => m[0] !== chainid || m[1] !== market);
            validMarkets[chainid][market].subscriptions.delete(ws.uuid);
            break
        default:
            break
    }
}

async function processorder(chainid, zktx) {
    const tokenSell = zkTokenIds[chainid][zktx.tokenSell];
    const tokenBuy = zkTokenIds[chainid][zktx.tokenBuy];
    let side, base_token, quote_token, base_quantity, quote_quantity, price;
    let market = tokenSell.name + "-" + tokenBuy.name;
    if (validMarkets[chainid][market]) {
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
    const queryargs = [
        chainid,
        user,
        zktx.nonce,
        market,
        side,
        price,
        base_quantity, 
        quote_quantity,
        order_type,
        'o',
        expires,
        JSON.stringify(zktx)
    ]
    // save order to DB
    const query = 'INSERT INTO orders(chainid, userid, nonce, market, side, price, base_quantity, quote_quantity, order_type, order_status, expires, zktx) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id'
    const insert = await pool.query(query, queryargs);
    const orderId = insert.rows[0].id;
    const orderreceipt = [chainid,orderId,market,side,price,base_quantity,quote_quantity,expires,user];
    
    // broadcast new order
    broadcastMessage({"op":"openorders", args: [[orderreceipt]]});
    user_connections[chainid][user].send(JSON.stringify({"op":"userorderack", args: [orderreceipt]}));

    return orderId
}

async function cancelallorders(userid) {
    const values = [userid];
    const select = await pool.query("SELECT id FROM orders WHERE userid=$1", values);
    const ids = select.rows.map(s => s.id);
    const update = await pool.query("UPDATE orders SET order_status='c' WHERE userid=$1", values);
    return ids;
}

async function cancelorder(chainid, orderId, ws) {
    const values = [orderId, chainid];
    const select = await pool.query("SELECT userid FROM orders WHERE id=$1 AND chainid=$2", values);
    if (select.rows.length == 0) {
        throw new Error("Order not found");
    }
    const userid = select.rows[0].userid;
    if (user_connections[chainid][userid] != ws) {
        throw new Error("Unauthorized");
    }
    const updatevalues = [orderId];
    const update = await pool.query("UPDATE orders SET order_status='c' WHERE id=$1", updatevalues);
    return true;
}

async function matchorder(orderId, fillOrder) {
    // TODO: Validation logic to make sure the orders match and the user is getting a good fill
    const values = [orderId];
    const update = await pool.query("UPDATE orders SET order_status='m' WHERE id=$1", values);
    const select = await pool.query("SELECT zktx FROM orders WHERE id=$1", values);
    const selectresult = select.rows[0];
    const zktx = JSON.parse(selectresult.zktx);
    return zktx;
}


async function broadcastMessage(msg) {
    for (let wsid in active_connections) {
        active_connections[wsid].ws.send(JSON.stringify(msg));
    }
}

async function getopenorders(chainid, market) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid FROM orders WHERE market=$1 AND chainid=$2 AND order_status='o'",
        values: [market, chainid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

function getLiquidity(chainid, market) {
    // TODO: pull real data instead of mocked data
    validMarkets[chainid][market].liquidity = [
        [0.1, 0.003, 'd'],
        [0.05, 0.004, 'd'],
        [0.5, 0.005, 'd'],
        [0.2, 0.008, 'd'],
        [0.147, 0.01, 'd'],
        [0.123, 0.011, 'd'],
        [0.3452, 0.013, 'd'],
        [0.62, 0.02, 'd'],
        [0.19, 0.025, 'd'],
        [0.23, 0.039, 'd'],
        [0.02, 0.041, 'd'],
        [0.07, 0.042, 'd'],
        [0.13, 0.043, 'd'],
    ]
    return validMarkets[chainid][market].liquidity;
}

async function updateMarketSummaries() {
    const productUpdates = {};
    for (let chain in validMarkets) {
        for (let product in validMarkets[chain]) {
            if (productUpdates[product]) {
                validMarkets[chain][product].marketSummary = productUpdates[product];
            }
            else {
                const cryptowatch_market = product.replace('-','').toLowerCase();
                const headers = { 'X-CW-API-Key': process.env.CRYPTOWATCH_API_KEY };
                const url = `https://api.cryptowat.ch/markets/binance/${cryptowatch_market}/summary`;
                const r = await fetch(url, { headers });
                const data = await r.json();
                const priceData = data.result.price;
                validMarkets[chain][product].marketSummary = data.result;
                productUpdates[product] = data.result;
            }
        }
    }
    return validMarkets;
}

function getLastPrices() {
    const uniqueProducts = [];
    const lastprices = []
    for (let chain in validMarkets) {
        for (let product in validMarkets[chain]) {
            if (!uniqueProducts.includes(product)) {
                try {
                    const lastPrice = validMarkets[chain][product].marketSummary.price.last;
                    const change = parseFloat(validMarkets[chain][product].marketSummary.price.change.absolute.toFixed(6));
                    lastprices.push([product, lastPrice, change]);
                    uniqueProducts.push(product);
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }
    return lastprices;
}

function broadcastLastPrices() {
    const lastprices = getLastPrices();
    broadcastMessage({"op":"lastprice", args: [lastprices]});
}

function sendLastPriceData (ws) {
    const lastprices = getLastPrices();
    ws.send(JSON.stringify({op:"lastprice", args: [lastprices]}));
}

function clearDeadConnections () {
    const now = Date.now();
    for (let wsid in active_connections) {
        if (active_connections[wsid].lastPing - now > 10000) {
            console.log("Deleting dead connection");
            delete active_connections[wsid];
        }
    }
}
