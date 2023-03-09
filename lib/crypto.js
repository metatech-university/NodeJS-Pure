'use strict';

const crypto = require('node:crypto');

const UINT32_MAX = 0xffffffff;
const BUF_LEN = 1024;
const BUF_SIZE = BUF_LEN * Uint32Array.BYTES_PER_ELEMENT;

const randomPrefetcher = {
  buf: crypto.randomBytes(BUF_SIZE),
  pos: 0,
  next() {
    const { buf, pos } = this;
    let start = pos;
    if (start === buf.length) {
      start = 0;
      crypto.randomFillSync(buf);
    }
    const end = start + Uint32Array.BYTES_PER_ELEMENT;
    this.pos = end;
    return buf.slice(start, end);
  },
};

const cryptoRandom = () => {
  const buf = randomPrefetcher.next();
  return buf.readUInt32LE(0) / (UINT32_MAX + 1);
};

const generateUUID = () => {
  const h1 = randomPrefetcher.next().toString('hex');
  const h2 = randomPrefetcher.next().toString('hex');
  const buf = randomPrefetcher.next();
  buf[0] = (buf[0] & 0x0f) | 0x40;
  buf[2] = (buf[2] & 0x3f) | 0x80;
  const h3 = buf.toString('hex');
  const h4 = randomPrefetcher.next().toString('hex');
  const d2 = h2.substring(0, 4);
  const d3 = h3.substring(0, 4);
  const d4 = h3.substring(4, 8);
  const d5 = h2.substring(4, 8) + h4;
  return [h1, d2, d3, d4, d5].join('-');
};

// Only change these if you know what you're doing
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_PREFIX = '$scrypt$N=32768,r=8,p=1,maxmem=67108864$';

const serializeHash = (hash, salt) => {
  const saltString = salt.toString('base64').split('=')[0];
  const hashString = hash.toString('base64').split('=')[0];
  return `${SCRYPT_PREFIX}${saltString}$${hashString}`;
};

const parseOptions = (options) => {
  const values = [];
  const items = options.split(',');
  for (const item of items) {
    const [key, val] = item.split('=');
    values.push([key, Number(val)]);
  }
  return Object.fromEntries(values);
};

const deserializeHash = (phcString) => {
  const [, name, options, salt64, hash64] = phcString.split('$');
  if (name !== 'scrypt') {
    throw new Error('Node.js crypto module only supports scrypt');
  }
  const params = parseOptions(options);
  const salt = Buffer.from(salt64, 'base64');
  const hash = Buffer.from(hash64, 'base64');
  return { params, salt, hash };
};

const SALT_LEN = 32;
const KEY_LEN = 64;

const hashPassword = (password) =>
  new Promise((resolve, reject) => {
    crypto.randomBytes(SALT_LEN, (err, salt) => {
      if (err) {
        reject(err);
        return;
      }
      crypto.scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, hash) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(serializeHash(hash, salt));
      });
    });
  });

let defaultHash;
hashPassword('').then((hash) => {
  defaultHash = hash;
});

const validatePassword = (password, serHash = defaultHash) => {
  const { params, salt, hash } = deserializeHash(serHash);
  return new Promise((resolve, reject) => {
    const callback = (err, hashedPassword) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(crypto.timingSafeEqual(hashedPassword, hash));
    };
    crypto.scrypt(password, salt, hash.length, params, callback);
  });
};

module.exports = {
  cryptoRandom,
  generateUUID,
  hashPassword,
  validatePassword,
};
