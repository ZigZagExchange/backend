import ethers from 'ethers';
import * as zksync from "zksync";
import WebSocket from 'ws';

/*
 *  This is a simple example how to send a single swap with zigzag - use this as a starting point to build upon.
 *  
 *  In the settings below you can set market, amount, side and your private ethereum key. This is only for a single trade.
 * 
 *  The basic flow is:  
 *      1. Subscripte to the market you want to trade on.
 *          { "op":"subscribemarket", "args":[chainId,market] }
 *          
 *      2. You will recive an ws message "op":"marketinfo". This has any needed details to your market.
 *          Here is the README with the exact content: https://github.com/ZigZagExchange/markets/blob/master/README.md
 * 
 *      3. Next you want to ask for an quote: (only set baseQuantity or quoteQuantity)
 *          { "op":"requestquote", "args": [chainid, market, side, baseQuantity, quoteQuantity] }
 * 
 *      4. You will recive an ws message "op":"quote" It contains following args: [chainid, market, side, baseQuantity, price, quoteQuantity]
 *          
 *      5. You can use that to build an zkSync order, see here: `async function sendOrder(quote)`
 *
 *      6. Last step is to send it like this: { "op":"submitorder2", "args": [chainId, market, zkOrder] }
 * 
 *  The last step returns an userorderack. You can use that to track the order. 
 *  Check out the README here to learn more: https://github.com/ZigZagExchange/backend/blob/master/README.md
 * 
*/


//Settings
const setting_zigzagChainId = 1000;
const setting_market = "ETH-USDC";
const setting_amount = 0.01;
const setting_side = 'b';
const ethereum_key = "xxxx";

// request the Quote after 5 sec to update MARKETS in time
setTimeout(
    requestQuote,
    5000
);


// globals
let ethWallet;
let syncWallet;
let account_state;
let syncProvider;
let MARKETS = {};


// Connect to zksync
const ETH_NETWORK = (setting_zigzagChainId === 1) ? "mainnet" : "rinkeby";
const ethersProvider = ethers.getDefaultProvider(ETH_NETWORK);
let ;
try {
    syncProvider = await zksync.getDefaultProvider(ETH_NETWORK);    
    ethWallet = new ethers.Wallet(ethereum_key);
    syncWallet = await zksync.Wallet.fromEthSigner(ethWallet, syncProvider);
    if (!(await syncWallet.isSigningKeySet())) {
        console.log("setting sign key");
        const signKeyResult = await syncWallet.setSigningKey({
            feeToken: "ETH",
            ethAuthType: "ECDSA",
        });
        console.log(signKeyResult);
    }
    account_state = await syncWallet.getAccountState();    
} catch (e) {
    console.log(e);
    throw new Error("Could not connect to zksync API");
}

const zigzagWsUrl = {
    1:    "wss://zigzag-exchange.herokuapp.com",
    1000: "wss://secret-thicket-93345.herokuapp.com"
}

let zigzagws = new WebSocket(zigzagWsUrl[setting_zigzagChainId]);
zigzagws.on(
    'open', 
    onWsOpen
);
zigzagws.on(
    'close',
    onWsClose
);
zigzagws.on(
    'error', 
    console.error
);

async function onWsOpen() {
    zigzagws.on(
        'message',
        handleMessage
    );
    zigzagws.send(
        JSON.stringify(
            {
                "op":"subscribemarket",
                "args":[setting_zigzagChainId, setting_market]
            }
        )
    );
}

function onWsClose () {
    console.log("Websocket closed..");
    setTimeout(() => {
        console.log("..Restarting:")
        zigzagws = new WebSocket(zigzagWsUrl[setting_zigzagChainId]);
        zigzagws.on('open', onWsOpen);
        zigzagws.on('close', onWsClose);
        zigzagws.on('error', onWsClose);
    }, 5000);
}

async function handleMessage(json) {
    const msg = JSON.parse(json);
    switch(msg.op) {
        case 'error':
            console.error(msg);
            break;
        case "marketinfo":
            const marketInfo = msg.args[0];
            const marketId  = marketInfo.alias;
            if(!marketId) break;
            MARKETS[marketId] = marketInfo;
            break;
        case 'quote':
            const quote = msg.args;
            sendOrder(quote);
            break;
        default:
            break;
    }
}

async function requestQuote() {
    const args = [
        setting_zigzagChainId,
        setting_market,
        setting_side,
        setting_amount
    ];
    zigzagws.send(
        JSON.stringify(
            { 
                "op":"requestquote",
                "args": args
            }
        )
    );
}

async function sendOrder(quote) {
    const chainId       = quote[0];
    const marketId      = quote[1];
    const side          = quote[2];
    const baseQuantity  = quote[3];
    const price         = quote[4];
    const quoteQuantity = quote[5];

    const marketInfo = MARKETS[marketId];
    if(!marketInfo) { return; }
    let tokenBuy, tokenSell, sellQuantity, tokenRatio = {}, fullSellQuantity;
    if (side === 'b') {
        sellQuantity = parseFloat(quoteQuantity);
        tokenSell = marketInfo.quoteAssetId;
        tokenBuy = marketInfo.baseAssetId;
        tokenRatio[marketInfo.baseAssetId] = baseQuantity;
        tokenRatio[marketInfo.quoteAssetId] = quoteQuantity;
        fullSellQuantity = (sellQuantity * 10**(marketInfo.quoteAsset.decimals)).toLocaleString('fullwide', {useGrouping: false })
    } else if (side === 's') {
        sellQuantity = parseFloat(baseQuantity);
        tokenSell = marketInfo.baseAssetId;
        tokenBuy = marketInfo.quoteAssetId;
        tokenRatio[marketInfo.baseAssetId] = baseQuantity;
        tokenRatio[marketInfo.quoteAssetId] = quoteQuantity;
        fullSellQuantity = (sellQuantity * 10**(marketInfo.baseAsset.decimals)).toLocaleString('fullwide', {useGrouping: false })
    }

    const now_unix = Date.now() / 1000 | 0;
    const validUntil = now_unix + 120;
    const sellQuantityBN = ethers.BigNumber.from(fullSellQuantity);
    const packedSellQuantity = zksync.utils.closestPackableTransactionAmount(sellQuantityBN);
    const order = await syncWallet.getOrder({
        tokenSell,
        tokenBuy,
        amount: packedSellQuantity.toString(),
        ratio: zksync.utils.tokenRatio(tokenRatio),
        validUntil
    });
    const args = [chainId, marketId, order];
    zigzagws.send(JSON.stringify({ "op":"submitorder2", "args": args }));
}