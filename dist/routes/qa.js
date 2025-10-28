"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const qaService_1 = require("../services/qaService");
const types_1 = require("../types");
const auth_1 = require("../middleware/auth");
const router = express_1.Router();
const upload = multer_1.default({ storage: multer_1.default.memoryStorage() });
function serialiseEntry(entry) {
    return {
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
    };
}
function toOptionalString(value) {
    if (Array.isArray(value)) {
        const first = value[0];
        return typeof first === 'string' ? first : undefined;
    }
    return typeof value === 'string' ? value : undefined;
}
router.get('/', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.QaRead, types_1.TokenScope.QaManage, types_1.TokenScope.McpAccess), async (req, res) => {
    try {
        const category = toOptionalString(req.query.category);
        const search = toOptionalString(req.query.search);
        const entries = await qaService_1.qaService.listEntries({ category, search });
        res.json({ entries: entries.map(serialiseEntry) });
    }
    catch (error) {
        console.error('Failed to list QA entries:', error);
        res.status(500).json({ error: 'Failed to list QA entries' });
    }
});
router.get('/export', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.QaRead, types_1.TokenScope.QaManage, types_1.TokenScope.McpAccess), async (req, res) => {
    try {
        const buffer = await qaService_1.qaService.exportEntriesAsXlsx();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="qa-entries-${timestamp}.xlsx"`);
        res.send(buffer);
    }
    catch (error) {
        console.error('Failed to export QA entries:', error);
        res.status(500).json({ error: 'Failed to export QA entries' });
    }
});
router.post('/import', auth_1.authenticateToken, auth_1.requireAllScopes(types_1.TokenScope.QaManage), upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    try {
        const result = await qaService_1.qaService.importEntriesFromXlsx(req.file.buffer);
        res.json({ result });
    }
    catch (error) {
        console.error('Failed to import QA entries:', error);
        res.status(500).json({ error: 'Failed to import QA entries' });
    }
});
router.get('/:id', auth_1.authenticateToken, auth_1.requireAnyScope(types_1.TokenScope.QaRead, types_1.TokenScope.QaManage, types_1.TokenScope.McpAccess), async (req, res) => {
    try {
        const entry = await qaService_1.qaService.getEntryById(req.params.id);
        if (!entry) {
            return res.status(404).json({ error: 'QA entry not found' });
        }
        res.json({ entry: serialiseEntry(entry) });
    }
    catch (error) {
        console.error('Failed to fetch QA entry:', error);
        res.status(500).json({ error: 'Failed to fetch QA entry' });
    }
});
router.post('/', auth_1.authenticateToken, auth_1.requireAllScopes(types_1.TokenScope.QaManage), async (req, res) => {
    const { category, question, answer } = req.body ?? {};
    if (!category || !question || !answer) {
        return res.status(400).json({ error: 'Category, question, and answer are required' });
    }
    try {
        const entry = await qaService_1.qaService.createEntry({ category, question, answer });
        res.status(201).json({ entry: serialiseEntry(entry) });
    }
    catch (error) {
        console.error('Failed to create QA entry:', error);
        res.status(500).json({ error: 'Failed to create QA entry' });
    }
});
router.put('/:id', auth_1.authenticateToken, auth_1.requireAllScopes(types_1.TokenScope.QaManage), async (req, res) => {
    const { category, question, answer } = req.body ?? {};
    if (!category && !question && !answer) {
        return res.status(400).json({ error: 'At least one field (category, question, answer) must be provided' });
    }
    try {
        const entry = await qaService_1.qaService.updateEntry(req.params.id, { category, question, answer });
        if (!entry) {
            return res.status(404).json({ error: 'QA entry not found' });
        }
        res.json({ entry: serialiseEntry(entry) });
    }
    catch (error) {
        console.error('Failed to update QA entry:', error);
        res.status(500).json({ error: 'Failed to update QA entry' });
    }
});
router.delete('/:id', auth_1.authenticateToken, auth_1.requireAllScopes(types_1.TokenScope.QaManage), async (req, res) => {
    try {
        const deleted = await qaService_1.qaService.deleteEntry(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'QA entry not found' });
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('Failed to delete QA entry:', error);
        res.status(500).json({ error: 'Failed to delete QA entry' });
    }
});
exports.default = router;
