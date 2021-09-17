import WebSocket, { WebSocketServer } from 'ws';
import pg from 'pg';

const pool = new pg.Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'zigzag',
  password: 'postgres',
  port: 5432,
})

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
            const query = "INSERT INTO orders(user, market, price, quantity, order_type, expires) VALUES($1, $2, $3, $4, $5, $6) RETURNING id";
            const orderargs = msg.args;
            const res = await pool.query(query, orderargs);
            const id = res.rows[0].id;
            orderargs.push(id)
            const resp = {"op": "orderack", "args": orderargs}
            // save order to DB
            break
        case "subscribe_l2":
            // respond with market data
            break
        default:
            break
    }
}
