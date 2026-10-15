'use strict';

const config = require('./src/config');
const app = require('./src/app');

// Un rechazo no controlado no debe tumbar el servidor; se registra solo el nombre del error.
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason && reason.name ? reason.name : 'desconocido');
});

app.listen(config.port, () => {
  console.log(`Digicyus AI escuchando en el puerto ${config.port}`);
});
