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


const starknetContracts = {
    "0x06a75fdd9c9e376aebf43ece91ffb315dbaa753f9c0ddfeb8d7f3af0124cd0b6": "ETH",
    "0x0545d006f9f53169a94b568e031a3e16f0ea00e9563dc0255f15c2a1323d6811": "USDC",
    "0x03d3af6e3567c48173ff9b9ae7efc1816562e558ee0cc9abc0fe1862b2931d9a": "USDT"
}
const starknetAssets = {
    "ETH": { decimals: 18 },
    "USDC": { decimals: 6 },
    "USDT": { decimals: 6 },
}
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
    },
    
    // Starknet Alpha
    1001: {
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
await updatePendingOrders();
setInterval(async function () {
    clearDeadConnections();
    await updateMarketSummaries();
    const lastprices = getLastPrices();
    broadcastMessage({"op":"lastprice", args: [lastprices]});
}, 5000);
setInterval(updateVolumes, 120000);
setInterval(updatePendingOrders, 60000);

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
            if (chainid == 1 || chainid == 1000) {
                processorderzksync(chainid, zktx);
            }
            else if (chainid == 1001) {
                processorderstarknet(chainid, zktx);
            }
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
            const matchOrderResult = await matchorder(chainid, orderId, fillOrder);
            ws.send(JSON.stringify({op:"userordermatch",args:[chainid, orderId, matchOrderResult.zktx,fillOrder]}));
            broadcastMessage({op:"orderstatus",args:[[[chainid,orderId,'m']]]});
            broadcastMessage({op:"fills",args:[[matchOrderResult.fill]]});
            break
        case "subscribemarket":
            chainid = msg.args[0];
            market = msg.args[1];
            const openorders = await getopenorders(chainid, market);
            const filledorders = await getfilledorders(chainid, market);
            const priceData = validMarkets[chainid][market].marketSummary.price;
            let volumes = validMarkets[chainid][market].volumes;
            if (!volumes) {
                volumes = {
                    base: 0, 
                    quote: 0
                }
            }
            try {
                const priceChange = parseFloat(priceData.change.absolute.toPrecision(6));
                const marketSummaryMsg = {op: 'marketsummary', args: [market, priceData.last, priceData.high, priceData.low, priceChange, volumes.base, volumes.quote]};
                ws.send(JSON.stringify(marketSummaryMsg));
            } catch (e) {
                console.error(e);
            }
            ws.send(JSON.stringify({"op":"orders", args: [openorders]}))
            ws.send(JSON.stringify({"op":"fills", args: [filledorders]}))
            if ( ([1,1000]).includes(chainid) ) {
                const liquidity = getLiquidity(chainid, market);
                ws.send(JSON.stringify({"op":"liquidity", args: [chainid, market, liquidity]}))
            }
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
    if (chainid == 1001) throw new Error("Not for Starknet orders");

    let update;
    try {
        const values = [newstatus,chainid, orderid];
        update = await pool.query("UPDATE offers SET order_status=$1 WHERE chainid=$2 AND id=$3 AND order_status IN ('b', 'm')", values);
        const update2 = await pool.query("UPDATE fills SET fill_status=$1 WHERE taker_offer_id=$3 AND chainid=$2 AND fill_status IN ('b', 'm')", values);
    }
    catch (e) {
        console.error("Error while updating fill status");
        console.error(e);
        return false;
    }
    return update.affectedRows > 0;
}

async function updateMatchedOrder(chainid, orderid, newstatus, txhash) {
    let update;
    try {
        let values = [newstatus,chainid, orderid];
        update = await pool.query("UPDATE offers SET order_status=$1 WHERE chainid=$2 AND id=$3 AND order_status='m'", values);
        values = [newstatus,txhash,chainid, orderid];
        const update2 = await pool.query("UPDATE fills SET fill_status=$1, txhash=$2 WHERE taker_offer_id=$4 AND chainid=$3", values);
    }
    catch (e) {
        console.error("Error while updating matched order");
        console.error(e);
        return false;
    }
    return update.affectedRows > 0;
}

