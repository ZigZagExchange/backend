// SPDX-License-Identifier: BUSL-1.1
import pg from 'pg'
import path from 'path'
import fs from 'fs'

const { Pool } = pg

pg.types.setTypeParser(20, parseInt)
pg.types.setTypeParser(23, parseInt)
pg.types.setTypeParser(1700, parseFloat)

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 15,
})

const migration = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8')

db.query(migration).catch(console.error)

export default db
