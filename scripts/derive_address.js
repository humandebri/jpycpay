#!/usr/bin/env node

const crypto = require('crypto');
const { TextEncoder } = require('util');

const P = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f');
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const GX = BigInt('0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
const GY = BigInt('0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8');
const MASK_64 = BigInt('0xffffffffffffffff');

function hexToBytes(hex) {
  if (hex.startsWith('0x') || hex.startsWith('0X')) {
    hex = hex.slice(2);
  }
  if (hex.length % 2 === 1) {
    hex = '0' + hex;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function concatBytes(arrays) {
  const length = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function bytesToBigInt(bytes) {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) + BigInt(byte);
  }
  return result;
}

function bigIntToBytes(value, length) {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function mod(a, m) {
  const result = a % m;
  return result >= 0n ? result : result + m;
}

function modPow(base, exp, modulus) {
  let result = 1n;
  let b = mod(base, modulus);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) {
      result = mod(result * b, modulus);
    }
    b = mod(b * b, modulus);
    e >>= 1n;
  }
  return result;
}

function modInverse(a, modulus) {
  let lm = 1n;
  let hm = 0n;
  let low = mod(a, modulus);
  let high = modulus;

  while (low > 1n) {
    const ratio = high / low;
    const nm = hm - lm * ratio;
    const newVal = high - low * ratio;
    hm = lm;
    lm = nm;
    high = low;
    low = newVal;
  }

  return mod(lm, modulus);
}

function pointAdd(p, q) {
  if (p === null) return q;
  if (q === null) return p;

  if (p.x === q.x) {
    if (mod(p.y + q.y, P) === 0n) {
      return null;
    }
    return pointDouble(p);
  }

  const lambda = mod((q.y - p.y) * modInverse(q.x - p.x, P), P);
  const x = mod(lambda * lambda - p.x - q.x, P);
  const y = mod(lambda * (p.x - x) - p.y, P);
  return { x, y };
}

function pointDouble(p) {
  if (p === null) return null;
  if (p.y === 0n) return null;

  const lambda = mod((3n * p.x * p.x) * modInverse(2n * p.y, P), P);
  const x = mod(lambda * lambda - 2n * p.x, P);
  const y = mod(lambda * (p.x - x) - p.y, P);
  return { x, y };
}

function scalarMult(k, point) {
  let scalar = mod(k, N);
  if (scalar === 0n) {
    throw new Error('scalar reduces to zero');
  }

  let result = null;
  let addend = point;

  while (scalar > 0n) {
    if (scalar & 1n) {
      result = pointAdd(result, addend);
    }
    addend = pointDouble(addend);
    scalar >>= 1n;
  }
  return result;
}

function decompressPublicKey(bytes) {
  if (bytes.length !== 33) {
    throw new Error('compressed public key must be 33 bytes');
  }
  const prefix = bytes[0];
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new Error('invalid compressed public key prefix');
  }
  const x = bytesToBigInt(bytes.slice(1));
  const alpha = mod(modPow(x, 3n, P) + 7n, P);
  const beta = modPow(alpha, (P + 1n) >> 2n, P);
  const isOdd = Number(beta & 1n);
  let y = beta;
  if (isOdd !== (prefix & 1)) {
    y = mod(P - y, P);
  }
  return { x, y };
}

function compressPublicKey(point) {
  const prefix = Number(point.y & 1n) === 1 ? 0x03 : 0x02;
  const xBytes = bigIntToBytes(point.x, 32);
  const out = new Uint8Array(33);
  out[0] = prefix;
  out.set(xBytes, 1);
  return out;
}

function uncompressedPublicKey(point) {
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(bigIntToBytes(point.x, 32), 1);
  out.set(bigIntToBytes(point.y, 32), 33);
  return out;
}

const KECCAK_ROUNDS = 24;
const KECCAK_ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n,
  0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn,
  0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n,
  0x0000000080000001n, 0x8000000080008008n,
];

function rotl64(x, n) {
  const shift = BigInt(n);
  return ((x << shift) | (x >> (64n - shift))) & MASK_64;
}

