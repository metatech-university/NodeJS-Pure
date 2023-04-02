'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Server } = require('ws');
const { receiveBody, jsonParse } = require('../lib/common.js');
const transport = require('./transport.js');
const { HttpTransport, WsTransport, MIME_TYPES, HEADERS } = transport;

class Session {
  constructor(token, data) {
    this.token = token;
    this.state = { ...data };
  }
}

const sessions = new Map(); // token: Session

class Context {
  constructor(client) {
    this.client = client;
    this.uuid = crypto.randomUUID();
    this.state = {};
    this.session = client?.session || null;
  }
}

class Client extends EventEmitter {
  #console;
  #transport;

  constructor(console, transport) {
    super();
    this.#console = console;
    this.#transport = transport;
    this.ip = transport.ip;
    this.session = null;
  }

  get token() {
    if (this.session === null) return '';
    return this.session.token;
  }

  createContext() {
    return new Context(this);
  }

  emit(name, data) {
    if (name === 'close') {
      super.emit(name, data);
      return;
    }
    this.#transport.send({ type: 'event', name, data });
  }

  initializeSession(token, data = {}) {
    this.finalizeSession();
    this.session = new Session(token, data);
    sessions.set(token, this.session);
    return true;
  }

  finalizeSession() {
    if (!this.session) return false;
    sessions.delete(this.session.token);
    this.session = null;
    return true;
  }

  restoreSession(token) {
    const session = sessions.get(token);
    if (!session) return false;
    this.session = session;
    return true;
  }

  messageHandler(routing, data) {
    const packet = jsonParse(data);
    if (!packet) {
      const error = new Error('JSON parsing error');
      this.#transport.error(500, { error, pass: true });
      return;
    }
    const { id, type, args } = packet;
    if (type === 'call') {
      /* TODO: this.#transport.resumeCookieSession(); */
      if (id && args) {
        this.rpc(routing, packet);
        return;
      }
      const error = new Error('Packet structure error');
      this.#transport.error(400, { id, error, pass: true });
      return;
    }
    const error = new Error('Packet structure error');
    this.#transport.error(500, { error, pass: true });
  }

  async rpc(routing, packet) {
    const { id } = packet;
    const [unit, method] = packet.method.split('/');
    const proc = routing[unit][method];
    if (!proc) {
      this.#transport.error(404, { id });
      return;
    }
    const context = this.createContext();
    /* TODO: check rights
    if (!this.session && proc.access !== 'public') {
      this.#transport.error(403, { id });
      return;
    }*/
    let result = null;
    try {
      result = await proc(context).method(packet.args);
    } catch (error) {
      if (error.message === 'Timeout reached') {
        error.code = error.httpCode = 408;
      }
      this.#transport.error(error.code, { id, error });
      return;
    }
    if (result?.constructor?.name === 'Error') {
      const { code, httpCode = 200 } = result;
      this.#transport.error(code, { id, error: result, httpCode });
      return;
    }
    this.#transport.send({ type: 'callback', id, result });
    this.#console.log(`${this.ip}\t${unit}/${method}`);
  }

  destroy() {
    this.emit('close');
    if (!this.session) return;
    this.finalizeSession();
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

  server.on('request', async (req, res) => {
    if (!req.url.startsWith('/api')) {
      staticHandler(req, res);
      return;
    }
    const transport = new HttpTransport(console, req, res);
    const client = new Client(console, transport);
    const data = await receiveBody(req);
    client.messageHandler(routing, data);

    req.on('close', () => {
      client.destroy();
    });
  });

  const ws = new Server({ server });
  ws.on('connection', (connection, req) => {
    const transport = new WsTransport(console, req, connection);
    const client = new Client(console, transport);

    connection.on('message', (data) => {
      client.messageHandler(routing, data);
    });

    connection.on('close', () => {
      client.destroy();
    });
  });

  return server;
};

module.exports = { createServer };
