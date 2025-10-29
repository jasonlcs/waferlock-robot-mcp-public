"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createS3QAProvider = createS3QAProvider;
/**
 * 公開版 CLI 不支援直接連線內部 QA 服務，提供預設的錯誤回應實作。
 */
function createS3QAProvider() {
    const unsupported = async () => {
        throw new Error('S3 QA provider is not available in waferlock-robot-mcp-public.');
    };
    return {
        listEntries: unsupported,
        listQA: unsupported,
        getEntryById: unsupported,
        getQAById: unsupported,
        searchEntries: unsupported,
        intelligentSearch: unsupported,
    };
}