function keccakF(state) {
  const C = new Array(5).fill(0n);
  for (let round = 0; round < KECCAK_ROUNDS; round++) {
    for (let x = 0; x < 5; x++) {
      C[x] =
        state[x] ^
        state[x + 5] ^
        state[x + 10] ^
        state[x + 15] ^
        state[x + 20];
    }

    for (let x = 0; x < 5; x++) {
      const d = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) {
        const idx = x + 5 * y;
        state[idx] = (state[idx] ^ d) & MASK_64;
      }
    }

    let x = 1;
    let y = 0;
    let current = state[x + 5 * y];
    for (let t = 0; t < 24; t++) {
      const newX = y;
      const newY = (2 * x + 3 * y) % 5;
      const index = newX + 5 * newY;
      const rotation = ((t + 1) * (t + 2)) / 2 % 64;
      const temp = state[index];
      state[index] = rotl64(current, rotation);
      current = temp;
      x = newX;
      y = newY;
    }

    const row = new Array(5).fill(0n);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        row[x] = state[x + 5 * y];
      }
      for (let x = 0; x < 5; x++) {
        state[x + 5 * y] =
          (row[x] ^ ((~row[(x + 1) % 5]) & MASK_64 & row[(x + 2) % 5])) & MASK_64;
      }
    }

    state[0] = (state[0] ^ KECCAK_ROUND_CONSTANTS[round]) & MASK_64;
  }
}

