"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.s3Region = exports.s3MetadataPrefix = exports.s3BucketName = exports.s3Client = exports.hasAwsCredentials = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const awsAccessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const awsSecretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const awsRegion = (process.env.AWS_REGION || 'us-east-1').trim();
const isAccessKeyValid = Boolean(awsAccessKeyId &&
    awsAccessKeyId !== 'your_access_key_id');
const isSecretKeyValid = Boolean(awsSecretAccessKey &&
    awsSecretAccessKey !== 'your_secret_access_key');
if (!isAccessKeyValid || !isSecretKeyValid) {
    console.error('⚠️  WARNING: AWS credentials are not properly configured!');
    console.error(`Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your environment (Access Key: ${isAccessKeyValid ? 'SET' : 'NOT SET'}, Secret Key: ${isSecretKeyValid ? 'SET' : 'NOT SET'})`);
}
else {
    console.log(`✓ AWS credentials configured (Region: ${awsRegion}, Access Key prefix: ${awsAccessKeyId.substring(0, 4)}...)`);
}
exports.hasAwsCredentials = isAccessKeyValid && isSecretKeyValid;
exports.s3Client = new client_s3_1.S3Client({
    region: awsRegion,
    credentials: exports.hasAwsCredentials
        ? {
            accessKeyId: awsAccessKeyId,
            secretAccessKey: awsSecretAccessKey,
        }
        : undefined,
});
exports.s3BucketName = (process.env.S3_BUCKET_NAME || 'waferlock-manuals').trim();
exports.s3MetadataPrefix = process.env.S3_METADATA_PREFIX
    ? process.env.S3_METADATA_PREFIX.replace(/\/$/, '')
    : 'metadata';
exports.s3Region = awsRegion;
