import WebSocket, { WebSocketServer } from 'ws';
const { Pool, Client } = require('pg')

const pool = new Pool({
  user: 'postgres',
  host: 'localhost'
  database: 'zigzag',
  password: 'postgres',
  port: 5432,
})

const wss = new WebSocketServer({
  port: 8080,
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

function verifySignature(){
    return true;
}

function handleMessage(msg, ws) {
    switch (msg.op) {
        case "ping":
            response = {"op": "pong"}
            ws.send(JSON.stringify(response))
            break
        case "login":
            const address = msg.args[0];
            const signature = msg.args[1];
            // verifySignature()
            user_connections[address] = ws;
            break
        case "order":
            const query = "INSERT INTO orders(user, market, price, quantity, order_type, expires) VALUES($1, $2, $3, $4, $5, $6) RETURNING id";
            const orderargs = msg.args;
            const res = await pool.query(query, orderargs);
            const id = res.rows[0].id;
            orderargs.push(id)
            const resp = {"op": "orderack", "args": orderargs}
            // save order to DB
            break
        case "orderbook":
            // respond with market data
            break
        default:
            break
    }
}
