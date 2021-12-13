// SPDX-License-Identifier: BUSL-1.1

import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import pg from 'pg'
import fs from 'fs';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import * as starknet from 'starknet';
import express from 'express';
import * as Redis from 'redis';


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

const redis = Redis.createClient({ url: process.env.REDIS_URL });


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
const gasFees = {
    "ETH": 0.0003,
    "WBTC": 0.00003,
    "USDC": 1,
    "USDT": 1,
    "FRAX": 1,
    "DAI": 1,
}
const zkTokenIds = {
    // zkSync Mainnet
    1: {
        0: {name:'ETH',decimals:18},
        4: {name:'USDT',decimals:6},
        2: {name:'USDC',decimals:6},
        1: {name:'DAI',decimals:18},
        15: {name:'WBTC',decimals:8},
        61: {name:'WETH',decimals:18},
        92: {name:'FRAX',decimals:18},
        120: {name:'FXS',decimals:18},
    },

    // zkSync Rinkeby
    1000: {
        0: {name:'ETH',decimals:18},
        1: {name:'USDT',decimals:6},
        2: {name:'USDC',decimals:6},
        19: {name:'DAI',decimals:18},
        15: {name:'WBTC',decimals:8},
    }
}
const validMarkets = {
    // zkSync Mainnet
    1: {
        "ETH-USDT": {},
        "ETH-USDC": {},
        "ETH-DAI": {},
        "ETH-WBTC": {},
        "WBTC-USDT": {},
        "WBTC-USDC": {},
        "WBTC-DAI": {},
        "USDC-USDT": {},
        "DAI-USDC": {},
        "DAI-USDT": {},
        "FXS-FRAX": {},
        "WETH-ETH": {},
    },
    
    // zkSync Rinkeby
    1000: {
        "ETH-USDT": {},
        "ETH-USDC": {},
        "ETH-DAI": {},
        "USDC-USDT": {},
        "DAI-USDC": {},
        "DAI-USDT": {},
    },
    
    // Starknet Alpha
    1001: {
        "ETH-USDT": {},
        "ETH-USDC": {},
    }
}


const user_connections = {}

for (let chain in validMarkets) {
    user_connections[chain] = {}
}

await updateMarketSummaries();
await updateVolumes();
await updatePendingOrders();
cryptowatchWsSetup();
setInterval(updateMarketSummaries, 60000);
setInterval(clearDeadConnections, 10000);
setInterval(async function () {
    const lastprices = getLastPrices();
    broadcastMessage(null, null, {"op":"lastprice", args: [lastprices]});
}, 3000);
setInterval(updateVolumes, 120000);
setInterval(updatePendingOrders, 60000);

const expressApp = express();
expressApp.use(express.json());
expressApp.post("/", async function (req, res) {
    const httpMessages = ["requestquote", "submitorder", "orderreceiptreq"];
    if (req.headers['content-type'] != "application/json") {
        res.json({ op: "error", args: ["Content-Type header must be set to application/json"] });
        return
    }
    if (!httpMessages.includes(req.body.op)) {
        res.json({ op: "error", args: [req.body.op, "Not supported in HTTP"] });
        return
    }
    const responseMessage = await handleMessage(req.body, null);
    res.header("Content-Type", "application/json");
    res.json(responseMessage);
});
const server = createServer(expressApp);
const port = process.env.PORT || 3004;
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', onWsConnection);

server.on('upgrade', function upgrade(request, socket, head) {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit('connection', ws, request);
    });
});

server.listen(port);
    
function onWsConnection(ws, req) {
    ws.uuid = randomUUID();
    console.log("New connection: ", req.connection.remoteAddress);
    ws.isAlive = true;
    ws.marketSubscriptions = [];
    ws.chainid = 1; // subscribe to zksync mainnet by default
    ws.userid = null;

    const lastprices = getLastPrices();
    ws.send(JSON.stringify({op:"lastprice", args: [lastprices]}));
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    ws.on('message', function incoming(json) {
        const msg = JSON.parse(json);
        if (msg.op != 'ping') {
            console.log('Received: %s', json);
        }
        handleMessage(msg, ws);
    });
}

