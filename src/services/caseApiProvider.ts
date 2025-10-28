/**
 * Case API Provider - HTTP API wrapper for case management
 */

export interface CaseApiProvider {
  createCase(data: any): Promise<any>;
  getCase(caseId: string): Promise<any>;
  updateCase(caseId: string, updates: any): Promise<any>;
  searchCases(params: any): Promise<any[]>;
  closeCase(caseId: string, resolutionSummary?: string): Promise<any>;
  getCaseStatistics(timeframe?: string): Promise<any>;
  findSimilarCases(description: string, limit?: number): Promise<any[]>;
  analyzeResolutionTrends(timeframe?: string): Promise<any>;
}

export function createCaseApiProvider(apiUrl: string, apiToken: string): CaseApiProvider {
  const baseUrl = apiUrl.replace(/\/$/, '');

  if (!apiToken) {
    throw new Error('API token is required to initialise the Case API provider');
  }

  async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
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

    return response.json() as Promise<T>;
  }

  return {
    async createCase(data: any) {
      return apiRequest('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    async getCase(caseId: string) {
      return apiRequest(`/api/cases/${encodeURIComponent(caseId)}`);
    },

    async updateCase(caseId: string, updates: any) {
      return apiRequest(`/api/cases/${encodeURIComponent(caseId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    },

    async searchCases(params: any) {
      const data = await apiRequest<{ cases: any[] }>('/api/cases/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return data.cases;
    },

    async closeCase(caseId: string, resolutionSummary?: string) {
      return apiRequest(`/api/cases/${encodeURIComponent(caseId)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_summary: resolutionSummary }),
      });
    },

    async getCaseStatistics(timeframe?: string) {
      const params = timeframe ? `?timeframe=${encodeURIComponent(timeframe)}` : '';
      return apiRequest(`/api/cases/stats/overview${params}`);
    },

    async findSimilarCases(description: string, limit?: number) {
      const data = await apiRequest<{ similar_cases: any[] }>('/api/recommendations/similar-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, limit }),
      });
      return data.similar_cases;
    },

    async analyzeResolutionTrends(timeframe?: string) {
      const params = timeframe ? `?timeframe=${encodeURIComponent(timeframe)}` : '';
      return apiRequest(`/api/statistics/resolution-trends${params}`);
    },
  };
}
