// Copy the Google OAuth client from .env into SSM (SecureString), where the Lambdas read it.
//   npx tsx --env-file=.env scripts/store-google-client.ts
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const id = process.env.GOOGLE_CLIENT_ID;
const secret = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secret) throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first');
await new SSMClient({}).send(new PutParameterCommand({ Name: '/coord/google-oauth-client', Type: 'SecureString', Overwrite: true, Value: JSON.stringify({ id, secret }) }));
console.log('Stored Google OAuth client in SSM.');
