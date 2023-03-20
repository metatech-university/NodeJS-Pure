'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { jsonParse } = require('./lib/common.js');

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
  constructor(req, res, routing) {
    super();
    this.req = req;
    this.res = res;
    this.routing = routing;
    this.ip = req.socket.remoteAddress;
    this.session = null;
    this.eventId = 0;
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
    this.send({ event: --this.eventId, [name]: data });
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

  startSession(token, data = {}) {
    this.initializeSession(token, data);
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
      this.error(500, { error, pass: true });
      return;
    }
    const [callType] = Object.keys(packet);
    if (callType === 'call') {
      this.resumeCookieSession();
      const [callType, target] = Object.keys(packet);
      const callId = parseInt(packet[callType], 10);
      const args = packet[target];
      if (callId && args) {
        const [interfaceName, methodName] = target.split('/');
        void this.rpc(callId, interfaceName, methodName, args);
        return;
      }
      const error = new Error('Packet structure error');
      this.error(400, { callId, error, pass: true });
      return;
    }
    const error = new Error('Packet structure error');
    this.error(500, { error, pass: true });
  }

  async rpc(callId, interfaceName, methodName, args) {
    const [iname, ver = '*'] = interfaceName.split('.');
    const proc = this.routing.getMethod(iname, ver, methodName);
    if (!proc) {
      this.error(404, { callId });
      return;
    }
    const context = new Context(this);
    if (!this.session && proc.access !== 'public') {
      this.error(403, { callId });
      return;
    }
    let result = null;
    try {
      result = await proc.invoke(context, args);
    } catch (error) {
      if (error.message === 'Timeout reached') {
        error.code = error.httpCode = 408;
      }
      this.error(error.code, { callId, error });
      return;
    }
    if (result?.constructor?.name === 'Error') {
      const { code, httpCode } = result;
      this.error(code, { callId, error: result, httpCode: httpCode || 200 });
      return;
    }
    this.send({ callback: callId, result });
    console.log(`${this.ip}\t${interfaceName}/${methodName}`);
  }

  error(code = 500, { callId, error = null, httpCode = null } = {}) {
    const { req, ip } = this;
    const { url, method } = req;
    if (!httpCode) httpCode = (error && error.httpCode) || code;
    const status = http.STATUS_CODES[httpCode];
    const pass = httpCode < 500 || httpCode > 599;
    const message = pass && error ? error.message : status || 'Unknown error';
    const reason = `${httpCode}\t${code}\t${error ? error.stack : status}`;
    console.error(`${ip}\t${method}\t${url}\t${reason}`);
    const packet = { callback: callId, error: { message, code } };
    this.send(packet, httpCode);
  }

  destroy() {
    this.emit('close');
    if (!this.session) return;
    sessions.delete(this.session.token);
  }
}

module.exports = { Client };
