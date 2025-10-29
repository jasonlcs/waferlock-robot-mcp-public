"use strict";
/**
 * Case API Provider - HTTP API wrapper for case management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCaseApiProvider = createCaseApiProvider;
function createCaseApiProvider(apiUrl, apiToken) {
    const baseUrl = apiUrl.replace(/\/$/, '');
    if (!apiToken) {
        throw new Error('API token is required to initialise the Case API provider');
    }
    async function apiRequest(path, init) {
        const response = await fetch(`${baseUrl}${path}`, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${apiToken}`,
                ...(init?.headers ?? {}),
            },
            ...init,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Case API request failed (${response.status} ${response.statusText}): ${text}`);
        }
        return response.json();
    }
    return {
        async createCase(data) {
            return apiRequest('/api/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
        },
        async getCase(caseId) {
            return apiRequest(`/api/cases/${encodeURIComponent(caseId)}`);
        },
        async updateCase(caseId, updates) {
            return apiRequest(`/api/cases/${encodeURIComponent(caseId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
        },
        async searchCases(params) {
            const data = await apiRequest('/api/cases/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });
            return data.cases;
        },
        async closeCase(caseId, resolutionSummary) {
            return apiRequest(`/api/cases/${encodeURIComponent(caseId)}/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolution_summary: resolutionSummary }),
            });
        },
        async getCaseStatistics(timeframe) {
            const params = timeframe ? `?timeframe=${encodeURIComponent(timeframe)}` : '';
            return apiRequest(`/api/cases/stats/overview${params}`);
        },
        async findSimilarCases(description, limit) {
            const data = await apiRequest('/api/recommendations/similar-cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description, limit }),
            });
            return data.similar_cases;
        },
        async analyzeResolutionTrends(timeframe) {
            const params = timeframe ? `?timeframe=${encodeURIComponent(timeframe)}` : '';
            return apiRequest(`/api/statistics/resolution-trends${params}`);
        },
    };
}
