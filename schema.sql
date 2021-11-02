CREATE TABLE IF NOT EXISTS orders (
    id SERIAL,
    userid TEXT,
    nonce INTEGER,
    market TEXT,
    side CHAR(1),
    price NUMERIC,
    base_quantity NUMERIC,
    quote_quantity NUMERIC,
    order_type TEXT,
    order_status TEXT,
    expires BIGINT,
    zktx TEXT, 
    txhash TEXT
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chainid INTEGER;
