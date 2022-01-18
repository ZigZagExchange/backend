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
import Joi from 'joi';


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

const redis_url = process.env.REDIS_URL;
const redis_use_tls = redis_url.includes("rediss");
const redis = Redis.createClient({ 
    url: redis_url,
    socket: {
        tls: redis_use_tls,
        rejectUnauthorized: false
    },
});
redis.on('error', (err) => console.log('Redis Client Error', err));
await redis.connect();


// Schema Validations
const zksyncOrderSchema = Joi.object({
    accountId: Joi.number().integer().required(),
    recipient: Joi.string().required(),
    nonce: Joi.number().integer().required(),
    amount: Joi.string().required(),
    tokenSell: Joi.number().integer().required(),
    tokenBuy: Joi.number().integer().required(),
    validFrom: Joi.number().required(),
    validUntil: Joi.number().min(Date.now() / 1000 | 0).max(2000000000).required(),
    ratio: Joi.array().items(Joi.string()).length(2).required(),
    signature: Joi.object().required().keys({
        pubKey: Joi.string().required(),
        signature: Joi.string().required()
    }),
    ethSignature: Joi.any(),
});

// Globals
const USER_CONNECTIONS = {}
const VALID_CHAINS = [1,1000,1001];
const V1_TOKEN_IDS = {
    0: 'ETH',
    1: 'DAI',
    2: 'USDC',
    4: 'USDT',
    15: 'WBTC',
    61: 'WETH',
    92: 'FRAX',
}
const V1_MARKETS = [
    "ETH-USDT",
    "ETH-USDC",
    "ETH-DAI",
    "ETH-FRAX",
    "ETH-WBTC",
    "USDC-USDT",
    "DAI-USDT",
    "DAI-USDC",
    "WBTC-USDT",
    "WBTC-USDC",
    "WBTC-DAI",
]

await updateVolumes();
setInterval(clearDeadConnections, 60000);
setInterval(updateVolumes, 120000);
setInterval(updatePendingOrders, 60000);
setInterval(broadcastLiquidity, 5000);

const expressApp = express();
expressApp.use(express.json());
expressApp.post("/", async function (req, res) {
    const httpMessages = ["requestquote", "submitorder", "orderreceiptreq"];
    if (req.headers['content-type'] != "application/json") {
        res.json({ op: "error", args: ["Content-Type header must be set to application/json"] });
        return
    }
    console.log('Received: %s', JSON.stringify(req.body));
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
wss.on('error', console.error);

server.on('upgrade', function upgrade(request, socket, head) {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit('connection', ws, request);
    });
});

server.listen(port);
    
async function onWsConnection(ws, req) {
    ws.uuid = randomUUID();
    console.log("New connection: ", req.connection.remoteAddress);
    ws.isAlive = true;
    ws.marketSubscriptions = [];
    ws.chainid = 1; // subscribe to zksync mainnet by default
    ws.userid = null;

    const lastprices = await getLastPrices(1);
    ws.send(JSON.stringify({op:"lastprice", args: [lastprices]}));
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    ws.on('message', function incoming(json) {
        const msg = JSON.parse(json);
        if (msg.op != 'indicateliq2') {
            console.log('Received: %s', json);
        }
        handleMessage(msg, ws);
    });
    ws.on('error', console.error);
}

