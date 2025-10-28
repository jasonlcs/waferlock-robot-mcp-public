"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const caseService_1 = require("../services/caseService");
const router = express_1.default.Router();
/**
 * @route POST /api/cases
 * @desc Create a new customer case
 */
router.post('/', async (req, res) => {
    try {
        const { customerId, description, deviceModel, issueCategory, priority } = req.body;
        if (!customerId || !description || !issueCategory) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['customerId', 'description', 'issueCategory']
            });
        }
        const caseData = await caseService_1.caseService.createCase({
            customerId,
            description,
            deviceModel,
            issueCategory,
            subject: description.substring(0, 100),
            priority: priority || 'medium'
        });
        res.json(caseData);
    }
    catch (error) {
        console.error('Error creating case:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * @route GET /api/cases/:caseId
 * @desc Get case details
 */
router.get('/:caseId', async (req, res) => {
    try {
        const { caseId } = req.params;
        const caseData = await caseService_1.caseService.getCase(caseId);
        if (!caseData) {
            return res.status(404).json({ error: 'Case not found' });
        }
        res.json(caseData);
    }
    catch (error) {
        console.error('Error getting case:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * @route PUT /api/cases/:caseId
 * @desc Update case
 */
router.put('/:caseId', async (req, res) => {
    try {
        const { caseId } = req.params;
        const updates = req.body;
        const updatedCase = await caseService_1.caseService.updateCase(caseId, updates);
        if (!updatedCase) {
            return res.status(404).json({ error: 'Case not found' });
        }
        res.json(updatedCase);
    }
    catch (error) {
        console.error('Error updating case:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * @route POST /api/cases/search
 * @desc Search cases
 */
router.post('/search', async (req, res) => {
    try {
        const { status, customerId, limit } = req.body;
        const results = await caseService_1.caseService.searchCases({
            status,
            customerId,
            limit
        });
        res.json({ cases: results });
    }
    catch (error) {
        console.error('Error searching cases:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * @route POST /api/cases/:caseId/close
 * @desc Close a case
 */
router.post('/:caseId/close', async (req, res) => {
    try {
        const { caseId } = req.params;
        const { resolution } = req.body;
        // Update case to resolved status
        const closedCase = await caseService_1.caseService.updateCase(caseId, {
            status: 'resolved',
            resolution
        });
        if (!closedCase) {
            return res.status(404).json({ error: 'Case not found' });
        }
        res.json(closedCase);
    }
    catch (error) {
        console.error('Error closing case:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * @route GET /api/cases/stats/overview
 * @desc Get case statistics
 */
router.get('/stats/overview', async (req, res) => {
    try {
        const stats = await caseService_1.caseService.getStatistics();
        res.json(stats);
    }
    catch (error) {
        console.error('Error getting case statistics:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
