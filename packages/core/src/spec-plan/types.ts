/** Spec 文档状态 */
export type SpecStatus = 'draft' | 'approved' | 'superseded';

/** Plan 文档状态 */
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'completed';

/** Spec 文档元数据 */
export interface SpecMeta {
  name: string;
  version: number;
  status: SpecStatus;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
}

/** Plan 文档元数据 */
export interface PlanMeta {
  name: string;
  specName: string;
  specVersion: number;
  version: number;
  status: PlanStatus;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
}

/** Spec 文档（元数据 + markdown 正文） */
export interface SpecDocument {
  meta: SpecMeta;
  body: string;
}

/** Plan 文档（元数据 + markdown 正文） */
export interface PlanDocument {
  meta: PlanMeta;
  body: string;
}
