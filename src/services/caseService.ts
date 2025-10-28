import { randomUUID } from 'crypto';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, s3BucketName } from './awsConfig';
import {
  CustomerCase,
  CaseEvent,
  CaseStatus,
  CreateCaseRequest,
  UpdateCaseRequest,
  SearchCasesRequest,
} from '../types/customerCase';

const CASES_S3_PREFIX = 'customer-cases/';
const CASES_INDEX_KEY = 'customer-cases/index.json';

export class CaseService {
  private casesCache: Map<string, CustomerCase> = new Map();
  private cacheLoaded: boolean = false;

  /**
   * Load all cases from S3 into memory cache
   */
  private async loadCases(): Promise<void> {
    if (this.cacheLoaded) return;

    try {
      const getCmd = new GetObjectCommand({
        Bucket: s3BucketName,
        Key: CASES_INDEX_KEY,
      });
      const response = await s3Client.send(getCmd);
      const indexData = await this.streamToBuffer(response.Body);
      const index = JSON.parse(indexData.toString('utf-8'));
      
      for (const caseId of index.cases || []) {
        try {
          const getCaseCmd = new GetObjectCommand({
            Bucket: s3BucketName,
            Key: `${CASES_S3_PREFIX}${caseId}.json`,
          });
          const caseResponse = await s3Client.send(getCaseCmd);
          const caseData = await this.streamToBuffer(caseResponse.Body);
          const customerCase = JSON.parse(caseData.toString('utf-8'));
          
          // Convert date strings back to Date objects
          customerCase.createdAt = new Date(customerCase.createdAt);
          customerCase.updatedAt = new Date(customerCase.updatedAt);
          if (customerCase.closedAt) {
            customerCase.closedAt = new Date(customerCase.closedAt);
          }
          customerCase.timeline = customerCase.timeline.map((event: any) => ({
            ...event,
            timestamp: new Date(event.timestamp),
          }));
          this.casesCache.set(caseId, customerCase);
        } catch (error) {
          console.error(`Failed to load case ${caseId}:`, error);
        }
      }
      this.cacheLoaded = true;
    } catch (error) {
      // Index doesn't exist yet, start fresh
      this.cacheLoaded = true;
    }
  }

  /**
   * Helper: Convert stream to buffer
   */
  private async streamToBuffer(stream: any): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Save a case to S3
   */
  private async saveCase(customerCase: CustomerCase): Promise<void> {
    const caseKey = `${CASES_S3_PREFIX}${customerCase.id}.json`;
    const caseData = JSON.stringify(customerCase, null, 2);

    const putCmd = new PutObjectCommand({
      Bucket: s3BucketName,
      Key: caseKey,
      Body: Buffer.from(caseData, 'utf-8'),
      ContentType: 'application/json',
    });
    await s3Client.send(putCmd);

    // Update index
    await this.updateIndex();
  }

  /**
   * Update the cases index in S3
   */
  private async updateIndex(): Promise<void> {
    const index = {
      cases: Array.from(this.casesCache.keys()),
      updatedAt: new Date().toISOString(),
    };

    const putCmd = new PutObjectCommand({
      Bucket: s3BucketName,
      Key: CASES_INDEX_KEY,
      Body: Buffer.from(JSON.stringify(index, null, 2), 'utf-8'),
      ContentType: 'application/json',
    });
    await s3Client.send(putCmd);
  }

  /**
   * Create a new customer case
   */
  async createCase(request: CreateCaseRequest): Promise<CustomerCase> {
    await this.loadCases();

    const now = new Date();
    const caseId = randomUUID();

    const initialEvent: CaseEvent = {
      id: randomUUID(),
      timestamp: now,
      type: 'created',
      actor: request.assignedTo || 'system',
      description: 'Case created',
      metadata: { request },
    };

    const customerCase: CustomerCase = {
      id: caseId,
      customerId: request.customerId,
      customerName: request.customerName,
      customerEmail: request.customerEmail,
      customerPhone: request.customerPhone,
      deviceModel: request.deviceModel,
      deviceSerial: request.deviceSerial,
      issueCategory: request.issueCategory,
      subject: request.subject,
      description: request.description,
      status: 'open',
      priority: request.priority || 'medium',
      assignedTo: request.assignedTo,
      relatedManuals: [],
      relatedQA: [],
      timeline: [initialEvent],
      createdAt: now,
      updatedAt: now,
      tags: request.tags || [],
    };

    this.casesCache.set(caseId, customerCase);
    await this.saveCase(customerCase);

    return customerCase;
  }

  /**
   * Get a case by ID
   */
  async getCase(caseId: string): Promise<CustomerCase | null> {
    await this.loadCases();
    return this.casesCache.get(caseId) || null;
  }

