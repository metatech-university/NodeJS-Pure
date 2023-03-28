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
  #routing;
  #eventId;

  constructor(console, transport, routing) {
    super();
    this.#console = console;
    this.#transport = transport;
    this.#routing = routing;
    this.#eventId = 0;
    this.ip = transport.ip;
    this.session = null;
  }

  get token() {
    if (this.session === null) return '';
    return this.session.token;
  }

  emit(name, data) {
    if (name === 'close') {
      super.emit(name, data);
      return;
    }
    this.#transport.send({ event: --this.#eventId, [name]: data });
  }

  initializeSession(token, data = {}) {
    if (this.session) sessions.delete(this.session.token);
    this.session = new Session(token, data);
    sessions.set(token, this.session);
    return true;
  }

  finalizeSession(token) {
    const session = sessions.get(token);
    if (!session) return false;
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

  message(data) {
    const packet = jsonParse(data);
    if (!packet) {
      const error = new Error('JSON parsing error');
      this.#transport.error(500, { error, pass: true });
      return;
    }
    const [callType] = Object.keys(packet);
    if (callType === 'call') {
      //this.resumeCookieSession();
      const [callType, target] = Object.keys(packet);
      const callId = parseInt(packet[callType], 10);
      const args = packet[target];
      if (callId && args) {
        const [interfaceName, methodName] = target.split('/');
        void this.rpc(callId, interfaceName, methodName, args);
        return;
      }
      const error = new Error('Packet structure error');
      this.#transport.error(400, { callId, error, pass: true });
      return;
    }
    const error = new Error('Packet structure error');
    this.#transport.error(500, { error, pass: true });
  }

  async rpc(callId, interfaceName, methodName, args) {
    const proc = this.#routing[interfaceName][methodName];
    if (!proc) {
      this.#transport.error(404, { callId });
      return;
    }
    const context = new Context(this);
    if (!this.session && proc.access !== 'public') {
      this.#transport.error(403, { callId });
      return;
    }
    let result = null;
    try {
      console.log(proc);
      result = await proc(context).method(args);
    } catch (error) {
      if (error.message === 'Timeout reached') {
        error.code = error.httpCode = 408;
      }
      this.#transport.error(error.code, { callId, error });
      return;
    }
    if (result?.constructor?.name === 'Error') {
      const { code, httpCode = 200 } = result;
      this.#transport.error(code, { callId, error: result, httpCode });
      return;
    }
    this.#transport.send({ callback: callId, result });
    this.#console.log(`${this.ip}\t${interfaceName}/${methodName}`);
  }

  destroy() {
    this.emit('close');
    if (!this.session) return;
    sessions.delete(this.session.token);
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
    const client = new Client(console, transport, routing);
    const data = await receiveBody(req);
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
