"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createS3ManualProvider = createS3ManualProvider;
/**
 * Public CLI 目前不支援直接存取 S3，因此提供退回錯誤的預設實作，
 * 避免在沒有 API provider 的情況下呼叫而造成不可預期行為。
 */
function createS3ManualProvider() {
    const unsupported = async () => {
        throw new Error('S3 manual provider is not available in waferlock-robot-mcp-public.');
    };
    return {
        listManuals: unsupported,
        getManualById: unsupported,
        getManualDownloadUrl: unsupported,
        getManualContent: unsupported,
    };
}
