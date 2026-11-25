import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  uri: process.env.MYSQL_URL,
  ssl: { rejectUnauthorized: false },
});

const [db] = await c.query('SELECT DATABASE() AS name');
console.log('Connected to database:', db[0].name);

const [tables] = await c.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
console.log('Tables found:', tables.map((t) => t.name).join(', ') || '(none)');

await c.query(`INSERT IGNORE INTO currencies (code, name, symbol, minor_units, is_supported, partner_available, partner_name, sort_order) VALUES
  ('USD', 'US Dollar', '$', 2, 1, 0, NULL, 1),
  ('EUR', 'Euro', '€', 2, 1, 0, NULL, 2),
  ('GBP', 'British Pound', '£', 2, 1, 0, NULL, 3),
  ('NGN', 'Nigerian Naira', '₦', 2, 1, 0, NULL, 4),
  ('CAD', 'Canadian Dollar', 'CA$', 2, 1, 0, NULL, 5),
  ('AUD', 'Australian Dollar', 'A$', 2, 1, 0, NULL, 6),
  ('CHF', 'Swiss Franc', 'CHF', 2, 1, 0, NULL, 7),
  ('JPY', 'Japanese Yen', '¥', 0, 1, 0, NULL, 8)`);

const [cur] = await c.query('SELECT code FROM currencies ORDER BY sort_order');
console.log('Currencies now in database:', cur.map((r) => r.code).join(', '));

await c.end();
