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
ALTER TABLE orders ADD COLUMN IF NOT EXISTS txhash INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS insert_timestamp TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS update_timestamp TIMESTAMPTZ;
