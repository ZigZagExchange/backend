// SPDX-License-Identifier: BUSL-1.1

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
        "ETH-USDC": {},
        "USDC-USDT": {},
    },
    
    // zkSync Rinkeby
    1000: {
        "ETH-USDT": {},
        "ETH-USDC": {},
        "USDC-USDT": {},
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

await updateMarketSummaries();
await updateVolumes();
setInterval(async function () {
    clearDeadConnections();
    await updateMarketSummaries();
    const lastprices = getLastPrices();
    broadcastMessage({"op":"lastprice", args: [lastprices]});
}, 10000);
setInterval(updateVolumes, 120000);

const wss = new WebSocketServer({
  port: process.env.PORT || 3004,
});


wss.on('connection', function connection(ws, req) {
    ws.uuid = randomUUID();
    console.log("New connection: ", req.connection.remoteAddress);
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
        const msg = JSON.parse(json);
        if (msg.op != 'ping') {
            console.log('Received: %s', json);
        }
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
            const userorders = await getuserorders(chainid, userid);
            ws.send(JSON.stringify({"op":"userorders", args: [userorders]}))
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
            broadcastMessage({op:"orderstatus",args:[[[chainid, orderId, 'c']]]});
            break
        case "cancelall":
            chainid = msg.args[0];
            userid = msg.args[1];
            if (user_connections[chainid][userid] != ws) {
                ws.send(JSON.stringify({op:"cancelallreject",args:[userid, "Unauthorized"]}));
            }
            const canceled_orders = await cancelallorders(userid);
            const orderupdates = canceled_orders.map(orderid => [chainid,orderid,'c']);
            broadcastMessage({op:"orderstatus",args:[orderupdates]});
            break
        case "fillrequest":
            chainid = msg.args[0];
            orderId = msg.args[1];
            const fillOrder = msg.args[2];
            zktx = await matchorder(orderId, fillOrder);
            ws.send(JSON.stringify({op:"userordermatch",args:[chainid, orderId, zktx,fillOrder]}));
            broadcastMessage({op:"orderstatus",args:[[[chainid,orderId,'m']]]});
            break
        case "subscribemarket":
            chainid = msg.args[0];
            market = msg.args[1];
            const openorders = await getopenorders(chainid, market);
            const filledorders = await getfilledorders(chainid, market);
            const marketSummary = validMarkets[chainid][market].marketSummary;
            try {
                const priceChange = parseFloat(marketSummary.price.change.absolute.toPrecision(6));
                const marketSummaryMsg = {op: 'marketsummary', args: [market, marketSummary.price.last, marketSummary.price.high, marketSummary.price.low, priceChange, marketSummary.volume, marketSummary.volumeQuote]};
                ws.send(JSON.stringify(marketSummaryMsg));
            } catch (e) {
                console.log(validMarkets);
                console.error(e);
            }
            ws.send(JSON.stringify({"op":"openorders", args: [openorders]}))
            ws.send(JSON.stringify({"op":"fillhistory", args: [filledorders]}))
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
        case "orderstatusupdate":
            const updates = msg.args[0];
            const broadcastUpdates = [];
            updates.forEach(update => {
                const chainid = update[0];
                const orderId = update[1];
                const newstatus = update[2];
                let success;
                if (newstatus == 'b') {
                    const txhash = update[3];
                    success = updateMatchedOrder(chainid, orderId, newstatus, txhash);
                }
                if (newstatus == 'r' || newstatus == 'f') {
                    const txhash = update[3];
                    success = updateOrderFillStatus(chainid, orderId, newstatus);
                }
                if (success) {
                    broadcastUpdates.push(update);
                }
            });
            if (broadcastUpdates.length > 0) {
                broadcastMessage({op:"orderstatus",args: [broadcastUpdates]});
            }
        default:
            break
    }
}

async function updateOrderFillStatus(chainid, orderid, newstatus) {
    const values = [newstatus,chainid, orderid];
    let update;
    try {
        update = await pool.query("UPDATE orders SET order_status=$1 WHERE chainid=$2 AND id=$3 AND (order_status='b' OR order_status='m')", values);
    }
    catch (e) {
        console.error("Error while updating fill status");
        console.error(e);
        return false;
    }
    return update.affectedRows > 0;
}

async function updateMatchedOrder(chainid, orderid, newstatus, txhash) {
    const values = [newstatus,txhash,chainid, orderid];
    let update;
    try {
        update = await pool.query("UPDATE orders SET order_status=$1, txhash=$2 WHERE chainid=$3 AND id=$4 AND order_status='m'", values);
    }
    catch (e) {
        console.error("Error while updating matched order");
        console.error(e);
        return false;
    }
    return update.affectedRows > 0;
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
        base_quantity = Math.ceil(quote_quantity / price * 1e6) / 1e6;
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
    const orderreceipt = [chainid,orderId,market,side,price,base_quantity,quote_quantity,expires,user.toString(),'o'];
    
    // broadcast new order
    broadcastMessage({"op":"openorders", args: [[orderreceipt]]});
    user_connections[chainid][user].send(JSON.stringify({"op":"userorderack", args: [orderreceipt]}));

    return orderId
}

async function cancelallorders(userid) {
    const values = [userid];
    const select = await pool.query("SELECT id FROM orders WHERE userid=$1 AND order_status='o'", values);
    const ids = select.rows.map(s => s.id);
    const update = await pool.query("UPDATE orders SET order_status='c' WHERE userid=$1 AND order_status='o'", values);
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
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,txhash FROM orders WHERE market=$1 AND chainid=$2 AND order_status='o'",
        values: [market, chainid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

async function getuserorders(chainid, userid) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,txhash FROM orders WHERE chainid=$1 AND userid=$2 ORDER BY id DESC LIMIT 5",
        values: [chainid, userid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

async function getfilledorders(chainid, market) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,txhash FROM orders WHERE market=$1 AND chainid=$2 AND order_status='f' ORDER BY id DESC LIMIT 5",
        values: [market, chainid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

function getLiquidity(chainid, market) {
    const baseCurrency = market.split("-")[0];
    const quoteCurrency = market.split("-")[1];
    if (baseCurrency == "ETH") {
        validMarkets[chainid][market].liquidity = [
            [5, 0.0012, 'd'],
            [2, 0.002, 'd'],
            [0.5, 0.003, 'd'],
            [0.3, 0.005, 'd'],
            [0.2, 0.008, 'd'],
            [0.847, 0.01, 'd'],
            [0.123, 0.011, 'd'],
            [0.3452, 0.013, 'd'],
            [1.62, 0.02, 'd'],
            [0.19, 0.025, 'd'],
            [0.23, 0.039, 'd'],
            [1.02, 0.041, 'd'],
            [1.07, 0.052, 'd'],
            [2.13, 0.063, 'd'],
        ]
    }
    else if (baseCurrency == "USDT" || baseCurrency == "USDC") {
        validMarkets[chainid][market].liquidity = [
            [20000, 0.0012, 'd'],
            [10000, 0.0014, 'd'],
            [2000, 0.0018, 'd'],
            [2030, 0.002, 'd'],
            [1000, 0.0023, 'd'],
            [2010, 0.0024, 'd'],
            [2000, 0.03, 'd'],
            [1590, 0.0033, 'd'],
            [5200, 0.0038, 'd'],
            [1900, 0.0045, 'd'],
            [2300, 0.0057, 'd'],
            [1020, 0.0061, 'd'],
            [1070, 0.0082, 'd'],
            [2130, 0.0093, 'd'],
        ]
    }
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
                // keep old volumes
                try {
                    data.result.volume = validMarkets[chain][product].marketSummary.volume;
                    data.result.volumeQuote = validMarkets[chain][product].marketSummary.volumeQuote;
                } catch(e) {
                    // pass
                }
                const priceData = data.result.price;
                validMarkets[chain][product].marketSummary = data.result;
                productUpdates[product] = data.result;
            }
        }
    }
    return validMarkets;
}

async function updateVolumes() {
    const query = {
        text: "SELECT chainid, market, SUM(base_quantity) AS base_volume FROM orders WHERE order_status IN ('m', 'f', 'b') AND id > 8000 AND chainid IS NOT NULL GROUP BY (chainid, market)"
    }
    const select = await pool.query(query);
    select.rows.forEach(row => {
        const price = validMarkets[row.chainid][row.market].marketSummary.price.last;
        const quoteVolume = parseFloat((row.base_volume * price).toPrecision(8))
        validMarkets[row.chainid][row.market].marketSummary.volume = parseFloat(row.base_volume.toPrecision(8));
        validMarkets[row.chainid][row.market].marketSummary.volumeQuote = quoteVolume;
    })
    return true;
}

function getLastPrices() {
    const uniqueProducts = [];
    const lastprices = []
    for (let chain in validMarkets) {
        for (let product in validMarkets[chain]) {
            if (!uniqueProducts.includes(product)) {
                try {
                    const lastPrice = validMarkets[chain][product].marketSummary.price.last;
                    const change = parseFloat(validMarkets[chain][product].marketSummary.price.change.absolute.toPrecision(6));
                    lastprices.push([product, lastPrice, change]);
                    uniqueProducts.push(product);
                } catch (e) {
                    console.log("Couldn't update price. Ignoring");
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
        if (now - active_connections[wsid].lastPing > 20000) {
            console.log("Deleting dead connection", wsid);
            active_connections[wsid].ws.close();
            delete active_connections[wsid];
        }
    }
}

async function broadcastOrderMatch(orderid) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,userid FROM orders WHERE id=$1",
        values: [orderid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    const order = select.rows[0];
    broadcastMessage({"op":"ordermatch", args: order});
}
