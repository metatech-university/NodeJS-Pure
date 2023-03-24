'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('ws');
const { receiveBody } = require('../lib/common.js');
const { Client } = require('./client.js');
const transport = require('./transport.js');
const { HttpTransport, WsTransport, MIME_TYPES, HEADERS } = transport;

const serveStatic = (staticPath) => async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(staticPath, url);
  try {
    const data = await fs.promises.readFile(filePath);
    const fileExt = path.extname(filePath).substring(1);
    const mimeType = MIME_TYPES[fileExt] || MIME_TYPES.html;
    res.writeHead(200, { ...HEADERS, 'Content-Type': mimeType });
    res.end(data);
  } catch (err) {
    res.statusCode = 404;
    res.end('"File is not found"');
  }
};

const createServer = (appPath, routing, console) => {
  const staticPath = path.join(appPath, './static');
  const staticHandler = serveStatic(staticPath);
  const server = http.createServer();

  server.on('request', (req, res) => {
    if (!req.url.startsWith('/api')) {
      staticHandler(req, res);
      return;
    }
    const transport = new HttpTransport(console, req, res);
    const client = new Client(console, transport, routing);
    const data = receiveBody(req);
    client.message(data);

    req.on('close', () => {
      client.destroy();
    });
  });

  const ws = new Server({ server });
  ws.on('connection', (connection, req) => {
    const transport = new WsTransport(console, req, connection);
    const client = new Client(console, transport, routing);

    connection.on('message', (data) => {
      client.message(data);
    });

    connection.on('close', () => {
      client.destroy();
    });
  });

  return server;
};

module.exports = { createServer };
