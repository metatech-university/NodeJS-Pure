'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('ws');
const { Client } = require('./client.js');
const { receiveBody } = require('../lib/common.js');

const MIME_TYPES = {
  html: 'text/html; charset=UTF-8',
  json: 'application/json; charset=UTF-8',
  js: 'application/javascript; charset=UTF-8',
  css: 'text/css',
  png: 'image/png',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

const HEADERS = {
  'X-XSS-Protection': '1; mode=block',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubdomains; preload',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

class Transport {
  #console;

  constructor(console, req) {
    this.#console = console;
    this.req = req;
    this.ip = req.socket.remoteAddress;
  }

  error(code = 500, { callId, error = null, httpCode = null } = {}) {
    const { url, method } = this.req;
    if (!httpCode) httpCode = (error && error.httpCode) || code;
    const status = http.STATUS_CODES[httpCode];
    const pass = httpCode < 500 || httpCode > 599;
    const message = pass && error ? error.message : status || 'Unknown error';
    const reason = `${httpCode}\t${code}\t${error ? error.stack : status}`;
    this.#console.error(`${this.ip}\t${method}\t${url}\t${reason}`);
    const packet = { callback: callId, error: { message, code } };
    this.send(packet, httpCode);
  }

  send(obj, code = 200) {
    const data = JSON.stringify(obj);
    this.write(data, code, 'json');
  }
}

class HttpTransport extends Transport {
  constructor(console, req, res) {
    super(console, req);
    this.res = res;
  }

  write(data, httpCode = 200, ext = 'json') {
    if (this.res.writableEnded) return;
    const mimeType = MIME_TYPES[ext] || MIME_TYPES.html;
    this.res.writeHead(httpCode, { ...HEADERS, 'Content-Type': mimeType });
    this.res.end(data);
  }
}

class WsTransport extends Transport {
  constructor(console, req, connection) {
    super(console, req);
    this.connection = connection;
  }

  write(data) {
    this.connection.send(data);
  }
}

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
