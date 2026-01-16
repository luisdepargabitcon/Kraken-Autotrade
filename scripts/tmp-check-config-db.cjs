const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const scrub = (url) => {
  if (!url) return 'undefined';
  return url.replace(/:\\w+@/, '://***@');
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  console.log('DATABASE_URL:', scrub(connectionString));
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  const queries = [
    {
      name: 'Public tables',
      text: "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    },
    {
      name: 'Config-related tables',
      text: "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'config%' OR tablename LIKE '%trading%') ORDER BY tablename",
    },
    {
      name: 'trading_config rows',
      text: 'SELECT id, name, is_active FROM trading_config',
    },
    {
      name: 'config_preset rows',
      text: 'SELECT name, is_default FROM config_preset',
    },
  ];

  for (const q of queries) {
    try {
      const res = await client.query(q.text);
      console.log(`\n[${q.name}]`);
      console.table(res.rows);
    } catch (err) {
      console.error(`\n[${q.name}] FAILED:`, err.message);
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
