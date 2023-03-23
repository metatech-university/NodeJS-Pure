'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { jsonParse } = require('../lib/common.js');

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
    this.send({ event: --this.#eventId, [name]: data });
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
    this.#console.log(`${this.ip}\t${interfaceName}/${methodName}`);
  }

  destroy() {
    this.emit('close');
    if (!this.session) return;
    sessions.delete(this.session.token);
  }
}

module.exports = { Client };
