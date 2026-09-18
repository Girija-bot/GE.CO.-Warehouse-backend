const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "geco.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'employee')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS destinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    barcode TEXT,
    qrcode TEXT,
    category TEXT,
    description TEXT,
    supplier TEXT,
    location TEXT,
    min_stock INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS stock_in (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    supplier TEXT,
    notes TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS stock_out (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    destination_id INTEGER REFERENCES destinations(id),
    quantity INTEGER NOT NULL,
    notes TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER REFERENCES products(id),
    filename TEXT NOT NULL,
    notes TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default destinations if empty
const destinationCount =
  db.prepare("SELECT COUNT(*) as c FROM destinations").get().c;

if (destinationCount === 0) {
  const insert = db.prepare(
    "INSERT INTO destinations (name) VALUES (?)"
  );

  [
    "Ospedale Papardo",
    "Main Warehouse",
    "Farmacia",
    "Clinica A",
    "Clinica B"
  ].forEach((d) => insert.run(d));
}

// Seed default admin user if the database has no users
// Credentials are taken from environment variables on Render.
const userCount =
  db.prepare("SELECT COUNT(*) as c FROM users").get().c;

const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;

if (userCount === 0 && adminUsername && adminPassword) {
  db.prepare(`
    INSERT INTO users (name, username, password, role)
    VALUES (?, ?, ?, ?)
  `).run(
    "GE.CO. Administrator",
    adminUsername,
    adminPassword,
    "admin"
  );

  console.log("Default admin user created.");
}

module.exports = db;