async function handleMessage(msg, ws) {
    let orderId, zktx, userid, chainid, market;
    switch (msg.op) {
        case "login":
            chainid = msg.args[0];
            userid = msg.args[1];
            ws.chainid = chainid;
            ws.userid = userid;
            user_connections[chainid][userid] = ws;
            const userorders = await getuserorders(chainid, userid);
            const userfills = await getuserfills(chainid, userid);
            ws.send(JSON.stringify({"op":"orders", args: [userorders]}))
            ws.send(JSON.stringify({"op":"fills", args: [userfills]}))
            break
        case "orderreceiptreq":
            chainid = msg.args[0];
            orderId = msg.args[1];
            try {
                return await getorder(chainid, orderId);
            } catch (e) {
                return { "op": "error", args: [msg.op, e.message] }
            }
            break
        case "indicatemaker":
            break
        case "submitorder":
            chainid = msg.args[0];
            zktx = msg.args[1];
            if (chainid == 1 || chainid == 1000) {
                try {
                    return await processorderzksync(chainid, zktx);
                }
                catch(e) {
                    console.error(e);
                    const errorMsg = {"op":"error", args: ["submitorder", e.message]};
                    ws.send(JSON.stringify(errorMsg));
                    return errorMsg;
                }
            }
            else if (chainid === 1001) {
                try {
                    return await processorderstarknet(chainid, zktx);
                } catch (e) {
                    console.error(e);
                    const errorMsg = {"op":"error", args: ["submitorder", e.message]};
                    ws.send(JSON.stringify(errorMsg));
                    return errorMsg;
                }
            }
            else {
                const errorMsg = {"op":"error", args: ["Invalid chainid in submitorder"]};
                ws.send(JSON.stringify(errorMsg));
                return errorMsg;
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
            broadcastMessage(chainid, null, {op:"orderstatus",args:[[[chainid, orderId, 'c']]]});
            break
        case "cancelall":
            chainid = msg.args[0];
            userid = msg.args[1];
            if (user_connections[chainid][userid] != ws) {
                ws.send(JSON.stringify({op:"error",args:["cancelall", userid, "Unauthorized"]}));
            }
            const canceled_orders = await cancelallorders(userid);
            const orderupdates = canceled_orders.map(orderid => [chainid,orderid,'c']);
            broadcastMessage(chainid, null, {op:"orderstatus",args:[orderupdates]});
            break
        case "requestquote":
            chainid = msg.args[0];
            market = msg.args[1];
            const side = msg.args[2];
            const baseQuantity = parseFloat(msg.args[3]);
            const quote = genquote(chainid, market, side, baseQuantity);
            const quoteMessage = {op:"quote",args:[chainid, market, side, baseQuantity.toString(), quote.softPrice]};
            if (ws) {
                ws.send(JSON.stringify(quoteMessage));
            } else {
                return quoteMessage;
            }
            break
        case "fillrequest":
            chainid = msg.args[0];
            orderId = msg.args[1];
            const fillOrder = msg.args[2];
            let blacklist = process.env.BLACKLIST || "";
            const blacklisted_accounts = blacklist.split(",");
            if (blacklisted_accounts.includes(fillOrder.accountId.toString())) {
                ws.send(JSON.stringify({op:"error",args:["fillrequest", "You're running a bad version of the market maker. Please run git pull to update your code."]}));
                return false;
            }

            try {
                const matchOrderResult = await matchorder(chainid, orderId, fillOrder);
                ws.send(JSON.stringify({op:"userordermatch",args:[chainid, orderId, matchOrderResult.zktx,fillOrder]}));
                broadcastMessage(chainid, null, {op:"orderstatus",args:[[[chainid,orderId,'m']]]});
                broadcastMessage(chainid, null, {op:"fills",args:[[matchOrderResult.fill]]});
            } catch (e) {
                console.error(e);
                ws.send(JSON.stringify({op:"error",args:["fillrequest", e.message]}));
            }
            break
        case "subscribemarket":
            chainid = msg.args[0];
            market = msg.args[1];
            if (!validMarkets[chainid][market]) {
                ws.send(JSON.stringify({"op":"error", args: ["invalid market"]}));
                return false;
            }
            const openorders = await getopenorders(chainid, market);
            const fills = await getfills(chainid, market);
            const lastprices = getLastPrices();
            try {
                const priceData = validMarkets[chainid][market].marketSummary.price;
                let volumes = validMarkets[chainid][market].volumes;
                if (!volumes) {
                    volumes = {
                        base: 0, 
                        quote: 0
                    }
                }
                const priceChange = parseFloat(priceData.change.absolute.toPrecision(6));
                const marketSummaryMsg = {op: 'marketsummary', args: [market, priceData.last, priceData.high, priceData.low, priceChange, volumes.base, volumes.quote]};
                ws.send(JSON.stringify(marketSummaryMsg));
            } catch (e) {
                console.error(e);
            }
            ws.send(JSON.stringify({"op":"lastprice", args: [lastprices]}));
            ws.send(JSON.stringify({"op":"orders", args: [openorders]}))
            ws.send(JSON.stringify({"op":"fills", args: [fills]}))
            if ( ([1,1000]).includes(chainid) ) {
                const liquidity = getLiquidity(chainid, market);
                ws.send(JSON.stringify({"op":"liquidity", args: [chainid, market, liquidity]}))
            }
            ws.chainid = chainid;
            ws.marketSubscriptions.push(market);
            break
        case "unsubscribemarket":
            chainid = msg.args[0];
            market = msg.args[1];
            if (ws.chainid != chainid) ws.marketSubscriptions = [];
            ws.marketSubscriptions = ws.marketSubscriptions.filter(m => m !== market);
            break
        case "orderstatusupdate":
            const updates = msg.args[0];
            const orderUpdates = [];
            const fillUpdates = [];
            for (let i in updates) {
                const update = updates[i];
                const chainid = update[0];
                const orderId = update[1];
                const newstatus = update[2];
                let success, fillId;
                if (newstatus == 'b') {
                    const txhash = update[3];
                    const result = await updateMatchedOrder(chainid, orderId, newstatus, txhash);
                    success = result.success;
                    fillId = result.fillId;
                }
                if (newstatus == 'r' || newstatus == 'f') {
                    const txhash = update[3];
                    const result = await updateOrderFillStatus(chainid, orderId, newstatus);
                    success = result.success;
                    fillId = result.fillId;
                }
                if (success) {
                    orderUpdates.push(update);
                    const fillUpdate = [...update];
                    fillUpdate[1] = fillId;
                    fillUpdates.push(fillUpdate);
                }
            }
            if (orderUpdates.length > 0) {
                broadcastMessage(chainid, null, {op:"orderstatus",args: [orderUpdates]});
            }
            if (fillUpdates.length > 0) {
                broadcastMessage(chainid, null, {op:"fillstatus",args: [fillUpdates]});
            }
        default:
            break
    }
}

async function updateOrderFillStatus(chainid, orderid, newstatus) {
    if (chainid == 1001) throw new Error("Not for Starknet orders");

    let update, fillId;
    try {
        const values = [newstatus,chainid, orderid];
        update = await pool.query("UPDATE offers SET order_status=$1 WHERE chainid=$2 AND id=$3 AND order_status IN ('b', 'm')", values);
        const update2 = await pool.query("UPDATE fills SET fill_status=$1 WHERE taker_offer_id=$3 AND chainid=$2 AND fill_status IN ('b', 'm') RETURNING id", values);
        if (update2.rows.length > 0) {
            fillId = update2.rows[0].id;
        }
    }
    catch (e) {
        console.error("Error while updating fill status");
        console.error(e);
        return false;
    }
    return { success: update.rowCount > 0, fillId };
}

async function updateMatchedOrder(chainid, orderid, newstatus, txhash) {
    let update, fillId;
    try {
        let values = [newstatus,chainid, orderid];
        update = await pool.query("UPDATE offers SET order_status=$1 WHERE chainid=$2 AND id=$3 AND order_status='m'", values);
        values = [newstatus,txhash,chainid, orderid];
        const update2 = await pool.query("UPDATE fills SET fill_status=$1, txhash=$2 WHERE taker_offer_id=$4 AND chainid=$3 RETURNING id", values);
        if (update2.rows.length > 0) {
            fillId = update2.rows[0].id;
        }
    }
    catch (e) {
        console.error("Error while updating matched order");
        console.error(e);
        return false;
    }
    return { success: update.rowCount > 0, fillId };
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
    broadcastMessage(chainid, market, {"op":"orders", args: [[orderreceipt]]});
    try {
        user_connections[chainid][user].send(JSON.stringify({"op":"userorderack", args: [orderreceipt]}));
    } catch (e) {
        // user connection doesn't exist. just pass along
    }

    return orderreceipt;
}

async function processorderstarknet(chainid, zktx) {
    for (let i in zktx) {
        if (typeof zktx[i] !== "string") throw new Error("All order arguments must be cast to string");
    }
    const user = zktx[1];
    const baseCurrency = starknetContracts[zktx[2]];
    const quoteCurrency = starknetContracts[zktx[3]];
    const market = baseCurrency + "-" + quoteCurrency;
    if (zktx[4] != 1 && zktx[4] != 0) throw new Error("Invalid side");
    const side = zktx[4] == 0 ? 'b': 's';
    const base_quantity = zktx[5] / Math.pow(10, starknetAssets[baseCurrency].decimals);
    const price = (zktx[6] / zktx[7]) * 10**(starknetAssets[baseCurrency].decimals - starknetAssets[quoteCurrency].decimals);
    const quote_quantity = price*base_quantity;
    const expiration = zktx[8];
    const order_type = 'limit';

    const query = "SELECT * FROM match_limit_order($1, $2, $3, $4, $5, $6, $7)"
    let values = [chainid, user, market, side, price, base_quantity, JSON.stringify(zktx)];
    console.log(values);
    const matchquery = await pool.query(query, values);
    const fill_ids = matchquery.rows.slice(0, matchquery.rows.length-1).map(r => r.id);
    const offer_id = matchquery.rows[matchquery.rows.length-1].id;

    const fills = await pool.query("SELECT fills.*, maker_offer.unfilled AS maker_unfilled, maker_offer.zktx AS maker_zktx, maker_offer.side AS maker_side FROM fills JOIN offers AS maker_offer ON fills.maker_offer_id=maker_offer.id WHERE fills.id = ANY ($1)", [fill_ids]);
    console.log("fills", fills.rows);
    const offerquery = await pool.query("SELECT * FROM offers WHERE id = $1", [offer_id]);
    const offer = offerquery.rows[0];
    console.log("offer", offer);

    const orderupdates = [];
    const marketFills = [];
    fills.rows.forEach(row => { 
        if (row.maker_unfilled > 0)
            orderupdates.push([chainid,row.maker_offer_id,'pm', row.amount, row.maker_unfilled]);
        else
            orderupdates.push([chainid,row.maker_offer_id,'m']);
        marketFills.push([chainid,row.id,market,side,row.price,row.amount,row.fill_status,row.txhash,row.taker_user_id,row.maker_user_id]);

        let buyer, seller;
        if (row.maker_side == 'b') {
            buyer = row.maker_zktx;
            seller = offer.zktx;
        }
        else if (row.maker_side == 's') {
            buyer = offer.zktx;
            seller = row.maker_zktx;
        }
        relayStarknetMatch(JSON.parse(buyer), JSON.parse(seller), row.amount,row.price, row.id, row.maker_offer_id, offer.id);
    });
    const order = [chainid, offer.id, market, offer.side, offer.price, offer.base_quantity, offer.price*offer.base_quantity,offer.expires,offer.userid,offer.order_status,null,offer.unfilled];
    broadcastMessage(chainid, market, {"op":"orders", args:[[order]]});
    if (orderupdates.length > 0) broadcastMessage(chainid, market, {"op":"orderstatus", args:[orderupdates]});
    if (marketFills.length > 0) broadcastMessage(chainid, market, {"op":"fills", args:[marketFills]});
}

async function relayStarknetMatch(buyer, seller, fillQty, fillPrice, fillId, makerOfferId, takerOfferId) {
    const baseAssetDecimals = starknetAssets[starknetContracts[buyer[2]]].decimals;
    const quoteAssetDecimals = starknetAssets[starknetContracts[buyer[3]]].decimals;
    const decimalDifference = baseAssetDecimals - quoteAssetDecimals;
    const fillPriceRatio = ["1", (1 / fillPrice * 10**(decimalDifference)).toFixed(0)];
    fillQty = (fillQty * Math.pow(10, baseAssetDecimals)).toFixed(0);
    buyer[1] = BigInt(buyer[1]).toString();
    buyer[2] = BigInt(buyer[2]).toString();
    buyer[3] = BigInt(buyer[3]).toString();
    buyer[9] = BigInt(buyer[9]).toString();
    buyer[10] = BigInt(buyer[10]).toString();
    seller[1] = BigInt(seller[1]).toString();
    seller[2] = BigInt(seller[2]).toString();
    seller[3] = BigInt(seller[3]).toString();
    seller[9] = BigInt(seller[9]).toString();
    seller[10] = BigInt(seller[10]).toString();
    const calldata = [...buyer, ...seller, ...fillPriceRatio, fillQty];
    try {
        const transactionDetails = {
            type: "INVOKE_FUNCTION",
            contract_address: process.env.STARKNET_CONTRACT_ADDRESS,
            entry_point_selector: starknet.stark.getSelectorFromName("fill_order"),
            calldata
        }
        const relayResult = await starknet.defaultProvider.addTransaction(transactionDetails);
        console.log("Starknet tx success");
        const fillupdate = await pool.query("UPDATE fills SET fill_status='f', txhash=$1 WHERE id=$2 RETURNING id, fill_status, txhash", [relayResult.transaction_hash, fillId]);
        const orderupdate = await pool.query("UPDATE offers SET order_status=(CASE WHEN order_status='pm' THEN 'pf' ELSE 'f' END) WHERE id IN ($1, $2) RETURNING id, order_status", [makerOfferId, takerOfferId]);
        const chainid = parseInt(buyer[0]);
        const orderUpdates = orderupdate.rows.map(row => [chainid, row.id, row.order_status]);
        const fillUpdates = fillupdate.rows.map(row => [chainid, row.id, row.fill_status, row.txhash]);
        broadcastMessage(chainid, null, {"op":"orderstatus", args:[orderUpdates]});
        broadcastMessage(chainid, null, {"op":"fillstatus", args:[fillUpdates]});
    } catch (e) {
        console.error(e);
        console.error("Starknet tx failed");
        const orderupdate = await pool.query("UPDATE offers SET order_status='r' WHERE id IN ($1, $2) RETURNING id, order_status", [makerOfferId, takerOfferId]);
        const chainid = parseInt(buyer[0]);
        const orderUpdates = orderupdate.rows.map(row => [chainid, row.id, row.order_status]);
        broadcastMessage(chainid, null, {"op":"orderstatus", args:[orderUpdates]});
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
    const select = await pool.query("SELECT userid, price, base_quantity, market, zktx, side FROM offers WHERE id=$1 AND chainid=$2 AND order_status='o'", values);
    if (select.rows.length === 0) throw new Error("Order " + orderId + " is not open");
    const selectresult = select.rows[0];
    const zktx = JSON.parse(selectresult.zktx);

    const update1 = await pool.query("UPDATE offers SET order_status='m' WHERE id=$1 AND chainid=$2", values);

    values = [orderId, chainid, selectresult.market, selectresult.userid, selectresult.price, selectresult.base_quantity, selectresult.side];
    const update2 = await pool.query("INSERT INTO fills (chainid, market, taker_offer_id, taker_user_id, price, amount, side, fill_status) VALUES ($2, $3, $1, $4, $5, $6, $7, 'm') RETURNING id", values);
    const fill_id = update2.rows[0].id;
    const fill = [chainid, fill_id, selectresult.market, selectresult.side, selectresult.price, selectresult.base_quantity, 'm', null, selectresult.userid, null]; 

    return { zktx, fill };
}


async function broadcastMessage(chainid, market, msg) {
    console.log("num clients", wss.clients.size);
    wss.clients.forEach(ws => {
        if (ws.readyState !== WebSocket.OPEN) return true;
        if (chainid && ws.chainid !== chainid) return true;
        if (market && !ws.marketSubscriptions.includes(market)) return true;
        ws.send(JSON.stringify(msg));
    });
}

async function getopenorders(chainid, market) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,unfilled FROM offers WHERE market=$1 AND chainid=$2 AND unfilled > 0 AND order_status IN ('o', 'pm', 'pf')",
        values: [market, chainid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

async function getorder(chainid, orderid) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status,unfilled FROM offers WHERE chainid=$1 AND id=$2",
        values: [chainid, orderid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    if (select.rows.length == 0) throw new Error("Order not found")
    return select.rows[0];
}

async function getuserfills(chainid, userid) {
    const query = {
        text: "SELECT chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id FROM fills WHERE chainid=$1 AND (maker_user_id=$2 OR taker_user_id=$2) ORDER BY id DESC LIMIT 25",
        values: [chainid, userid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

async function getuserorders(chainid, userid) {
    const query = {
        text: "SELECT chainid,id,market,side,price,base_quantity,quote_quantity,expires,userid,order_status FROM offers WHERE chainid=$1 AND userid=$2 AND order_status IN ('o','pm','pf') ORDER BY id DESC LIMIT 25",
        values: [chainid, userid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

async function getfills(chainid, market) {
    const query = {
        text: "SELECT chainid,id,market,side,price,amount,fill_status,txhash,taker_user_id,maker_user_id FROM fills WHERE market=$1 AND chainid=$2 AND fill_status='f' ORDER BY id DESC LIMIT 5",
        values: [market, chainid],
        rowMode: 'array'
    }
    const select = await pool.query(query);
    return select.rows;
}

function getLiquidity(chainid, market) {
    const baseCurrency = market.split("-")[0];
    const quoteCurrency = market.split("-")[1];
    if (baseCurrency == "ETH" || baseCurrency == "WETH") {
        validMarkets[chainid][market].liquidity = [
            [43, 0.0008, 'd'],
            [50, 0.0015, 'd'],
            [17.5, 0.003, 'd'],
            [12.1, 0.005, 'd'],
            [5.2, 0.008, 'd'],
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
    else if (baseCurrency == "WBTC") {
        validMarkets[chainid][market].liquidity = [
            [2.6, 0.0008, 'd'],
            [3.4, 0.0015, 'd'],
            [1.25, 0.003, 'd'],
            [0.11, 0.005, 'd'],
            [0.12, 0.008, 'd'],
            [1.0847, 0.01, 'd'],
            [0.7023, 0.011, 'd'],
            [0.3452, 0.013, 'd'],
            [1.62, 0.02, 'd'],
            [0.19, 0.025, 'd'],
            [0.23, 0.039, 'd'],
            [1.02, 0.041, 'd'],
            [0.32, 0.049, 'd'],
            [0.07, 0.051, 'd'],
            [0.07, 0.052, 'd'],
            [0.13, 0.063, 'd'],
        ]
    }
    else if ((["FXS"]).includes(baseCurrency)) {
        validMarkets[chainid][market].liquidity = [
            [7000, 0.0014, 'd'],
            [6000, 0.0017, 'd'],
            [1800, 0.0024, 'd'],
            [1303, 0.0037, 'd'],
            [2900, 0.0043, 'd'],
            [1301, 0.0054, 'd'],
            [4000, 0.007, 'd'],
            [1590, 0.0073, 'd'],
            [5200, 0.0088, 'd'],
            [1900, 0.0095, 'd'],
            [1190, 0.0098, 'd'],
            [2900, 0.0109, 'd'],
            [2300, 0.0137, 'd'],
            [1020, 0.0161, 'd'],
            [1070, 0.0182, 'd'],
            [2130, 0.0193, 'd'],
        ]
    }
    else if ((["USDC","USDT","FRAX", "DAI"]).includes(baseCurrency)) {
        validMarkets[chainid][market].liquidity = [
            [110000, 0.0004, 'd'],
            [170000, 0.0007, 'd'],
            [18000, 0.0014, 'd'],
            [13030, 0.0017, 'd'],
            [29000, 0.0023, 'd'],
            [13010, 0.0024, 'd'],
            [14000, 0.03, 'd'],
            [11590, 0.0033, 'd'],
            [25200, 0.0038, 'd'],
            [1900, 0.0045, 'd'],
            [11900, 0.0048, 'd'],
            [2900, 0.0049, 'd'],
            [12300, 0.0057, 'd'],
            [1020, 0.0061, 'd'],
            [21070, 0.0082, 'd'],
            [2130, 0.0093, 'd'],
        ]
    }
    else {
        validMarkets[chainid][market].liquidity = [];
    }
    return validMarkets[chainid][market].liquidity;
}

async function cryptowatchWsSetup() {
    const cryptowatch_market_ids = {
        579: "WBTC-USDT",
        6630: "WBTC-USDC",
        63532: "WBTC-DAI",
        588: "ETH-USDT",
        6631: "ETH-USDC",
        63533: "ETH-DAI",
        580: "ETH-BTC",
        6636: "USDC-USDT",
        297241: "FXS-FRAX",
        63349: "DAI-USDT",
        61485: "DAI-USDC",
    }

    const subscriptionMsg = {
      "subscribe": {
        "subscriptions": []
      }
    }
    for (let market_id in cryptowatch_market_ids) {
          subscriptionMsg.subscribe.subscriptions.push({
            "streamSubscription": {
              "resource": `markets:${market_id}:trades`
            }
          })
    }
    let cryptowatch_ws = new WebSocket("wss://stream.cryptowat.ch/connect?apikey=" + process.env.CRYPTOWATCH_API_KEY);
    cryptowatch_ws.on('open', onopen);
    cryptowatch_ws.on('message', onmessage);
    cryptowatch_ws.on('close', onclose);
    function onopen() {
        cryptowatch_ws.send(JSON.stringify(subscriptionMsg));
    }
    function onmessage (data) {
        const msg = JSON.parse(data);
        if (!msg.marketUpdate) return;

        let market = cryptowatch_market_ids[msg.marketUpdate.market.marketId];
        let trades = msg.marketUpdate.tradesUpdate.trades;
        let price = parseFloat(trades[trades.length - 1].priceStr).toPrecision(6) / 1;
        for (let chain in validMarkets) {
            if (market in validMarkets[chain]) {
                validMarkets[chain][market].marketSummary.price.last = price;
            }
        }
    };
    function onclose () {
        setTimeout(cryptowatchWsSetup, 5000);
    }
}


async function updateMarketSummaries() {
    const productUpdates = {};
    for (let chain in validMarkets) {
        for (let product in validMarkets[chain]) {
            let cryptowatch_product = product;
            const baseCurrency = product.split("-")[0];
            const quoteCurrency = product.split("-")[1];
            if (productUpdates[product]) {
                validMarkets[chain][product].marketSummary = productUpdates[product];
            }
            else if (product === "FRAX-USDC" || product === "WETH-ETH") {
                validMarkets[chain][product].marketSummary = {
                  price: {
                    last: 1.0000,
                    high: 1.001,
                    low: 0.999,
                    change: { percentage: 0, absolute: 0 }
                  },
                }
            }
            else {
                const cryptowatch_market = cryptowatch_product.replace("-", "").replace("WBTC", "BTC").toLowerCase();
                let exchange = "binance";
                if (product === "DAI-USDC") {
                    exchange = "coinbase-pro";
                }
                else if (product === "DAI-USDT") {
                    exchange = "ftx";
                }
                else if (product === "FXS-FRAX") {
                    exchange = "uniswap-v2"
                }
                const headers = { 'X-CW-API-Key': process.env.CRYPTOWATCH_API_KEY };
                const url = `https://api.cryptowat.ch/markets/${exchange}/${cryptowatch_market}/summary`;
                try {
                    const r = await fetch(url, { headers });
                    const data = await r.json();
                    if (product == "FXS-FRAX") {
                        data.result.price.last = data.result.price.last.toPrecision(6);
                        data.result.price.high = data.result.price.high.toPrecision(6);
                        data.result.price.low = data.result.price.low.toPrecision(6);
                    }
                    validMarkets[chain][product].marketSummary = data.result;
                    productUpdates[product] = data.result;
                } catch (e) {
                    console.error(product, e);
                    console.error("Cryptowatch API request failed");
                }
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
        try {
            const price = validMarkets[row.chainid][row.market].marketSummary.price.last;
            const quoteVolume = parseFloat((row.base_volume * price).toPrecision(6))
            validMarkets[row.chainid][row.market].volumes = {
                base: parseFloat(row.base_volume.toPrecision(6)),
                quote: quoteVolume,
            };
        }
        catch (e) {
            console.log("Could not update volumes");
        }
    })
    return true;
}

async function updatePendingOrders() {
    const one_min_ago = new Date(Date.now() - 60*1000).toISOString();
    const query = {
        text: "UPDATE offers SET order_status='c' WHERE (order_status IN ('m', 'b', 'pm') AND insert_timestamp < $1) OR (order_status='o' AND unfilled = 0) RETURNING chainid, id, order_status;",
        values: [one_min_ago]
    }
    const update = await pool.query(query);
    if (update.rowCount > 0) {
        const orderUpdates = update.rows.map(row => [row.chainid, row.id, row.order_status]);
        broadcastMessage(null, null, {"op":"orderstatus", args: [orderUpdates]});
    }
    const fillsQuery = {
        text: "UPDATE fills SET fill_status='e' WHERE (order_status IN ('m', 'b', 'pm') AND insert_timestamp < $1) RETURNING chainid, id, order_status;",
        values: [one_min_ago]
    }
    const updateFills = await pool.query(query);
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
                    console.error(e);
                    console.log("Couldn't update price. Ignoring");
                }
            }
        }
    }
    return lastprices;
}

function genquote(chainid, market, side, baseQuantity) {
    if (!([1,1000]).includes(chainid)) throw new Error("Quotes not supported for this chain");

    const lastPrice = validMarkets[chainid][market].marketSummary.price.last;
    let SOFT_SPREAD, HARD_SPREAD;
    const baseCurrency = market.split("-")[0];
    const quoteCurrency = market.split("-")[1];
    if ((["USDC", "USDT", "FRAX", "DAI"]).includes(baseCurrency)) {
        SOFT_SPREAD = 0.0006;
        HARD_SPREAD = 0.0003;
    }
    else {
        SOFT_SPREAD = 0.001;
        HARD_SPREAD = 0.0005;
    }
    let softQuoteQuantity, hardQuoteQuantity;
    if (side === 'b') {
        softQuoteQuantity = (baseQuantity * lastPrice * (1 + SOFT_SPREAD)) + gasFees[quoteCurrency];
        hardQuoteQuantity = (baseQuantity * lastPrice * (1 + HARD_SPREAD)) + gasFees[quoteCurrency];
    }
    if (side === 's') {
        softQuoteQuantity = (baseQuantity - gasFees[baseCurrency]) * lastPrice * (1 - SOFT_SPREAD);
        hardQuoteQuantity = (baseQuantity - gasFees[baseCurrency]) * lastPrice * (1 - HARD_SPREAD);
    }
    const softPrice = (softQuoteQuantity / baseQuantity).toPrecision(6);
    const hardPrice = (hardQuoteQuantity / baseQuantity).toPrecision(6);;
    return { softPrice, hardPrice };
}

function sendLastPriceData (ws) {
    const lastprices = getLastPrices();
    ws.send(JSON.stringify({op:"lastprice", args: [lastprices]}));
}

function clearDeadConnections () {
    wss.clients.forEach((ws,i) => {
        if (!ws.isAlive) {
            ws.terminate();
        }
        else {
            ws.isAlive = false;
            ws.ping();
        }
    });
}
