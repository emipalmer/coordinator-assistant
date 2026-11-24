#!/bin/sh
# Make an access key for the bridge's own IAM user (created by `npm run deploy`) and save it as the
# `star-bridge` profile in ~/.aws/credentials. Nothing secret is printed. Run again to rotate:
# it deletes the user's older keys after the new one is saved.
set -eu
cd "$(dirname "$0")/.." || exit 1
PROFILE=star-bridge
USER_NAME=$(node -e "console.log(require('./cdk-outputs.json').PersonalAssistant.BridgeUserName ?? '')")
if [ -z "$USER_NAME" ]; then
  echo "No BridgeUserName in cdk-outputs.json yet. Run 'npm run deploy' and let it finish, then run this again." >&2
  exit 1
fi

OLD=$(aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[].AccessKeyId' --output text)
OUT=$(aws iam create-access-key --user-name "$USER_NAME" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
ID=$(printf '%s' "$OUT" | cut -f1)
SECRET=$(printf '%s' "$OUT" | cut -f2)
aws configure set aws_access_key_id "$ID" --profile "$PROFILE"
aws configure set aws_secret_access_key "$SECRET" --profile "$PROFILE"
aws configure set region us-east-1 --profile "$PROFILE"
unset OUT SECRET

for k in $OLD; do aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$k"; done
echo "Saved a new key as profile '$PROFILE'. Set BRIDGE_AWS_PROFILE=$PROFILE in .env, then restart the bridge."
