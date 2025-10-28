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
 * @route POST /api/recommendations/solutions
 * @desc Get AI-recommended Q&A solutions based on user query
 */
router.post('/solutions', async (req, res) => {
    try {
        const { query, limit = 5 } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        // Use existing search method
        const results = await qaService_1.qaService.searchEntries(query);
        const recommendations = results.slice(0, limit).map(entry => ({
            id: entry.id,
            question: entry.question,
            answer: entry.answer,
            category: entry.category,
            relevance: 'high' // Placeholder
        }));
        res.json({ recommendations });
    }
    catch (error) {
        console.error('Error recommending solutions:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * @route POST /api/recommendations/manuals
 * @desc Suggest relevant manuals based on query
 */
router.post('/manuals', async (req, res) => {
    try {
        const { query, limit = 3 } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        // TODO: Implement manual suggestion logic
        const suggestions = [];
        res.json({ suggestions });
    }
    catch (error) {
        console.error('Error suggesting manuals:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * @route POST /api/recommendations/similar-cases
 * @desc Find similar historical cases
 */
router.post('/similar-cases', async (req, res) => {
    try {
        const { description, limit = 5 } = req.body;
        if (!description) {
            return res.status(400).json({ error: 'Description is required' });
        }
        // Use existing search with description
        const allCases = await caseService_1.caseService.searchCases({ limit: 100 });
        const similarCases = allCases.slice(0, limit).map(c => ({
            id: c.id,
            description: c.description,
            status: c.status,
            resolution: c.resolution,
            similarity: 0.85 // Placeholder
        }));
        res.json({ similar_cases: similarCases });
    }
    catch (error) {
        console.error('Error finding similar cases:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
