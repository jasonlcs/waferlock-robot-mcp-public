import { S3Client } from '@aws-sdk/client-s3';

const awsAccessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const awsSecretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const awsRegion = (process.env.AWS_REGION || 'us-east-1').trim();

const isAccessKeyValid = Boolean(
  awsAccessKeyId &&
  awsAccessKeyId !== 'your_access_key_id'
);

const isSecretKeyValid = Boolean(
  awsSecretAccessKey &&
  awsSecretAccessKey !== 'your_secret_access_key'
);

if (!isAccessKeyValid || !isSecretKeyValid) {
  console.error('⚠️  WARNING: AWS credentials are not properly configured!');
  console.error(
    `Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your environment (Access Key: ${
      isAccessKeyValid ? 'SET' : 'NOT SET'
    }, Secret Key: ${isSecretKeyValid ? 'SET' : 'NOT SET'})`
  );
} else {
  console.log(
    `✓ AWS credentials configured (Region: ${awsRegion}, Access Key prefix: ${awsAccessKeyId.substring(
      0,
      4
    )}...)`
  );
}

export const hasAwsCredentials = isAccessKeyValid && isSecretKeyValid;

export const s3Client = new S3Client({
  region: awsRegion,
  credentials: hasAwsCredentials
    ? {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
      }
    : undefined,
});

export const s3BucketName = (process.env.S3_BUCKET_NAME || 'waferlock-manuals').trim();

export const s3MetadataPrefix = process.env.S3_METADATA_PREFIX
  ? process.env.S3_METADATA_PREFIX.replace(/\/$/, '')
  : 'metadata';

export const s3Region = awsRegion;
