import crypto from 'node:crypto';

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = (4 - (normalized.length % 4 || 4)) % 4;
  return Buffer.from(`${normalized}${'='.repeat(padding)}`, 'base64').toString('utf8');
}

export function signJwt(payload, secret, expiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const claims = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const content = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(content)
    .digest('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll(/=+$/g, '');

  return `${content}.${signature}`;
}

export function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');

  if (parts.length !== 3) {
    throw new Error('Invalid token');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const content = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(content)
    .digest('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll(/=+$/g, '');

  const actualSignature = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    actualSignature.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualSignature, expectedBuffer)
  ) {
    throw new Error('Invalid signature');
  }

  const header = JSON.parse(base64UrlDecode(encodedHeader));
  const payload = JSON.parse(base64UrlDecode(encodedPayload));

  if (header.alg !== 'HS256') {
    throw new Error('Unsupported algorithm');
  }

  if (!payload.exp || Number(payload.exp) <= Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

export function readBearerToken(headerValue) {
  if (typeof headerValue !== 'string') {
    return '';
  }

  const [scheme, token] = headerValue.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token ?? '' : '';
}
