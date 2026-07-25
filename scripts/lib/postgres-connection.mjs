#!/usr/bin/env node

const variableName = process.argv[2];
const connectionString = variableName ? process.env[variableName] : "";

if (!connectionString) {
  console.error("A PostgreSQL connection environment variable is required.");
  process.exit(1);
}

let connectionUrl;
try {
  connectionUrl = new URL(connectionString);
} catch {
  console.error("The PostgreSQL connection string is invalid.");
  process.exit(1);
}

if (!["postgres:", "postgresql:"].includes(connectionUrl.protocol)) {
  console.error("The connection string must use postgres:// or postgresql://.");
  process.exit(1);
}

if (connectionUrl.hostname.includes("-pooler")) {
  console.error("Use a direct Neon connection string without the -pooler hostname.");
  process.exit(1);
}

const database = decodeURIComponent(connectionUrl.pathname.replace(/^\/+/, ""));
const user = decodeURIComponent(connectionUrl.username);
const password = decodeURIComponent(connectionUrl.password);

if (!connectionUrl.hostname || !database || !user || !password) {
  console.error("The PostgreSQL connection string is incomplete.");
  process.exit(1);
}

const fields = [
  connectionUrl.hostname,
  connectionUrl.port || "5432",
  database,
  user,
  password,
  connectionUrl.searchParams.get("sslmode") || "require",
  connectionUrl.searchParams.get("channel_binding") || "require",
];

process.stdout.write(fields.map((field) => `${field}\0`).join(""));
