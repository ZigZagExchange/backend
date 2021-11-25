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
    zktx TEXT
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chainid INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS insert_timestamp TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS update_timestamp TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS txhash TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS unfilled NUMERIC;
ALTER TABLE orders DROP CONSTRAINT overflow_check;
ALTER TABLE orders ADD CONSTRAINT overflow_check CHECK (unfilled <= base_quantity);
ALTER TABLE orders DROP COLUMN IF EXISTS active;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS price_check;
ALTER TABLE orders ADD CONSTRAINT price_check CHECK (price > 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS base_quantity_positive;
ALTER TABLE orders ADD CONSTRAINT base_quantity_positive CHECK (base_quantity > 0);
ALTER TABLE orders DROP COLUMN IF EXISTS expires;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_price_insert_timestamp ON orders USING btree (price, insert_timestamp);

CREATE TABLE IF NOT EXISTS fills (
  id                 SERIAL,
  insert_timestamp   TIMESTAMPTZ     NOT NULL DEFAULT now(),
  chainid            INTEGER         NOT NULL,
  market             TEXT            NOT NULL,
  order_id           INTEGER         NOT NULL,
  maker_userid       TEXT            NOT NULL,
  taker_userid       TEXT            NOT NULL,
  price              NUMERIC(32, 16) NOT NULL CHECK (price > 0),
  amount             NUMERIC(32, 16) NOT NULL CHECK (amount > 0),
  maker_fee          NUMERIC(32, 16) NOT NULL DEFAULT 0.0,
  taker_fee          NUMERIC(32, 16) NOT NULL DEFAULT 0.0
) WITH (OIDS=FALSE);

CREATE INDEX IF NOT EXISTS idx_orders_market_insert_timestamp_maker_userid_taker_userid ON fills USING btree (market, insert_timestamp, maker_userid, taker_userid);



CREATE OR REPLACE FUNCTION block_crosses()
RETURNS trigger AS $function$
BEGIN
  IF NEW.side = 'b' AND NEW.price >= (SELECT price FROM orders WHERE market = NEW.market AND chainid  = NEW.chainid  AND side = 's' AND unfilled > 0.0 AND order_status='o' ORDER BY price ASC LIMIT 1) THEN
    RAISE EXCEPTION 'This order would result in a crossed book.';
    RETURN NULL;
  ELSIF NEW.side = 's' AND NEW.price <= (SELECT price FROM orders WHERE market = NEW.market AND chainid  = NEW.chainid  AND side = 'b' AND unfilled > 0.0 AND order_status='o' ORDER BY price DESC LIMIT 1) THEN
    RAISE EXCEPTION 'This order would result in a crossed book.';
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_order_block_crosses ON orders;
CREATE TRIGGER tr_order_block_crosses BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE PROCEDURE block_crosses();






CREATE OR REPLACE FUNCTION populate_unfilled() RETURNS trigger AS '
BEGIN
  NEW.unfilled := NEW.base_quantity;
  RETURN NEW;
END;
' LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_order_insert ON orders;
CREATE TRIGGER tr_order_insert BEFORE INSERT ON orders FOR EACH ROW EXECUTE PROCEDURE populate_unfilled();








-------------------------------------------------------------------
-- match_limit_order
--
-- Matches a limit order against orders in the book. Example usage:
-- SELECT match_limit_order(1001, '0xeae57ce9cc1984F202e15e038B964bb8bdF7229a', 'ETH-USDT', 'b', 4010.0, 0.5, 'fills', 'offer');
-- SELECT match_limit_order((SELECT id FROM users WHERE email = 'user-a@example.com' AND obsolete = FALSE), (SELECT id FROM markets WHERE base_symbol = 'BTC' AND quote_symbol = 'USD' AND obsolete = FALSE), 'sell', 4993.0, 0.5);
--
-- Notes: Currently lots of copied code in this and no tests yet.
-- Cursors containing resulting fills and order are not yet implemented.
-------------------------------------------------------------------

CREATE OR REPLACE FUNCTION match_limit_order(_chainid  INTEGER, _userid TEXT, _market TEXT, _side CHAR(1), _price NUMERIC, _amount NUMERIC, _fills REFCURSOR, _offer REFCURSOR)
  RETURNS SETOF REFCURSOR
  LANGUAGE plpgsql
AS $$
DECLARE
  match RECORD;
  amount_taken NUMERIC(32, 16);
  amount_remaining NUMERIC(32, 16);
BEGIN
  CREATE TEMPORARY TABLE tmp_fills (
    fill_id INTEGER,
    maker_order_id INTEGER,
    price NUMERIC(32, 16),
    fillQty NUMERIC(32, 16),
    remaining NUMERIC(32, 16)
  ) ON COMMIT DROP;
  CREATE TEMPORARY TABLE tmp_offer (
    order_id INTEGER,
    side CHAR(1),
    price NUMERIC(32, 16),
    amount NUMERIC(32, 16)
  ) ON COMMIT DROP;

  amount_remaining := _amount;

  -- take any orders that cross
  IF _side = 'b' THEN
    FOR match IN SELECT * FROM orders WHERE market = _market AND side = 's' AND price <= _price AND order_status='o' AND unfilled > 0 ORDER BY price ASC, insert_timestamp ASC LOOP
      -- RAISE NOTICE 'Found sell match %', match;
      IF amount_remaining > 0 THEN
        IF amount_remaining < match.unfilled THEN
          -- RAISE NOTICE '  amount_remaining % < match.unfilled % = this offer is NOT completely filled by this order', amount_remaining, match.unfilled;
          amount_taken := amount_remaining;
          amount_remaining := amount_remaining - amount_taken;
          UPDATE orders SET unfilled = unfilled - amount_taken WHERE id = match.id;
          WITH fill AS (INSERT INTO fills (chainid , market, order_id, maker_userid, taker_userid, price, amount) VALUES (_chainid , _market, match.id, match.userid, _userid, match.price, amount_taken) RETURNING id, match.id, match.price, amount_taken, match.unfilled) INSERT INTO tmp_fills SELECT * FROM fill;
          IF amount_remaining = 0 THEN
            -- RAISE NOTICE '  order complete';
            EXIT; -- exit loop
          END IF;
        ELSE
          -- RAISE NOTICE '  amount_remaining % >= match.unfilled % = this offer is completely filled by this order', amount_remaining, match.unfilled;
          amount_taken := match.unfilled;
          amount_remaining := amount_remaining - amount_taken;
          UPDATE orders SET unfilled = unfilled - amount_taken WHERE id = match.id;
          WITH fill AS (INSERT INTO fills (chainid , market, order_id, maker_userid, taker_userid, price, amount) VALUES (_chainid , _market, match.id, match.userid, _userid, match.price, amount_taken) RETURNING id, match.id, match.price, amount_taken, match.unfilled) INSERT INTO tmp_fills SELECT * FROM fill;
          IF amount_remaining = 0 THEN
            -- RAISE NOTICE '  order complete';
            EXIT; -- exit loop
          END IF;
        END IF;
      END IF; -- if amount_remaining > 0
    END LOOP;
  ELSE -- side is 's'
    FOR match IN SELECT * FROM orders WHERE chainid  = _chainid  AND market = _market AND side = 'b' AND price >= _price AND order_status = 'o' and unfilled > 0 ORDER BY price DESC, insert_timestamp ASC LOOP
      -- RAISE NOTICE 'Found buy match %', match;
      IF amount_remaining > 0 THEN
        IF amount_remaining < match.unfilled THEN
          -- RAISE NOTICE '  amount_remaining % < match.unfilled % = this offer isnt completely filled by this order', amount_remaining, match.unfilled;
          amount_taken := amount_remaining;
          amount_remaining := amount_remaining - amount_taken;
          UPDATE orders SET unfilled = unfilled - amount_taken WHERE id = match.id;
          WITH fill AS (INSERT INTO fills (chainid , market, order_id, maker_userid, taker_userid, price, amount) VALUES (_chainid , _market, match.id, match.userid, _userid, match.price, amount_taken) RETURNING id, match.id, match.price, amount_taken, match.unfilled) INSERT INTO tmp_fills SELECT * FROM fill;
          IF amount_remaining = 0 THEN
            -- RAISE NOTICE '  order complete';
                EXIT; -- exit loop
          END IF;
        ELSE
          -- RAISE NOTICE '  amount_remaining % >= match.unfilled % = this offer is NOT completely filled by this order', amount_remaining, match.unfilled;
          amount_taken := match.unfilled;
          amount_remaining := amount_remaining - amount_taken;
          UPDATE orders SET unfilled = unfilled - amount_taken WHERE id = match.id;
          WITH fill AS (INSERT INTO fills (chainid , market, order_id, maker_userid, taker_userid, price, amount) VALUES (_chainid , _market, match.id, match.userid, _userid, match.price, amount_taken) RETURNING id, match.id, match.price, amount_taken, match.unfilled) INSERT INTO tmp_fills SELECT * FROM fill;
          IF amount_remaining = 0 THEN
            -- RAISE NOTICE '  order complete';
            EXIT; -- exit loop
          END IF;
        END IF;
      END IF; -- if amount_remaining > 0
    END LOOP;
  END IF;

  -- create an offer for whatever remains
  IF amount_remaining > 0 THEN
    -- RAISE NOTICE 'INSERT INTO orders (userid, market, side, price, amount) VALUES (%, %, %, %, %);', _userid, _market, _side, _price, amount_remaining;
    WITH offer AS (INSERT INTO orders (chainid , userid, market, side, price, base_quantity, order_status, order_type, quote_quantity, expires) VALUES (_chainid , _userid, _market, _side, _price, amount_remaining, 'o', 'limit', amount_remaining*_price, NOW() + '1 day') RETURNING id, side, price, base_quantity) INSERT INTO tmp_offer SELECT * FROM offer;
  END IF;

  -- return results
  OPEN _fills FOR SELECT * FROM tmp_fills;
  RETURN NEXT _fills;

  OPEN _offer FOR SELECT * FROM tmp_offer;
  RETURN NEXT _offer;

END;
$$;
