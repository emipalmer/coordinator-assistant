import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
const cache = new Map<string, string>();

// SecureString params are created out-of-band (CloudFormation can't create them), so read at runtime and cache per container.
export async function getSecret(name: string): Promise<string> {
  const hit = cache.get(name);
  if (hit) return hit;
  const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} is empty`);
  cache.set(name, value);
  return value;
}