async function processorderzksync(chainid, zktx) {
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
        const base_quantity_decimals = Math.min(base_token.decimals, 10);
        base_quantity = ((quote_quantity / price).toFixed(base_quantity_decimals)) / 1;
        base_quantity = base_quantity.toPrecision(10) / 1;
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
        JSON.stringify(zktx),
        base_quantity
    ]
    // save order to DB
    const query = 'INSERT INTO offers(chainid, userid, nonce, market, side, price, base_quantity, quote_quantity, order_type, order_status, expires, zktx, insert_timestamp, unfilled) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13) RETURNING id'
    const insert = await pool.query(query, queryargs);
    const orderId = insert.rows[0].id;
    const orderreceipt = [chainid,orderId,market,side,price,base_quantity,quote_quantity,expires,user.toString(),'o',null,base_quantity];
    
    // broadcast new order
    broadcastMessage({"op":"orders", args: [[orderreceipt]]});
    user_connections[chainid][user].send(JSON.stringify({"op":"userorderack", args: [orderreceipt]}));

    return orderId
}

async function processorderstarknet(chainid, zktx) {
    const user = zktx[1];
    const baseCurrency = starknetContracts[zktx[2]];
    const quoteCurrency = starknetContracts[zktx[3]];
    const market = baseCurrency + "-" + quoteCurrency;
    const side = zktx[4] === 0 ? 'b': 's';
    const base_quantity = zktx[5] / Math.pow(10, starknetAssets[baseCurrency].decimals);
    const price = zktx[6] / 1e6;
    const quote_quantity = price*base_quantity;
    const expiration = zktx[7];
    const order_type = 'limit';

    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const query = "SELECT match_limit_order($1, $2, $3, $4, $5, $6, 'fills', 'offer')"
        const values = [chainid, user, market, side, price, base_quantity];
        console.log(values);
        await client.query(query, values);
        const fills = await client.query("FETCH ALL FROM fills");
        console.log(fills.rows);
        const orderupdates = [];
        const marketFills = [];
        fills.rows.forEach(row => { 
            if (row.remaining > 0)
                orderupdates.push([chainid,row.maker_offer_id,'pm', row.fill_qty, row.remaining]);
            else
                orderupdates.push([chainid,row.maker_offer_id,'m']);
            marketFills.push([chainid,row.fill_id,market,side,row.price,row.fill_qty]);
        });
        broadcastMessage({"op":"orderstatus", args:[orderupdates]});
        broadcastMessage({"op":"fills", args:[marketFills]});
        const offer = await client.query("FETCH ALL FROM offer");
        console.log(offer.rows);
        const openorders = offer.rows.map(row => [chainid, row.order_id, market, row.side, row.price, row.amount, row.price*row.amount,expiration,user,row.order_status,null,row.unfilled]);
        if (openorders.length > 0) {
            broadcastMessage({"op":"orders", args:[openorders]});
        }
        await client.query('COMMIT')
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
}

async function cancelallorders(userid) {
    const values = [userid];
    const select = await pool.query("SELECT id FROM offers WHERE userid=$1 AND order_status='o'", values);
    const ids = select.rows.map(s => s.id);
    const update = await pool.query("UPDATE offers SET order_status='c' WHERE userid=$1 AND order_status='o'", values);
    return ids;
}

async function cancelorder(chainid, orderId, ws) {
    const values = [orderId, chainid];
    const select = await pool.query("SELECT userid FROM offers WHERE id=$1 AND chainid=$2", values);
    if (select.rows.length == 0) {
        throw new Error("Order not found");
    }
    const userid = select.rows[0].userid;
    if (user_connections[chainid][userid] != ws) {
        throw new Error("Unauthorized");
    }
    const updatevalues = [orderId];
    const update = await pool.query("UPDATE offers SET order_status='c' WHERE id=$1", updatevalues);
    return true;
}

async function matchorder(chainid, orderId, fillOrder) {
    // TODO: Validation logic to make sure the orders match and the user is getting a good fill
    let values = [orderId, chainid];
    const select = await pool.query("SELECT userid, price, base_quantity, market, zktx, side FROM offers WHERE id=$1 AND chainid=$2", values);
    if (select.rows.length === 0) throw new Error("No order found for ID " + orderId);
    const selectresult = select.rows[0];
    const zktx = JSON.parse(selectresult.zktx);

    const update1 = await pool.query("UPDATE offers SET order_status='m' WHERE id=$1 AND chainid=$2", values);

    values = [orderId, chainid, selectresult.market, selectresult.userid, selectresult.price, selectresult.base_quantity];
    const update2 = await pool.query("INSERT INTO fills (chainid, market, taker_offer_id, taker_user_id, price, amount) VALUES ($2, $3, $1, $4, $5, $6) RETURNING id", values);
    const fill_id = update2.rows[0].id;
    const fill = [chainid, fill_id, selectresult.market, selectresult.side, selectresult.price, selectresult.base_quantity]; 

    return { zktx, fill };
}


