CREATE TABLE IF NOT EXISTS offers (
    id                SERIAL         PRIMARY KEY,
    userid            TEXT,
    nonce             INTEGER,
    market            TEXT,
    side              CHAR(1),
    price             NUMERIC        NOT NULL CHECK (price > 0),
    base_quantity     NUMERIC        CHECK (base_quantity > 0),
    quote_quantity    NUMERIC        CHECK (quote_quantity > 0),
    order_type        TEXT,
    order_status      TEXT,
    expires           BIGINT,
    zktx              TEXT,
    chainid           INTEGER        NOT NULL,
    insert_timestamp  TIMESTAMPTZ,
    update_timestamp  TIMESTAMPTZ,
    unfilled          NUMERIC        NOT NULL CHECK (unfilled <= base_quantity)
);
CREATE INDEX IF NOT EXISTS offers_order_status_by_market_idx ON offers(chainid, market, order_status);

ALTER TABLE offers ADD COLUMN IF NOT EXISTS txhash TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS token TEXT; 

CREATE TABLE IF NOT EXISTS fills (
  id                 SERIAL          PRIMARY KEY,
  insert_timestamp   TIMESTAMPTZ     NOT NULL DEFAULT now(),
  chainid            INTEGER         NOT NULL,
  market             TEXT            NOT NULL,
  maker_offer_id     INTEGER,
  taker_offer_id     INTEGER         NOT NULL,
  maker_user_id      TEXT,
  taker_user_id      TEXT            NOT NULL,
  fill_status        TEXT            NOT NULL DEFAULT 'm',
  txhash             TEXT,            
  price              NUMERIC(32, 16) NOT NULL CHECK (price > 0),
  amount             NUMERIC(32, 16) NOT NULL CHECK (amount > 0),
  maker_fee          NUMERIC(32, 16) NOT NULL DEFAULT 0.0,
  taker_fee          NUMERIC(32, 16) NOT NULL DEFAULT 0.0
) WITH (OIDS=FALSE);

ALTER TABLE fills ADD COLUMN IF NOT EXISTS side TEXT;
ALTER TABLE fills ADD COLUMN IF NOT EXISTS feeamount  NUMERIC(32, 16);
ALTER TABLE fills ADD COLUMN IF NOT EXISTS feetoken TEXT;

CREATE INDEX IF NOT EXISTS fills_chainid_market ON fills(chainid, market);
CREATE INDEX IF NOT EXISTS fills_fill_status ON fills(fill_status);
CREATE INDEX IF NOT EXISTS fills_maker_user_id ON fills(chainid, maker_user_id);
CREATE INDEX IF NOT EXISTS fills_taker_user_id ON fills(chainid, taker_user_id);
CREATE INDEX IF NOT EXISTS fills_taker_offer_id ON fills(chainid, taker_offer_id);
CREATE INDEX IF NOT EXISTS fills_chainid_fill_status_market ON fills(chainid, fill_status, market);
CREATE INDEX IF NOT EXISTS fills_fill_status_insert_timestamp ON fills(fill_status, insert_timestamp);
CREATE INDEX IF NOT EXISTS fills_chainid_fill_status_insert_timestamp_market ON fills(chainid, fill_status, insert_timestamp, market);

CREATE TABLE IF NOT EXISTS marketids (
  marketalias        TEXT            PRIMARY KEY,
  chainid            INTEGER         NOT NULL,
  marketid           TEXT            NOT NULL
);

-------------------------------------------------------------------
-- match_limit_order
--
-- Matches a limit order against offers in the book. Example usage:
-- SELECT match_limit_order(1001, '0xeae57ce9cc1984F202e15e038B964bb8bdF7229a', 'ETH-USDT', 'b', 4010.0, 0.5, 'fills', 'offer');
-- SELECT match_limit_order((SELECT id FROM users WHERE email = 'user-a@example.com' AND obsolete = FALSE), (SELECT id FROM markets WHERE base_symbol = 'BTC' AND quote_symbol = 'USD' AND obsolete = FALSE), 'sell', 4993.0, 0.5);
--
-- Notes: Currently lots of copied code in this and no tests yet.
-- Returns a table of IDs. That list ID in the table is the offer ID. Every other ID in the table is a fill ID.
-------------------------------------------------------------------

