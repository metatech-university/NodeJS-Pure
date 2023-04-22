'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const ws = require('ws');
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
  #transport;

  constructor(transport) {
    super();
    this.#transport = transport;
    this.ip = transport.ip;
    this.session = null;
  }

  error(code, options) {
    this.#transport.error(code, options);
  }

  send(obj, code) {
    this.#transport.send(obj, code);
  }

  createContext() {
    return new Context(this);
  }

  emit(name, data) {
    if (name === 'close') {
      super.emit(name, data);
      return;
    }
    this.send({ type: 'event', name, data });
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

class Server {
  constructor(application) {
    this.application = application;
    const { console, routing, config } = application;
    const staticPath = path.join(application.path, './static');
    this.staticHandler = serveStatic(staticPath);
    this.routing = routing;
    this.console = console;
    this.httpServer = http.createServer();
    const [port] = config.server.ports;
    this.listen(port);
    console.log(`API on port ${port}`);
  }

  listen(port) {
    this.httpServer.on('request', async (req, res) => {
      if (!req.url.startsWith('/api')) {
        this.staticHandler(req, res);
        return;
      }
      const transport = new HttpTransport(this, req, res);
      const client = new Client(transport);
      const data = await receiveBody(req);
      this.rpc(client, data);

      req.on('close', () => {
        client.destroy();
      });
    });

    const wsServer = new ws.Server({ server: this.httpServer });
    wsServer.on('connection', (connection, req) => {
      const transport = new WsTransport(this, req, connection);
      const client = new Client(transport);

      connection.on('message', (data) => {
        this.rpc(client, data);
      });

      connection.on('close', () => {
        client.destroy();
      });
    });

    this.httpServer.listen(port);
  }

  rpc(client, data) {
    const packet = jsonParse(data);
    if (!packet) {
      const error = new Error('JSON parsing error');
      client.error(500, { error, pass: true });
      return;
    }
    const { id, type, args } = packet;
    if (type !== 'call' || !id || !args) {
      const error = new Error('Packet structure error');
      client.error(400, { id, error, pass: true });
      return;
    }
    /* TODO: resumeCookieSession(); */
    const [unit, method] = packet.method.split('/');
    const proc = this.routing[unit][method];
    if (!proc) {
      client.error(404, { id });
      return;
    }
    const context = client.createContext();
    /* TODO: check rights
    if (!client.session && proc.access !== 'public') {
      client.error(403, { id });
      return;
    }*/
    this.console.log(`${client.ip}\t${packet.method}`);
    proc(context)
      .method(packet.args)
      .then((result) => {
        if (result?.constructor?.name === 'Error') {
          const { code, httpCode = 200 } = result;
          client.error(code, { id, error: result, httpCode });
          return;
        }
        client.send({ type: 'callback', id, result });
      })
      .catch((error) => {
        client.error(error.code, { id, error });
      });
  }
}

module.exports = { Server };
