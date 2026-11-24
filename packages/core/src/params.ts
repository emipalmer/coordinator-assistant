// One place for deployment names, so the CDK stack, Lambdas and scripts can't drift apart.
// Everything is namespaced away from the original Tari hackathon stack (/coord/*, db "coord").

export const STACK_NAME = 'PersonalAssistant';
export const DB_NAME = 'assistant';

const P = '/assistant';
export const PARAMS = {
  bridgeSecret: `${P}/bridge-secret`,
  mongoUri: `${P}/mongodb-uri`,
  anthropicKey: `${P}/anthropic-api-key`,
  /** HMAC key for the signed, short-lived Google OAuth state. */
  stateSecret: `${P}/state-secret`,
  /** JSON {id, secret} of the Google OAuth web client. */
  googleClient: `${P}/google-oauth-client`,
  /** Hex AES-256 key that seals Google refresh tokens at rest. */
  tokenKey: `${P}/token-key`,
  /** JSON {feedUrl}: the owner's Canvas Calendar Feed (.ics) link. */
  canvas: `${P}/canvas`,
} as const;
