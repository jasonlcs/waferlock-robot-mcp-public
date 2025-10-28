"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const qaService_1 = require("../services/qaService");
const caseService_1 = require("../services/caseService");
const router = express_1.default.Router();
/**
 * @route GET /api/statistics/qa
 * @desc Get Q&A knowledge base statistics
 */
router.get('/qa', async (req, res) => {
    try {
        const allEntries = await qaService_1.qaService.listEntries();
        const stats = {
            total_entries: allEntries.length,
            categories: [...new Set(allEntries.map(e => e.category))].length,
            last_updated: allEntries.reduce((latest, e) => e.updatedAt > latest ? e.updatedAt : latest, allEntries[0]?.updatedAt || new Date())
        };
        res.json(stats);
    }
    catch (error) {
        console.error('Error getting Q&A statistics:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * @route GET /api/statistics/common-issues
 * @desc Get most common issues
 */
router.get('/common-issues', async (req, res) => {
    try {
        const { timeframe = '30d', limit = 10 } = req.query;
        // Get all cases and count by category
        const allCases = await caseService_1.caseService.searchCases({ limit: 1000 });
        const categoryCounts = {};
        allCases.forEach(c => {
            categoryCounts[c.issueCategory] = (categoryCounts[c.issueCategory] || 0) + 1;
        });
        const commonIssues = Object.entries(categoryCounts)
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, parseInt(limit));
        res.json({ common_issues: commonIssues });
    }
    catch (error) {
        console.error('Error getting common issues:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * @route GET /api/statistics/resolution-trends
 * @desc Analyze case resolution trends
 */
router.get('/resolution-trends', async (req, res) => {
    try {
        const { timeframe = '30d' } = req.query;
        const allCases = await caseService_1.caseService.searchCases({ limit: 1000 });
        const resolvedCases = allCases.filter(c => c.status === 'resolved' || c.status === 'closed');
        const avgResolutionTime = resolvedCases.reduce((sum, c) => sum + (c.resolutionTime || 0), 0) / (resolvedCases.length || 1);
        const trends = {
            total_cases: allCases.length,
            resolved_cases: resolvedCases.length,
            resolution_rate: (resolvedCases.length / allCases.length) * 100,
            avg_resolution_time_hours: avgResolutionTime / 3600,
            timeframe
        };
        res.json(trends);
    }
    catch (error) {
        console.error('Error analyzing resolution trends:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