async function handleMessage(msg, ws) {
    let orderId, zktx, userid, chainid, market, userconnkey, liquidity;
    switch (msg.op) {
        case "login":
            chainid = msg.args[0];
            userid = msg.args[1];
            ws.chainid = chainid;
            ws.userid = userid;
            userconnkey = `${chainid}:${userid}`;
            USER_CONNECTIONS[userconnkey] = ws;
            const userorders = await getuserorders(chainid, userid);
            const userfills = await getuserfills(chainid, userid);
            ws.send(JSON.stringify({"op":"orders", args: [userorders]}))
            ws.send(JSON.stringify({"op":"fills", args: [userfills]}))
            break
        case "orderreceiptreq":
            chainid = msg.args[0];
            orderId = msg.args[1];
            try {
                const orderreceipt = await getorder(chainid, orderId);
                const msg = { "op": "orderreceipt", args: orderreceipt }
                if (ws) ws.send(JSON.stringify(msg));
                return orderreceipt;
            } catch (e) {
                const errorMsg = { "op": "error", args: [msg.op, e.message] }
                if (ws) ws.send(JSON.stringify(errorMsg));
                return errorMsg;
            }
            break
        case "indicateliq2":
            chainid = msg.args[0];
            market = msg.args[1];
            liquidity = msg.args[2];
            updateLiquidity(chainid, market, liquidity);
            break
        case "submitorder":
            chainid = msg.args[0];
            zktx = msg.args[1];
            if (chainid !== 1) {
                const errorMsg = { op: "error", args: ["submitorder", "v1 orders only supported on mainnet. upgrade to v2 orders"] };
                if (ws) ws.send(JSON.stringify(errorMsg));
                return errorMsg;
            }
            const tokenBuy = V1_TOKEN_IDS[zktx.tokenBuy];
            const tokenSell = V1_TOKEN_IDS[zktx.tokenSell];
            if (V1_MARKETS.includes(tokenBuy + "-" + tokenSell)) {
                market = tokenBuy + "-" + tokenSell;
            } 
            else if (V1_MARKETS.includes(tokenSell + "-" + tokenBuy)) {
                market = tokenSell + "-" + tokenBuy;
            } 
            else {
                const errorMsg = { op: "error", args: ["submitorder", "invalid market"] };
                if (ws) ws.send(JSON.stringify(errorMsg));
                return errorMsg;
            }
            return await processorderzksync(chainid, market, zktx);
            break
        case "submitorder2":
            chainid = msg.args[0];
            market = msg.args[1];
            zktx = msg.args[2];
            if (chainid == 1 || chainid == 1000) {
                try {
                    return await processorderzksync(chainid, market, zktx);
                }
                catch(e) {
                    console.error(e);
                    const errorMsg = {"op":"error", args: ["submitorder", e.message]};
                    if (ws) ws.send(JSON.stringify(errorMsg));
                    return errorMsg;
                }
            }
            else if (chainid === 1001) {
                try {
                    return await processorderstarknet(chainid, market, zktx);
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
                cancelresult = await cancelorder(chainid, orderId, ws);
            }
            catch (e) {
                ws.send(JSON.stringify({op:"error",args:["cancelorder",orderId, e.message]}));
                break
            }
            broadcastMessage(chainid, cancelresult.market, {op:"orderstatus",args:[[[chainid, orderId, 'c']]]});
            break
        case "cancelall":
            chainid = msg.args[0];
            userid = msg.args[1];
            userconnkey = `${chainid}:${userid}`;
            if (USER_CONNECTIONS[userconnkey] != ws) {
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
            let baseQuantity = null, quoteQuantity = null;
            if (msg.args[3]) {
                baseQuantity = parseFloat(msg.args[3]);
            }
            if (msg.args[4]) {
                quoteQuantity = parseFloat(msg.args[4]);
            }
            let quoteMessage;
            try {
                const quote = await genquote(chainid, market, side, baseQuantity, quoteQuantity);
                quoteMessage = {op:"quote",args:[chainid, market, side, quote.softBaseQuantity.toPrecision(8), quote.softPrice,quote.softQuoteQuantity.toPrecision(8)]};
            } catch (e) {
                quoteMessage = {op:"error",args:["requestquote", e.message]};
            }
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
                const market = matchOrderResult.fill[2];
                ws.send(JSON.stringify({op:"userordermatch",args:[chainid, orderId, matchOrderResult.zktx,fillOrder]}));
                broadcastMessage(chainid, market, {op:"orderstatus",args:[[[chainid,orderId,'m']]]});
                broadcastMessage(chainid, market, {op:"fills",args:[[matchOrderResult.fill]]});
            } catch (e) {
                console.error(e);
                ws.send(JSON.stringify({op:"error",args:["fillrequest", e.message]}));
            }
            break
        case "subscribemarket":
            chainid = msg.args[0];
            market = msg.args[1];
            const openorders = await getopenorders(chainid, market);
            const fills = await getfills(chainid, market);
            const lastprices = await getLastPrices(chainid);
            try {
                const yesterday = new Date(Date.now() - 86400*1000).toISOString().slice(0,10);
                let lastprice;
                try {
                    lastprice = lastprices.find(l => l[0] === market)[1];
                } catch (e) {
                    console.error("No price found for " + market);
                    lastprice = 0;
                }
                const baseVolume = await redis.get(`volume:${chainid}:${market}:base`);
                const quoteVolume = await redis.get(`volume:${chainid}:${market}:quote`);
                const yesterdayPrice = await redis.get(`dailyprice:${chainid}:${market}:${yesterday}`);
                const priceChange = lastprice - yesterdayPrice;
                const hi24 = Math.max(lastprice, yesterdayPrice);
                const lo24 = Math.min(lastprice, yesterdayPrice);
                const marketSummaryMsg = {op: 'marketsummary', args: [market, lastprice, hi24, lo24, priceChange, baseVolume, quoteVolume]};
                ws.send(JSON.stringify(marketSummaryMsg));
                const marketinfo = await getMarketInfo(market, chainid);
                const marketInfoMsg = {op: 'marketinfo', args: [marketinfo]};
                ws.send(JSON.stringify(marketInfoMsg));
            } catch (e) {
                console.error(e);
            }
            ws.send(JSON.stringify({"op":"lastprice", args: [lastprices]}));
            ws.send(JSON.stringify({"op":"orders", args: [openorders]}))
            ws.send(JSON.stringify({"op":"fills", args: [fills]}))
            if ( ([1,1000]).includes(chainid) ) {
                const liquidity = await getLiquidity(chainid, market);
                ws.send(JSON.stringify({"op":"liquidity2", args: [chainid, market, liquidity]}))
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
            for (let i in updates) {
                const update = updates[i];
                const chainid = update[0];
                const orderId = update[1];
                const newstatus = update[2];
                let success, fillId, market, lastprice;
                if (newstatus == 'b') {
                    const txhash = update[3];
                    const result = await updateMatchedOrder(chainid, orderId, newstatus, txhash);
                    success = result.success;
                    fillId = result.fillId;
                    market = result.market;
                }
                if (newstatus == 'r' || newstatus == 'f') {
                    const txhash = update[3];
                    const result = await updateOrderFillStatus(chainid, orderId, newstatus);
                    success = result.success;
                    fillId = result.fillId;
                    market = result.market;
                    lastprice = result.fillPriceWithoutFee;
                }
                if (success) {
                    const fillUpdate = [...update];
                    fillUpdate[1] = fillId;
                    broadcastMessage(chainid, market, {op:"orderstatus",args: [[update]]});
                    broadcastMessage(chainid, market, {op:"fillstatus",args: [[fillUpdate]]});
                }
                if (success && newstatus == 'f') {
                    const yesterday = new Date(Date.now() - 86400*1000).toISOString().slice(0,10);
                    const yesterdayPrice = await redis.get(`dailyprice:${chainid}:${market}:${yesterday}`);
                    const priceChange = (lastprice - yesterdayPrice).toString();
                    broadcastMessage(chainid, null, {op:"lastprice",args: [[[market, lastprice, priceChange]]]});
                }
            }
        default:
            break
    }
}

async function updateOrderFillStatus(chainid, orderid, newstatus) {
    if (chainid == 1001) throw new Error("Not for Starknet orders");

    let update, fillId, market, fillPrice, base_quantity, quote_quantity, side;
    try {
        const values = [newstatus,chainid, orderid];
        update = await pool.query("UPDATE offers SET order_status=$1 WHERE chainid=$2 AND id=$3 AND order_status IN ('b', 'm') RETURNING side, market", values);
        if (update.rows.length > 0) {
            side = update.rows[0].side;
            market = update.rows[0].market;
        }
        const update2 = await pool.query("UPDATE fills SET fill_status=$1 WHERE taker_offer_id=$3 AND chainid=$2 AND fill_status IN ('b', 'm') RETURNING id, market, price, amount", values);
        if (update2.rows.length > 0) {
            fillId = update2.rows[0].id;
            fillPrice = update2.rows[0].price;
            base_quantity = update2.rows[0].amount;
        }
        quote_quantity = base_quantity * fillPrice;
    }
    catch (e) {
        console.error("Error while updating fill status");
        console.error(e);
        return false;
    }

    const marketInfo = await getMarketInfo(market, chainid);
    let fillPriceWithoutFee;
    if (side === 's') {
        const baseQuantityWithoutFee = base_quantity - marketInfo.baseFee;
        fillPriceWithoutFee = (quote_quantity / baseQuantityWithoutFee).toFixed(marketInfo.pricePrecisionDecimals);;
    }
    else if (side === 'b') {
        const quoteQuantityWithoutFee = quote_quantity - marketInfo.quoteFee;
        fillPriceWithoutFee = (quoteQuantityWithoutFee / base_quantity).toFixed(marketInfo.pricePrecisionDecimals);
    }

    const success = update.rowCount > 0;
    if (success && (['f', 'pf']).includes(newstatus)) {
        const today = new Date().toISOString().slice(0,10);
        const redis_key_today_price = `dailyprice:${chainid}:${market}:${today}`;
        redis.HSET(`lastprices:${chainid}`, market, fillPriceWithoutFee);
        redis.SADD(`markets:${chainid}`, market);
        redis.SET(redis_key_today_price, fillPriceWithoutFee);
    }
    return { success, fillId, market, fillPrice, fillPriceWithoutFee };
}

async function updateMatchedOrder(chainid, orderid, newstatus, txhash) {
    let update, fillId, market;
    try {
        let values = [newstatus,chainid, orderid];
        update = await pool.query("UPDATE offers SET order_status=$1 WHERE chainid=$2 AND id=$3 AND order_status='m'", values);
        values = [newstatus,txhash,chainid, orderid];
        const rediskey = `order:${orderid}:txhash`
        redis.set(rediskey, txhash);
        const update2 = await pool.query("UPDATE fills SET fill_status=$1, txhash=$2 WHERE taker_offer_id=$4 AND chainid=$3 RETURNING id, market", values);
        if (update2.rows.length > 0) {
            fillId = update2.rows[0].id;
            market = update2.rows[0].market;
        }
    }
    catch (e) {
        console.error("Error while updating matched order");
        console.error(e);
        return false;
    }
    return { success: update.rowCount > 0, fillId, market };
}

async function processorderzksync(chainid, market, zktx) {
    const inputValidation = zksyncOrderSchema.validate(zktx);
    if (inputValidation.error) throw new Error(inputValidation.error);

    const marketInfo = await getMarketInfo(market, chainid);
    let side, base_token, quote_token, base_quantity, quote_quantity, price;
    if (zktx.tokenSell === marketInfo.baseAssetId && zktx.tokenBuy == marketInfo.quoteAssetId) {
        side = 's';
        price = ( zktx.ratio[1] / Math.pow(10, marketInfo.quoteAsset.decimals) ) / 
                ( zktx.ratio[0] / Math.pow(10, marketInfo.baseAsset.decimals) );
        base_quantity = zktx.amount / Math.pow(10, marketInfo.baseAsset.decimals);
        quote_quantity = base_quantity * price;
    }
    else if (zktx.tokenSell === marketInfo.quoteAssetId && zktx.tokenBuy == marketInfo.baseAssetId) {
        side = 'b'
        price = ( zktx.ratio[0] / Math.pow(10, marketInfo.quoteAsset.decimals) ) / 
                ( zktx.ratio[1] / Math.pow(10, marketInfo.baseAsset.decimals) );
        quote_quantity = zktx.amount / Math.pow(10, marketInfo.quoteAsset.decimals);
        const base_quantity_decimals = Math.min(marketInfo.baseAsset.decimals, 10);
        base_quantity = ((quote_quantity / price).toFixed(marketInfo.baseAsset.decimals)) / 1;
    }
    else {
        throw new Error("Buy/sell tokens do not match market");
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
        const userconnkey = `${chainid}:${userid}`;
        USER_CONNECTIONS[userconnkey].send(JSON.stringify({"op":"userorderack", args: [orderreceipt]}));
    } catch (e) {
        // user connection doesn't exist. just pass along
    }

    return orderreceipt;
}

async function processorderstarknet(chainid, market, zktx) {
    for (let i in zktx) {
        if (typeof zktx[i] !== "string") throw new Error("All order arguments must be cast to string");
    }
    const user = zktx[1];
    const baseCurrency = starknetContracts[zktx[2]];
    const quoteCurrency = starknetContracts[zktx[3]];
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
    const baseCurrency = starknetContracts[buyer[2]];
    const quoteCurrency = starknetContracts[buyer[3]];
    const baseAssetDecimals = starknetAssets[baseCurrency].decimals;
    const quoteAssetDecimals = starknetAssets[quoteCurrency].decimals;
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
        const market = baseCurrency + "-" + quoteCurrency;
        broadcastMessage(chainid, market, {"op":"orderstatus", args:[orderUpdates]});
        broadcastMessage(chainid, market, {"op":"fillstatus", args:[fillUpdates]});
    } catch (e) {
        console.error(e);
        console.error("Starknet tx failed");
        const orderupdate = await pool.query("UPDATE offers SET order_status='r' WHERE id IN ($1, $2) RETURNING id, order_status", [makerOfferId, takerOfferId]);
        const chainid = parseInt(buyer[0]);
        const orderUpdates = orderupdate.rows.map(row => [chainid, row.id, row.order_status]);
        const market = baseCurrency + "-" + quoteCurrency;
        broadcastMessage(chainid, market, {"op":"orderstatus", args:[orderUpdates]});
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
    const userconnkey = `${chainid}:${userid}`;
    if (USER_CONNECTIONS[userconnkey] != ws) {
        throw new Error("Unauthorized");
    }
    const updatevalues = [orderId];
    const update = await pool.query("UPDATE offers SET order_status='c' WHERE id=$1 RETURNING market", updatevalues);
    let market;
    if (update.rows.length > 0) {
        market = update.rows[0].market;
    }
    return { success: true, market };
}

async function matchorder(chainid, orderId, fillOrder) {
    let values = [orderId, chainid];
    const select = await pool.query("SELECT userid, price, base_quantity, quote_quantity, market, zktx, side FROM offers WHERE id=$1 AND chainid=$2 AND order_status='o'", values);
    if (select.rows.length === 0) throw new Error("Order " + orderId + " is not open");
    const selectresult = select.rows[0];
    const zktx = JSON.parse(selectresult.zktx);

    // Determine fill price
    const marketInfo = await getMarketInfo(selectresult.market, chainid);
    let baseQuantity, quoteQuantity;
    if (selectresult.side === 's') {
        baseQuantity = selectresult.base_quantity;
        quoteQuantity  = fillOrder.amount / 10**marketInfo.quoteAsset.decimals;
    }
    if (selectresult.side === 'b') {
        baseQuantity  = fillOrder.amount / 10**marketInfo.baseAsset.decimals;
        quoteQuantity = selectresult.quote_quantity;
    }
    const fillPrice = (quoteQuantity / baseQuantity).toFixed(marketInfo.pricePrecisionDecimals);


    const update1 = await pool.query("UPDATE offers SET order_status='m' WHERE id=$1 AND chainid=$2 AND order_status='o' RETURNING id", values);
    if (update1.rows.length === 0) throw new Error("Order " + orderId + " is not open");

    values = [orderId, chainid, selectresult.market, selectresult.userid, fillPrice, selectresult.base_quantity, selectresult.side];
    const update2 = await pool.query("INSERT INTO fills (chainid, market, taker_offer_id, taker_user_id, price, amount, side, fill_status) VALUES ($2, $3, $1, $4, $5, $6, $7, 'm') RETURNING id", values);
    const fill_id = update2.rows[0].id;
    const fill = [chainid, fill_id, selectresult.market, selectresult.side, fillPrice, selectresult.base_quantity, 'm', null, selectresult.userid, null]; 

    return { zktx, fill };
}


async function broadcastMessage(chainid, market, msg) {
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
    const order = select.rows[0];
    const rediskey = `order:${orderid}:txhash`;
    const txhash = await redis.get(rediskey);
    order.push(txhash);
    return order;
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

async function getLiquidity(chainid, market) {
    const redis_key_liquidity = `liquidity:${chainid}:${market}`
    let liquidity = await redis.ZRANGEBYSCORE(redis_key_liquidity, "0", "1000000");
    if (liquidity.length === 0) return [];

    liquidity = liquidity.map(JSON.parse);

    const now = Date.now() / 1000 | 0;
    const expired_values = liquidity.filter(l => l[3] < now).map(l => JSON.stringify(l));
    expired_values.forEach(v => redis.ZREM(redis_key_liquidity, v));
    const active_liquidity = liquidity.filter(l => l[3] > now);
    return active_liquidity;
}

async function updateVolumes() {
    const one_day_ago = new Date(Date.now() - 86400*1000).toISOString();
    const query = {
        text: "SELECT chainid, market, SUM(base_quantity) AS base_volume FROM offers WHERE order_status IN ('m', 'f', 'b') AND insert_timestamp > $1 AND chainid IS NOT NULL GROUP BY (chainid, market)",
        values: [one_day_ago]
    }
    const select = await pool.query(query);
    select.rows.forEach(async (row) => {
        try {
            const price = await redis.HGET(`lastprices:${row.chainid}`, row.market);
            const quoteVolume = (row.base_volume * price).toPrecision(6);
            const baseVolume = row.base_volume.toPrecision(6);
            const redis_key_base = `volume:${row.chainid}:${row.market}:base`;
            const redis_key_quote = `volume:${row.chainid}:${row.market}:quote`;
            redis.set(redis_key_base, baseVolume);
            redis.set(redis_key_quote, quoteVolume);
        }
        catch (e) {
            console.error(e);
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
        text: "UPDATE fills SET fill_status='e' WHERE fill_status IN ('m', 'b', 'pm') AND insert_timestamp < $1",
        values: [one_min_ago]
    }
    const updateFills = await pool.query(query);
    const expiredQuery = {
        text: "UPDATE offers SET order_status='e' WHERE order_status = 'o' AND expires < EXTRACT(EPOCH FROM NOW()) RETURNING chainid, id, order_status",
        values: []
    }
    const updateExpires = await pool.query(expiredQuery);
    if (updateExpires.rowCount > 0) {
        const orderUpdates = updateExpires.rows.map(row => [row.chainid, row.id, row.order_status]);
        broadcastMessage(null, null, {"op":"orderstatus", args: [orderUpdates]});
    }
    return true;
}

async function getLastPrices(chainid) {
    const lastprices = [];
    const redis_key_prices = `lastprices:${chainid}`;
    let redis_values = await redis.HGETALL(redis_key_prices);

    for (let market in redis_values) {
        const yesterday = new Date(Date.now() - 86400*1000).toISOString().slice(0,10);
        const yesterdayPrice = await redis.get(`dailyprice:${chainid}:${market}:${yesterday}`);
        const price = redis_values[market];
        const priceChange = price - yesterdayPrice;
        lastprices.push([market, price, priceChange]);
    }
    return lastprices;
}

async function genquote(chainid, market, side, baseQuantity, quoteQuantity) {
    if (baseQuantity && quoteQuantity) throw new Error("Only one of baseQuantity or quoteQuantity should be set");
    if (!([1,1000]).includes(chainid)) throw new Error("Quotes not supported for this chain");
    if (!(['b','s']).includes(side)) throw new Error("Invalid side");
    if (baseQuantity && baseQuantity <= 0) throw new Error("Quantity must be positive");
    if (quoteQuantity && quoteQuantity <= 0) throw new Error("Quantity must be positive");

    const marketInfo = await getMarketInfo(market, chainid);
    const liquidity = await getLiquidity(chainid, market);
    let softQuoteQuantity, hardQuoteQuantity, softBaseQuantity, hardBaseQuantity, softPrice, hardPrice;
    if (side === 'b' && baseQuantity) {
        if (baseQuantity < marketInfo.baseFee) throw new Error("Amount is inadequate to pay fee");
        const asks = liquidity.filter(l => l[0] === 's').map(l => l.slice(1,3));
        const ladderPrice = getQuoteFromLadder(asks, baseQuantity);
        hardBaseQuantity = baseQuantity
        hardQuoteQuantity = baseQuantity * ladderPrice + marketInfo.quoteFee
        hardPrice = (hardQuoteQuantity / baseQuantity).toFixed(marketInfo.pricePrecisionDecimals)
        softPrice = (hardPrice * 1.0005).toFixed(marketInfo.pricePrecisionDecimals)
        softBaseQuantity = baseQuantity
        softQuoteQuantity = baseQuantity * softPrice
    }
    if (side === 'b' && quoteQuantity) {
        if (quoteQuantity < marketInfo.quoteFee) throw new Error("Amount is inadequate to pay fee");
        const asks = liquidity.filter(l => l[0] === 's').map(l => [ l[1], l[1]*l[2] ]);
        const ladderPrice = getQuoteFromLadder(asks, quoteQuantity);
        console.log(ladderPrice);
        hardQuoteQuantity = quoteQuantity
        hardBaseQuantity = quoteQuantity / ladderPrice + marketInfo.baseFee
        hardPrice = hardQuoteQuantity / baseQuantity
        softPrice = hardPrice * 1.0005
        softQuoteQuantity = quoteQuantity
        softBaseQuantity = quoteQuantity / softPrice
    }
    if (side === 's' && baseQuantity) {
        if (baseQuantity < marketInfo.baseFee) throw new Error("Amount is inadequate to pay fee");
        const bids = liquidity.filter(l => l[0] === 's').map(l => l.slice(1,3)).reverse();
        const ladderPrice = getQuoteFromLadder(bids, baseQuantity);
        hardBaseQuantity = baseQuantity
        hardQuoteQuantity = baseQuantity * hardPrice + marketInfo.quoteFee
        hardPrice = (hardQuoteQuantity / baseQuantity).toFixed(marketInfo.pricePrecisionDecimals)
        softPrice = (hardPrice * 0.9995).toFixed(marketInfo.pricePrecisionDecimals)
        softBaseQuantity = baseQuantity
        softQuoteQuantity = baseQuantity * softPrice
    }
    if (side === 's' && quoteQuantity) {
        if (quoteQuantity < marketInfo.quoteFee) throw new Error("Amount is inadequate to pay fee");
        const bids = liquidity.filter(l => l[0] === 's').map(l => [ l[1], l[1]*l[2] ]).reverse();
        const ladderPrice = getQuoteFromLadder(bids, quoteQuantity);
        hardQuoteQuantity = quoteQuantity
        hardBaseQuantity = quoteQuantity / ladderPrice + marketInfo.baseFee
        hardPrice = hardQuoteQuantity / baseQuantity
        softPrice = ladderPrice * 0.9995
        softQuoteQuantity = quoteQuantity
        softBaseQuantity = quoteQuantity / softPrice
    }
    if (isNaN(softPrice)  || isNaN(hardPrice)) throw new Error("Internal Error. No price generated.");
    return { softPrice, hardPrice, softQuoteQuantity, hardQuoteQuantity, softBaseQuantity, hardBaseQuantity };
}

// Ladder has to be a sorted 2-D array contaning price and quantity
// Example: [ [3500,1], [3501,2] ]
function getQuoteFromLadder(ladder, qty) {
    let sum = 0, unfilledQuantity = qty;
    for (let i = 0; i < ladder.length; i--) {
        const askPrice = ladder[i][0];
        const askQuantity = ladder[i][1];
        if (askQuantity >= unfilledQuantity) {
            sum += unfilledQuantity * askPrice;
            unfilledQuantity = 0;
            break;
        }
        else {
            sum += askQuantity * askPrice;
            unfilledQuantity -= askQuantity;
        }
    }
    const avgPrice = sum / qty;
    return avgPrice;
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
    console.log("num clients", wss.clients.size);
}

async function broadcastLiquidity() {
    for (let i in VALID_CHAINS) {
        const chainid = VALID_CHAINS[i];
        const markets = await redis.SMEMBERS(`activemarkets:${chainid}`);
        if (!markets || markets.length === 0) continue;
        for (let j in markets) {
            const market_id = markets[j];
            const liquidity = await getLiquidity(chainid, market_id);
            broadcastMessage(chainid, market_id, {"op":"liquidity2", args: [chainid, market_id, liquidity]});
        }
    }
}

async function updateLiquidity (chainid, market, liquidity) {
    const expiration = (Date.now() / 1000 + 15) | 0;
    const marketInfo = await getMarketInfo(market, chainid);
    liquidity.forEach(l => l.push(expiration));
    const redis_members = liquidity.map(l => ({ score: l[1], value: JSON.stringify(l) }));
    redis.DEL(`liquidity:${chainid}:${market}`);
    redis.ZADD(`liquidity:${chainid}:${market}`, redis_members);
    redis.SADD(`activemarkets:${chainid}`, market)
}

const _MARKET_INFO = {}; // CACHE VARIABLE ONLY. DO NOT ACCESS DIRECTLY
async function getMarketInfo(market, chainid = null) {
    const marketkey = `${chainid}:${market}`;
    if (!_MARKET_INFO[marketkey]) {
        const url = `https://zigzag-markets.herokuapp.com/markets?id=${market}&chainid=${chainid}`;
        _MARKET_INFO[marketkey] = await fetch(url).then(r => r.json()).then(r => r[0]);
    }
    return _MARKET_INFO[marketkey];
}