CREATE OR REPLACE FUNCTION match_limit_order(_chainid  INTEGER, _userid TEXT, _market TEXT, _side CHAR(1), _price NUMERIC, _base_quantity NUMERIC, _quote_quantity NUMERIC, _expires BIGINT, _zktx TEXT, _token TEXT)
  RETURNS TABLE (
    id INTEGER
  )
  LANGUAGE plpgsql
AS $$
DECLARE
  match RECORD;
  amount_taken NUMERIC;
  amount_remaining NUMERIC;
  _taker_offer_id INTEGER;
BEGIN
  CREATE TEMPORARY TABLE tmp_ret (
    id INTEGER
  ) ON COMMIT DROP;

  -- Insert initial order to get an orderid
  INSERT INTO offers (chainid , userid, market, side, price, base_quantity, order_status, order_type, quote_quantity, expires, unfilled, zktx, insert_timestamp, token) 
  VALUES (
      _chainid , _userid, _market, _side, _price, _base_quantity, 'o', 'l', _quote_quantity, _expires, _base_quantity, _zktx, NOW(), _token
  )
  RETURNING offers.id INTO _taker_offer_id;

  amount_remaining := _base_quantity;

  -- take any offers that cross
  IF _side = 'b' THEN
    FOR match IN SELECT * FROM offers WHERE chainid = _chainid AND market = _market AND side = 's' AND price <= _price AND unfilled > 0 AND order_status IN ('o', 'pf', 'pm') ORDER BY price ASC, insert_timestamp ASC LOOP
      IF amount_remaining > 0 THEN
        IF amount_remaining < match.unfilled THEN
          amount_taken := amount_remaining;
          amount_remaining := amount_remaining - amount_taken;
          WITH fill AS (INSERT INTO fills (chainid , market, maker_offer_id, taker_offer_id, maker_user_id, taker_user_id, price, amount, side) VALUES (_chainid , _market, match.id, _taker_offer_id, match.userid, _userid, match.price, amount_taken, _side) RETURNING fills.id) INSERT INTO tmp_ret SELECT * FROM fill;
          UPDATE offers SET unfilled = unfilled - amount_taken, order_status=(CASE WHEN unfilled=amount_taken THEN 'm' ELSE 'pm' END) WHERE offers.id = match.id;
          IF amount_remaining = 0 THEN
            EXIT; -- exit loop
          END IF;
        ELSE
          amount_taken := match.unfilled;
          amount_remaining := amount_remaining - amount_taken;
          WITH fill AS (INSERT INTO fills (chainid , market, maker_offer_id, taker_offer_id, maker_user_id, taker_user_id, price, amount, side) VALUES (_chainid , _market, match.id, _taker_offer_id, match.userid, _userid, match.price, amount_taken, _side) RETURNING fills.id) INSERT INTO tmp_ret SELECT * FROM fill;
          UPDATE offers SET unfilled = unfilled - amount_taken, order_status=(CASE WHEN unfilled=amount_taken THEN 'm' ELSE 'pm' END) WHERE offers.id = match.id;
          IF amount_remaining = 0 THEN
            EXIT; -- exit loop
          END IF;
        END IF;
      END IF; -- if amount_remaining > 0
    END LOOP;
  ELSE -- side is 's'
    FOR match IN SELECT * FROM offers WHERE chainid  = _chainid  AND market = _market AND side = 'b' AND price >= _price and unfilled > 0 AND order_status IN ('o', 'pf', 'pm') ORDER BY price DESC, insert_timestamp ASC LOOP
      IF amount_remaining > 0 THEN
        IF amount_remaining < match.unfilled THEN
          amount_taken := amount_remaining;
          amount_remaining := amount_remaining - amount_taken;
          WITH fill AS (INSERT INTO fills (chainid , market, maker_offer_id, taker_offer_id, maker_user_id, taker_user_id, price, amount, side) VALUES (_chainid , _market, match.id, _taker_offer_id, match.userid, _userid, match.price, amount_taken, _side) RETURNING fills.id) INSERT INTO tmp_ret SELECT * FROM fill;
          UPDATE offers SET unfilled = unfilled - amount_taken, order_status=(CASE WHEN unfilled=amount_taken THEN 'm' ELSE 'pm' END) WHERE offers.id = match.id;
          IF amount_remaining = 0 THEN
                EXIT; -- exit loop
          END IF;
        ELSE
          amount_taken := match.unfilled;
          amount_remaining := amount_remaining - amount_taken;
          WITH fill AS (INSERT INTO fills (chainid , market, maker_offer_id, taker_offer_id, maker_user_id, taker_user_id, price, amount, side) VALUES (_chainid , _market, match.id, _taker_offer_id, match.userid, _userid, match.price, amount_taken, _side) RETURNING fills.id) INSERT INTO tmp_ret SELECT * FROM fill;
          UPDATE offers SET unfilled = unfilled - amount_taken, order_status=(CASE WHEN unfilled=amount_taken THEN 'm' ELSE 'pm' END) WHERE offers.id = match.id;
          IF amount_remaining = 0 THEN
            EXIT; -- exit loop
          END IF;
        END IF;
      END IF; -- if amount_remaining > 0
    END LOOP;
  END IF;

  -- Update offer with fill and status data 
  UPDATE offers SET 
    order_status=(CASE WHEN amount_remaining = 0 THEN 'm' WHEN amount_remaining != _base_quantity THEN 'pm' ELSE 'o' END),
    unfilled=LEAST(amount_remaining, _base_quantity)
  WHERE offers.id=_taker_offer_id;

  INSERT INTO tmp_ret (id) VALUES (_taker_offer_id);
  
  RETURN QUERY 
    SELECT * FROM tmp_ret;