  /**
   * Update a case
   */
  async updateCase(caseId: string, update: UpdateCaseRequest, actor: string = 'system'): Promise<CustomerCase> {
    await this.loadCases();

    const customerCase = this.casesCache.get(caseId);
    if (!customerCase) {
      throw new Error(`Case ${caseId} not found`);
    }

    const now = new Date();
    const events: CaseEvent[] = [];

    // Track status changes
    if (update.status && update.status !== customerCase.status) {
      events.push({
        id: randomUUID(),
        timestamp: now,
        type: 'status_changed',
        actor,
        description: `Status changed from ${customerCase.status} to ${update.status}`,
        metadata: { oldStatus: customerCase.status, newStatus: update.status },
      });
      customerCase.status = update.status;

      if (update.status === 'closed') {
        customerCase.closedAt = now;
        customerCase.resolutionTime = now.getTime() - customerCase.createdAt.getTime();
      }
    }

    // Track assignment changes
    if (update.assignedTo && update.assignedTo !== customerCase.assignedTo) {
      events.push({
        id: randomUUID(),
        timestamp: now,
        type: 'assigned',
        actor,
        description: `Assigned to ${update.assignedTo}`,
        metadata: { assignedTo: update.assignedTo },
      });
      customerCase.assignedTo = update.assignedTo;
    }

    // Track general updates
    if (update.description || update.priority || update.resolution || update.comment) {
      events.push({
        id: randomUUID(),
        timestamp: now,
        type: 'updated',
        actor,
        description: update.comment || 'Case updated',
        metadata: {
          priority: update.priority,
          hasResolution: !!update.resolution,
        },
      });
    }

    // Apply updates
    if (update.priority) customerCase.priority = update.priority;
    if (update.description) customerCase.description = update.description;
    if (update.resolution) customerCase.resolution = update.resolution;
    if (update.relatedManuals) customerCase.relatedManuals = update.relatedManuals;
    if (update.relatedQA) customerCase.relatedQA = update.relatedQA;
    if (update.tags) customerCase.tags = update.tags;
    if (update.internalNotes) customerCase.internalNotes = update.internalNotes;

    customerCase.timeline.push(...events);
    customerCase.updatedAt = now;

    this.casesCache.set(caseId, customerCase);
    await this.saveCase(customerCase);

    return customerCase;
  }

  /**
   * Search cases with filters
   */
  async searchCases(request: SearchCasesRequest = {}): Promise<CustomerCase[]> {
    await this.loadCases();

    let results = Array.from(this.casesCache.values());

    // Apply filters
    if (request.customerId) {
      results = results.filter(c => c.customerId === request.customerId);
    }
    if (request.deviceModel) {
      results = results.filter(c => c.deviceModel === request.deviceModel);
    }
    if (request.status) {
      results = results.filter(c => c.status === request.status);
    }
    if (request.priority) {
      results = results.filter(c => c.priority === request.priority);
    }
    if (request.issueCategory) {
      results = results.filter(c => c.issueCategory === request.issueCategory);
    }
    if (request.assignedTo) {
      results = results.filter(c => c.assignedTo === request.assignedTo);
    }
    if (request.tags && request.tags.length > 0) {
      results = results.filter(c => 
        request.tags!.some(tag => c.tags?.includes(tag))
      );
    }
    if (request.dateFrom) {
      results = results.filter(c => c.createdAt >= request.dateFrom!);
    }
    if (request.dateTo) {
      results = results.filter(c => c.createdAt <= request.dateTo!);
    }
    if (request.keyword) {
      const keyword = request.keyword.toLowerCase();
      results = results.filter(c => 
        c.subject.toLowerCase().includes(keyword) ||
        c.description.toLowerCase().includes(keyword) ||
        c.resolution?.toLowerCase().includes(keyword)
      );
    }

    // Sort by updatedAt desc
    results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Apply pagination
    const offset = request.offset || 0;
    const limit = request.limit || 50;
    return results.slice(offset, offset + limit);
  }

  /**
   * Delete a case
   */
  async deleteCase(caseId: string): Promise<boolean> {
    await this.loadCases();

    if (!this.casesCache.has(caseId)) {
      return false;
    }

    this.casesCache.delete(caseId);
    
    // Delete from S3
    try {
      const deleteCmd = new DeleteObjectCommand({
        Bucket: s3BucketName,
        Key: `${CASES_S3_PREFIX}${caseId}.json`,
      });
      await s3Client.send(deleteCmd);
      await this.updateIndex();
      return true;
    } catch (error) {
      console.error(`Failed to delete case ${caseId}:`, error);
      return false;
    }
  }

  /**
   * Get case statistics
   */
  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<CaseStatus, number>;
    byPriority: Record<string, number>;
    avgResolutionTime: number;
  }> {
    await this.loadCases();

    const cases = Array.from(this.casesCache.values());
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const c of cases) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      byPriority[c.priority] = (byPriority[c.priority] || 0) + 1;
      
      if (c.resolutionTime) {
        totalResolutionTime += c.resolutionTime;
        resolvedCount++;
      }
    }

    return {
      total: cases.length,
      byStatus: byStatus as Record<CaseStatus, number>,
      byPriority,
      avgResolutionTime: resolvedCount > 0 ? totalResolutionTime / resolvedCount : 0,
    };
  }
}

export const caseService = new CaseService();
