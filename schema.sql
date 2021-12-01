CREATE TABLE IF NOT EXISTS offers (
    id SERIAL,
    userid TEXT,
    nonce INTEGER,
    market TEXT,
    side CHAR(1),
    price NUMERIC NOT NULL CHECK (price > 0),
    base_quantity NUMERIC CHECK (base_quantity > 0),
    quote_quantity NUMERIC CHECK (quote_quantity > 0),
    order_type TEXT,
    order_status TEXT,
    expires BIGINT,
    zktx TEXT,
    chainid INTEGER NOT NULL,
    insert_timestamp TIMESTAMPTZ,
    update_timestamp TIMESTAMPTZ,
    unfilled NUMERIC NOT NULL CHECK (unfilled <= base_quantity)
);
CREATE INDEX IF NOT EXISTS idx_offers_price_time ON offers USING btree (chainid, market, price, insert_timestamp);

CREATE TABLE IF NOT EXISTS fills (
  id                 SERIAL,
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

CREATE OR REPLACE FUNCTION match_limit_order(_chainid  INTEGER, _userid TEXT, _market TEXT, _side CHAR(1), _price NUMERIC, _amount NUMERIC, _zktx TEXT)
  RETURNS TABLE (
    id INTEGER
  )
  LANGUAGE plpgsql
AS $$
DECLARE
  match RECORD;
  amount_taken NUMERIC(32, 16);
  amount_remaining NUMERIC(32, 16);
  _taker_offer_id INTEGER;
BEGIN
  CREATE TEMPORARY TABLE tmp_ret (
    id INTEGER
  ) ON COMMIT DROP;

  -- Insert initial order to get an orderid
  INSERT INTO offers (chainid , userid, market, side, price, base_quantity, order_status, order_type, quote_quantity, expires, unfilled, zktx, insert_timestamp) 
  VALUES (
      _chainid , _userid, _market, _side, _price, _amount, 
      'o', 'l', 
      _amount * _price, 
      EXTRACT(epoch FROM (NOW() + '1 day')), 
      _amount, _zktx, NOW()
  )
  RETURNING offers.id INTO _taker_offer_id;

  amount_remaining := _amount;

  -- take any offers that cross
  IF _side = 'b' THEN
    FOR match IN SELECT * FROM offers WHERE chainid = _chainid AND market = _market AND side = 's' AND price <= _price AND unfilled > 0 AND order_status IN ('o', 'pf', 'pm') ORDER BY price ASC, insert_timestamp ASC LOOP
      RAISE NOTICE 'Found sell match %', match;
      IF amount_remaining > 0 THEN
        IF amount_remaining < match.unfilled THEN
          RAISE NOTICE '  amount_remaining % < match.unfilled % = this offer is NOT completely filled by this order', amount_remaining, match.unfilled;
          amount_taken := amount_remaining;
          amount_remaining := amount_remaining - amount_taken;
          WITH fill AS (INSERT INTO fills (chainid , market, maker_offer_id, taker_offer_id, maker_user_id, taker_user_id, price, amount, side) VALUES (_chainid , _market, match.id, _taker_offer_id, match.userid, _userid, match.price, amount_taken, _side) RETURNING fills.id) INSERT INTO tmp_ret SELECT * FROM fill;
          UPDATE offers SET unfilled = unfilled - amount_taken, order_status=(CASE WHEN unfilled=amount_taken THEN 'm' ELSE 'pm' END) WHERE offers.id = match.id;
          IF amount_remaining = 0 THEN
            RAISE NOTICE '  order complete';
            EXIT; -- exit loop
          END IF;
        ELSE
          RAISE NOTICE '  amount_remaining % >= match.unfilled % = this offer is completely filled by this order', amount_remaining, match.unfilled;
          amount_taken := match.unfilled;
          amount_remaining := amount_remaining - amount_taken;
          WITH fill AS (INSERT INTO fills (chainid , market, maker_offer_id, taker_offer_id, maker_user_id, taker_user_id, price, amount, side) VALUES (_chainid , _market, match.id, _taker_offer_id, match.userid, _userid, match.price, amount_taken, _side) RETURNING fills.id) INSERT INTO tmp_ret SELECT * FROM fill;
          UPDATE offers SET unfilled = unfilled - amount_taken, order_status=(CASE WHEN unfilled=amount_taken THEN 'm' ELSE 'pm' END) WHERE offers.id = match.id;
          IF amount_remaining = 0 THEN
            RAISE NOTICE '  order complete';
            EXIT; -- exit loop
          END IF;
        END IF;
      END IF; -- if amount_remaining > 0
    END LOOP;
  ELSE -- side is 's'
    FOR match IN SELECT * FROM offers WHERE chainid  = _chainid  AND market = _market AND side = 'b' AND price >= _price and unfilled > 0 AND order_status IN ('o', 'pf', 'pm') ORDER BY price DESC, insert_timestamp ASC LOOP
      RAISE NOTICE 'Found buy match %', match;
      IF amount_remaining > 0 THEN
        IF amount_remaining < match.unfilled THEN
          RAISE NOTICE '  amount_remaining % < match.unfilled % = this offer isnt completely filled by this order', amount_remaining, match.unfilled;
          amount_taken := amount_remaining;
          amount_remaining := amount_remaining - amount_taken;
          WITH fill AS (INSERT INTO fills (chainid , market, maker_offer_id, taker_offer_id, maker_user_id, taker_user_id, price, amount, side) VALUES (_chainid , _market, match.id, _taker_offer_id, match.userid, _userid, match.price, amount_taken, _side) RETURNING fills.id) INSERT INTO tmp_ret SELECT * FROM fill;
          UPDATE offers SET unfilled = unfilled - amount_taken, order_status=(CASE WHEN unfilled=amount_taken THEN 'm' ELSE 'pm' END) WHERE offers.id = match.id;
          IF amount_remaining = 0 THEN
            RAISE NOTICE '  order complete';
                EXIT; -- exit loop
          END IF;
        ELSE
          RAISE NOTICE '  amount_remaining % >= match.unfilled % = this offer is NOT completely filled by this order', amount_remaining, match.unfilled;
          amount_taken := match.unfilled;
          amount_remaining := amount_remaining - amount_taken;
          RAISE NOTICE '  amount_remaining % after order is filled', amount_remaining;
          WITH fill AS (INSERT INTO fills (chainid , market, maker_offer_id, taker_offer_id, maker_user_id, taker_user_id, price, amount, side) VALUES (_chainid , _market, match.id, _taker_offer_id, match.userid, _userid, match.price, amount_taken, _side) RETURNING fills.id) INSERT INTO tmp_ret SELECT * FROM fill;
          UPDATE offers SET unfilled = unfilled - amount_taken, order_status=(CASE WHEN unfilled=amount_taken THEN 'm' ELSE 'pm' END) WHERE offers.id = match.id;
          IF amount_remaining = 0 THEN
            RAISE NOTICE '  order complete';
            EXIT; -- exit loop
          END IF;
        END IF;
      END IF; -- if amount_remaining > 0
    END LOOP;
  END IF;

  -- Update offer with fill and status data 
  UPDATE offers SET 
    order_status=(CASE WHEN amount_remaining = 0 THEN 'm' WHEN amount_remaining != _amount THEN 'pm' ELSE 'o' END),
    unfilled=amount_remaining
  WHERE offers.id=_taker_offer_id;

  INSERT INTO tmp_ret (id) VALUES (_taker_offer_id);
  
  RETURN QUERY 
    SELECT * FROM tmp_ret;

END;
$$;
