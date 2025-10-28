"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_TOKEN_SCOPES = exports.TokenScope = void 0;
var TokenScope;
(function (TokenScope) {
    TokenScope["FilesRead"] = "files:read";
    TokenScope["FilesWrite"] = "files:write";
    TokenScope["McpAccess"] = "mcp:access";
    TokenScope["QaRead"] = "qa:read";
    TokenScope["QaManage"] = "qa:manage";
})(TokenScope = exports.TokenScope || (exports.TokenScope = {}));
exports.ALL_TOKEN_SCOPES = [
    TokenScope.FilesRead,
    TokenScope.FilesWrite,
    TokenScope.McpAccess,
    TokenScope.QaRead,
    TokenScope.QaManage,
];
