/**
 * Customer Case Management Types
 */

export type CaseStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type CasePriority = 'low' | 'medium' | 'high' | 'urgent';

export interface CaseEvent {
  id: string;
  timestamp: Date;
  type: 'created' | 'updated' | 'status_changed' | 'assigned' | 'comment' | 'resolved' | 'closed';
  actor: string;
  description: string;
  metadata?: Record<string, any>;
}

export interface CustomerCase {
  id: string;
  customerId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  deviceModel?: string;
  deviceSerial?: string;
  issueCategory: string;
  subject: string;
  description: string;
  status: CaseStatus;
  priority: CasePriority;
  assignedTo?: string;
  relatedManuals: string[];
  relatedQA: string[];
  timeline: CaseEvent[];
  resolution?: string;
  resolutionTime?: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  tags?: string[];
  internalNotes?: string;
}

export interface CreateCaseRequest {
  customerId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  deviceModel?: string;
  deviceSerial?: string;
  issueCategory: string;
  subject: string;
  description: string;
  priority?: CasePriority;
  assignedTo?: string;
  tags?: string[];
}

export interface UpdateCaseRequest {
  status?: CaseStatus;
  priority?: CasePriority;
  assignedTo?: string;
  description?: string;
  resolution?: string;
  relatedManuals?: string[];
  relatedQA?: string[];
  tags?: string[];
  internalNotes?: string;
  comment?: string;
}

export interface SearchCasesRequest {
  customerId?: string;
  deviceModel?: string;
  status?: CaseStatus;
  priority?: CasePriority;
  issueCategory?: string;
  assignedTo?: string;
  tags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  keyword?: string;
  limit?: number;
  offset?: number;
}