END;
$$;

/* ################ V3 functions  ################ */
CREATE TABLE IF NOT EXISTS past_orders_V3 (
  id                 SERIAL          PRIMARY KEY,
  txhash             TEXT            NOT NULL,
  market             TEXT            NOT NULL,
  chainid            INTEGER         NOT NULL,
  taker_address      TEXT            NOT NULL,
  maker_address      TEXT            NOT NULL,
  taker_buy_token    TEXT            NOT NULL,
  taker_sell_token   TEXT            NOT NULL,
  taker_buy_amount   NUMERIC(32, 16) NOT NULL,
  taker_sell_amount  NUMERIC(32, 16) NOT NULL,
  maker_fee          NUMERIC(32, 16) NOT NULL DEFAULT 0.0,
  taker_fee          NUMERIC(32, 16) NOT NULL DEFAULT 0.0,
  txtime             TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS past_orders_V3_chainid_taker_buy_token_taker_sell_token ON past_orders_V3(chainid, taker_buy_token, taker_sell_token);
CREATE INDEX IF NOT EXISTS past_orders_V3_chainid                                  ON past_orders_V3(chainid);
CREATE INDEX IF NOT EXISTS past_orders_V3_chainid_taker_address                    ON past_orders_V3(chainid, taker_address);
CREATE INDEX IF NOT EXISTS past_orders_V3_taker_address                            ON past_orders_V3(taker_address);
CREATE INDEX IF NOT EXISTS past_orders_V3_chainid_maker_address                    ON past_orders_V3(chainid, maker_address);
CREATE INDEX IF NOT EXISTS past_orders_V3_maker_address                            ON past_orders_V3(maker_address);
CREATE INDEX IF NOT EXISTS past_orders_V3_chainid_market                           ON past_orders_V3(chainid, market);
CREATE INDEX IF NOT EXISTS past_orders_V3_market                                   ON past_orders_V3(market);