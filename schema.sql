CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    user TEXT,
    market TEXT,
    price REAL,
    base_quantity REAL,
    quote_quantity REAL,
    order_type TEXT,
    expires INTEGER,
    zktx TEXT
)
