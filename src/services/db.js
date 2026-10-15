'use strict';

const mysql = require('mysql2/promise');

// Las credenciales se leen exclusivamente de process.env.DB_* en cada conexión.
function getConnectionOptions() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectTimeout: 5000,
  };
}

// Abre una conexión nueva. Quien la llama debe cerrarla (connection.end()) en un finally.
function createConnection() {
  return mysql.createConnection(getConnectionOptions());
}

// Abre una conexión, ejecuta fn(connection) y la cierra siempre.
async function withConnection(fn) {
  const connection = await createConnection();
  try {
    return await fn(connection);
  } finally {
    await connection.end().catch(() => {});
  }
}

// Consulta sencilla para comprobar que la base de datos responde.
async function ping() {
  return withConnection(async (connection) => {
    await connection.query('SELECT 1');
  });
}

module.exports = { createConnection, withConnection, ping };