async function broadcastMessage(msg) {
    for (let wsid in active_connections) {
        active_connections[wsid].ws.send(JSON.stringify(msg));
    }
}

async function getopenorders(chainid, market) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,null,unfilled FROM offers WHERE market=$1 AND chainid=$2 AND unfilled > 0 AND order_status IN ('o', 'pm', 'pf')",
        values: [market, chainid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

async function getuserorders(chainid, userid) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status FROM offers WHERE chainid=$1 AND userid=$2 ORDER BY id DESC LIMIT 25",
        values: [chainid, userid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

async function getfilledorders(chainid, market) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity FROM offers WHERE market=$1 AND chainid=$2 AND order_status='f' ORDER BY id DESC LIMIT 5",
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
            [12, 0.0008, 'd'],
            [14, 0.0015, 'd'],
            [2.5, 0.003, 'd'],
            [1.1, 0.005, 'd'],
            [1.2, 0.008, 'd'],
            [10.847, 0.01, 'd'],
            [7.023, 0.011, 'd'],
            [1.3452, 0.013, 'd'],
            [1.62, 0.02, 'd'],
            [4.19, 0.025, 'd'],
            [1.23, 0.039, 'd'],
            [3.02, 0.041, 'd'],
            [1.32, 0.049, 'd'],
            [2.07, 0.051, 'd'],
            [1.07, 0.052, 'd'],
            [2.13, 0.063, 'd'],
        ]
    }
    else if (baseCurrency == "USDT" || baseCurrency == "USDC") {
        validMarkets[chainid][market].liquidity = [
            [70000, 0.0004, 'd'],
            [60000, 0.0007, 'd'],
            [18000, 0.0014, 'd'],
            [13030, 0.0017, 'd'],
            [29000, 0.0023, 'd'],
            [13010, 0.0024, 'd'],
            [4000, 0.03, 'd'],
            [1590, 0.0033, 'd'],
            [5200, 0.0038, 'd'],
            [1900, 0.0045, 'd'],
            [11900, 0.0048, 'd'],
            [2900, 0.0049, 'd'],
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
                validMarkets[chain][product].marketSummary = data.result;
                productUpdates[product] = data.result;
            }
        }
    }
    return validMarkets;
}

async function updateVolumes() {
    const one_day_ago = new Date(Date.now() - 86400*1000).toISOString();
    const query = {
        text: "SELECT chainid, market, SUM(base_quantity) AS base_volume FROM offers WHERE order_status IN ('m', 'f', 'b') AND insert_timestamp > $1 AND chainid IS NOT NULL GROUP BY (chainid, market)",
        values: [one_day_ago]
    }
    const select = await pool.query(query);
    select.rows.forEach(row => {
        const price = validMarkets[row.chainid][row.market].marketSummary.price.last;
        const quoteVolume = parseFloat((row.base_volume * price).toPrecision(6))
        validMarkets[row.chainid][row.market].volumes = {
            base: parseFloat(row.base_volume.toPrecision(6)),
            quote: quoteVolume,
        };
    })
    return true;
}

async function updatePendingOrders() {
    const one_min_ago = new Date(Date.now() - 60*1000).toISOString();
    const query = {
        text: "UPDATE offers SET order_status='c' WHERE ((order_status='m' OR order_status='b') AND insert_timestamp < $1) OR (order_status='o' AND unfilled = 0) RETURNING chainid, id, order_status;",
        values: [one_min_ago]
    }
    const update = await pool.query(query);
    if (update.rowCount > 0) {
        const orderUpdates = update.rows.map(row => [row.chainid, row.id, row.order_status]);
        broadcastMessage({"op":"orderstatus", args: [orderUpdates]});
    }
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