function keccak256(bytes) {
  const rate = 136;
  const state = new Array(25).fill(0n);
  let offset = 0;

  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  while (offset + rate <= input.length) {
    for (let i = 0; i < rate; i++) {
      const byte = BigInt(input[offset + i]);
      const lane = Math.floor(i / 8);
      const shift = BigInt((i % 8) * 8);
      state[lane] ^= (byte << shift);
    }
    keccakF(state);
    offset += rate;
  }

  const block = new Uint8Array(rate).fill(0);
  block.set(input.slice(offset));
  block[input.length - offset] ^= 0x01;
  block[rate - 1] ^= 0x80;

  for (let i = 0; i < rate; i++) {
    const byte = BigInt(block[i]);
    const lane = Math.floor(i / 8);
    const shift = BigInt((i % 8) * 8);
    state[lane] ^= (byte << shift);
  }

  keccakF(state);

  const output = new Uint8Array(32);
  let outOffset = 0;
  let laneIndex = 0;

  while (outOffset < 32) {
    const lane = state[laneIndex];
    for (let i = 0; i < 8 && outOffset < 32; i++) {
      output[outOffset] = Number((lane >> BigInt(8 * i)) & 0xffn);
      outOffset += 1;
    }
    laneIndex += 1;
  }

  return output;
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const BASE32_LOOKUP = (() => {
  const map = new Map();
  for (let i = 0; i < BASE32_ALPHABET.length; i++) {
    map.set(BASE32_ALPHABET[i], i);
  }
  return map;
})();

const textEncoder = new TextEncoder();

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of text) {
    const val = BASE32_LOOKUP.get(char);
    if (val === undefined) {
      throw new Error(`invalid base32 character: ${char}`);
    }
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) {
    throw new Error('invalid base32 padding');
  }
  return new Uint8Array(output);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c >>>= 1;
      }
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const idx = (crc ^ byte) & 0xff;
    crc = (CRC32_TABLE[idx] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function principalToBytes(principal) {
  const normalized = principal.toLowerCase().replace(/-/g, '');
  const decoded = base32Decode(normalized);
  if (decoded.length < 5) {
    throw new Error('principal decode failed: too short');
  }
  const checksum = decoded.slice(0, 4);
  const bytes = decoded.slice(4);
  const expected = crc32(bytes);
  const actual =
    (((checksum[0] << 24) |
      (checksum[1] << 16) |
      (checksum[2] << 8) |
      checksum[3]) >>> 0);
  if (actual !== expected) {
    throw new Error('principal checksum mismatch');
  }
  return bytes;
}

function parsePath(spec) {
  if (!spec) return [];
  const parts = spec
    .split(/[\s,\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.map((part) => {
    const lower = part.toLowerCase();
    const colon = lower.indexOf(':');
    if (part.startsWith('0x') || part.startsWith('0X')) {
      return hexToBytes(part);
    }
    if (colon === -1) {
      return textEncoder.encode(part);
    }
    const prefix = lower.slice(0, colon);
    const value = part.slice(colon + 1);
    switch (prefix) {
      case 'hex':
        return hexToBytes(value);
      case 'int': {
        const num = BigInt(value);
        if (num < 0n || num > 0xffffffffn) {
          throw new Error('int component must be between 0 and 2^32-1');
        }
        return bigIntToBytes(num, 4);
      }
      case 'u256': {
        const num = BigInt(value);
        if (num < 0n || num > (1n << 256n) - 1n) {
          throw new Error('u256 component out of range');
        }
        return bigIntToBytes(num, 32);
      }
      case 'principal':
        return principalToBytes(value);
      case 'text':
        return textEncoder.encode(value);
      default:
        throw new Error(`unsupported path component prefix: ${prefix}`);
    }
  });
}

function derivePublicKey(masterCompressed, chainCode, pathComponents) {
  let point = decompressPublicKey(masterCompressed);
  let currentChainCode = new Uint8Array(chainCode);

  for (const component of pathComponents) {
    const data = concatBytes([compressPublicKey(point), component]);
    const digest = new Uint8Array(
      crypto
        .createHmac('sha512', Buffer.from(currentChainCode))
        .update(Buffer.from(data))
        .digest()
    );
    const il = digest.slice(0, 32);
    const ir = digest.slice(32);
    const scalar = bytesToBigInt(il);
    if (scalar === 0n || scalar >= N) {
      throw new Error('derived scalar out of range');
    }
    const child = pointAdd(scalarMult(scalar, { x: GX, y: GY }), point);
    if (child === null) {
      throw new Error('derived point at infinity');
    }
    point = child;
    currentChainCode = ir;
  }

  return { point, chainCode: currentChainCode };
}

function ensureKeccakVector() {
  const empty = keccak256(new Uint8Array([]));
  const expected = 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
  if (bytesToHex(empty) !== expected) {
    throw new Error('keccak256 self-test failed (empty string)');
  }
  const abc = keccak256(textEncoder.encode('abc'));
  const expectedAbc = '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532';
  if (bytesToHex(abc) !== expectedAbc) {
    throw new Error('keccak256 self-test failed ("abc")');
  }
}

function main() {
  const masterPubKeyHex = process.env.IC_MASTER_PUBKEY;
  const chainCodeHex = process.env.IC_CHAIN_CODE;
  const pathSpec = process.env.IC_DERIVATION_PATH || '';

  if (!masterPubKeyHex || !chainCodeHex) {
    console.error('IC_MASTER_PUBKEY and IC_CHAIN_CODE env vars are required');
    process.exit(1);
  }

  if (process.env.IC_SKIP_SELF_TEST !== '1') {
    ensureKeccakVector();
  }
  const masterCompressed = hexToBytes(masterPubKeyHex);
  const chainCode = hexToBytes(chainCodeHex);
  const pathComponents = parsePath(pathSpec);

  const { point, chainCode: newChainCode } = derivePublicKey(
    masterCompressed,
    chainCode,
    pathComponents
  );

  const compressed = compressPublicKey(point);
  const uncompressed = uncompressedPublicKey(point);
  const hash = keccak256(uncompressed.slice(1));
  const address = '0x' + bytesToHex(hash.slice(-20));

  console.log('Path components:', pathComponents.length);
  pathComponents.forEach((component, idx) => {
    console.log(`  [${idx}] ${bytesToHex(component)}`);
  });
  console.log('Derived compressed pubkey:', '0x' + bytesToHex(compressed));
  console.log('Derived uncompressed pubkey:', '0x' + bytesToHex(uncompressed));
  console.log('Updated chain code:', '0x' + bytesToHex(newChainCode));
  console.log('Derived Ethereum address:', address);
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    keccak256,
    bytesToHex,
    principalToBytes,
    base32Decode,
    crc32,
  };
}
