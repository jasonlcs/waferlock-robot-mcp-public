"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkLambdaHealth = exports.triggerPdfIndexing = void 0;
const client_lambda_1 = require("@aws-sdk/client-lambda");
const lambda = new client_lambda_1.LambdaClient({
    region: process.env.AWS_REGION || 'ap-northeast-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});
/**
 * 觸發 Lambda 進行 PDF 索引處理
 */
async function triggerPdfIndexing(fileId, fileName) {
    const functionName = process.env.LAMBDA_FUNCTION_NAME || 'pdf-indexing';
    try {
        console.log(`Triggering Lambda ${functionName} for ${fileName} (${fileId})`);
        const payload = {
            fileId,
            fileName,
        };
        const command = new client_lambda_1.InvokeCommand({
            FunctionName: functionName,
            InvocationType: 'Event',
            Payload: JSON.stringify(payload),
        });
        const response = await lambda.send(command);
        if (response.StatusCode === 202) {
            console.log(`Lambda invoked successfully. RequestId: ${response.$metadata.requestId}`);
            return {
                success: true,
                requestId: response.$metadata.requestId,
            };
        }
        else {
            console.error(`Lambda invocation failed with status: ${response.StatusCode}`);
            return {
                success: false,
                error: `Unexpected status code: ${response.StatusCode}`,
            };
        }
    }
    catch (error) {
        console.error(`Failed to invoke Lambda:`, error);
        return {
            success: false,
            error: error.message || String(error),
        };
    }
}
exports.triggerPdfIndexing = triggerPdfIndexing;
/**
 * 檢查 Lambda 是否可用
 */
async function checkLambdaHealth() {
    try {
        const command = new client_lambda_1.InvokeCommand({
            FunctionName: process.env.LAMBDA_FUNCTION_NAME || 'pdf-indexing',
            InvocationType: 'DryRun', // 只驗證權限，不實際執行
        });
        await lambda.send(command);
        return true;
    }
    catch (error) {
        // DryRun 會返回錯誤，但如果是權限問題會有特定錯誤碼
        if (error.name === 'ResourceNotFoundException') {
            console.error('Lambda function not found');
            return false;
        }
        // 其他錯誤可能是正常的 (DryRun 的預期行為)
        return true;
    }
}
exports.checkLambdaHealth = checkLambdaHealth;
