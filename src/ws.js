'use strict';

const { Server } = require('ws');
const { Client } = require('../client.js');

module.exports = (routing, server, console) => {
  const ws = new Server({ server });

  ws.on('connection', (connection, req) => {
    const client = new Client(req, null, connection);
    connection.on('message', (data) => {
      client.message(data);
    });
    connection.on('close', () => {
      client.destroy();
    });
  });

  console.log(`API on port ${server.address().port}`);
};
