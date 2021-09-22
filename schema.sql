CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    user TEXT,
    nonce INTEGER,
    market TEXT,
    side TEXT,
    price REAL,
    base_quantity REAL,
    quote_quantity REAL,
    order_type TEXT,
    order_status TEXT,
    expires INTEGER,
    zktx TEXT, 
    txhash TEXT
)
