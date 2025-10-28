"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tokenService_1 = require("../services/tokenService");
const auth_1 = require("../middleware/auth");
const router = express_1.Router();
// Generate a new token (admin only)
router.post('/generate', auth_1.authenticateAdmin, async (req, res) => {
    const { name, expiresInDays, scopes } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Token name is required' });
    }
    try {
        const availableScopes = new Set(tokenService_1.tokenService.getAvailableScopes());
        availableScopes.add('ALL');
        let resolvedScopes;
        if (Array.isArray(scopes)) {
            const invalidScope = scopes.find((scope) => typeof scope !== 'string' || !availableScopes.has(scope));
            if (invalidScope) {
                return res.status(400).json({ error: `Invalid scope provided: ${invalidScope}` });
            }
            resolvedScopes = scopes;
        }
        else if (typeof scopes === 'string') {
            if (!availableScopes.has(scopes)) {
                return res.status(400).json({ error: `Invalid scope provided: ${scopes}` });
            }
            resolvedScopes = [scopes];
        }
        const token = await tokenService_1.tokenService.generateToken(name, expiresInDays, resolvedScopes);
        res.json({
            success: true,
            token,
        });
    }
    catch (error) {
        console.error('Failed to generate token:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
});
// List all tokens (admin only)
router.get('/list', auth_1.authenticateAdmin, async (req, res) => {
    try {
        const tokens = await tokenService_1.tokenService.getAllTokens();
        res.json({ tokens });
    }
    catch (error) {
        console.error('Failed to list tokens:', error);
        res.status(500).json({ error: 'Failed to list tokens' });
    }
});
// Revoke a token (admin only)
router.post('/revoke', auth_1.authenticateAdmin, async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ error: 'Token is required' });
    }
    try {
        const success = await tokenService_1.tokenService.revokeToken(token);
        res.json({ success });
    }
    catch (error) {
        console.error('Failed to revoke token:', error);
        res.status(500).json({ error: 'Failed to revoke token' });
    }
});
// Revoke a token (admin only, RESTful)
router.delete('/:token', auth_1.authenticateAdmin, async (req, res) => {
    const { token } = req.params;
    if (!token) {
        return res.status(400).json({ error: 'Token is required' });
    }
    try {
        const success = await tokenService_1.tokenService.revokeToken(token);
        if (!success) {
            return res.status(404).json({ error: 'Token not found' });
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('Failed to revoke token:', error);
        res.status(500).json({ error: 'Failed to revoke token' });
    }
});
// Validate a token
router.post('/validate', async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ error: 'Token is required' });
    }
    try {
        const isValid = await tokenService_1.tokenService.validateToken(token);
        res.json({ valid: isValid });
    }
    catch (error) {
        console.error('Failed to validate token:', error);
        res.status(500).json({ error: 'Failed to validate token' });
    }
});
exports.default = router;
router.get('/scopes', auth_1.authenticateAdmin, (req, res) => {
    res.json({ scopes: tokenService_1.tokenService.getAvailableScopes() });
});
