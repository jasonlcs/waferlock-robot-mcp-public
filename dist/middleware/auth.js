"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAnyScope = exports.requireAllScopes = exports.authenticateAdmin = exports.authenticateToken = void 0;
const tokenService_1 = require("../services/tokenService");
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    try {
        const tokenRecord = await tokenService_1.tokenService.getActiveToken(token);
        if (!tokenRecord) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        res.locals.authToken = tokenRecord;
    }
    catch (error) {
        console.error('Token validation failed:', error);
        return res.status(500).json({ error: 'Token validation failed' });
    }
    next();
};
exports.authenticateToken = authenticateToken;
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Admin authentication required' });
    }
    next();
};
exports.authenticateAdmin = authenticateAdmin;
function getAuthenticatedToken(res) {
    return res.locals.authToken;
}
function requireAllScopes(...scopes) {
    return (req, res, next) => {
        const token = getAuthenticatedToken(res);
        if (!token) {
            return res.status(500).json({ error: 'Token context missing. Ensure authenticateToken runs first.' });
        }
        if (!tokenService_1.tokenService.tokenHasAllScopes(token, scopes)) {
            return res.status(403).json({ error: 'Token does not have the required permissions' });
        }
        next();
    };
}
exports.requireAllScopes = requireAllScopes;
function requireAnyScope(...scopes) {
    return (req, res, next) => {
        const token = getAuthenticatedToken(res);
        if (!token) {
            return res.status(500).json({ error: 'Token context missing. Ensure authenticateToken runs first.' });
        }
        if (!tokenService_1.tokenService.tokenHasAnyScope(token, scopes)) {
            return res.status(403).json({ error: 'Token does not have the required permissions' });
        }
        next();
    };
}
exports.requireAnyScope = requireAnyScope;
