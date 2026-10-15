'use strict';

const config = require('./src/config');
const app = require('./src/app');

app.listen(config.port, () => {
  console.log(`Digicyus AI escuchando en el puerto ${config.port}`);
});
