/** SDD（Spec-Driven Development）阶段闸口相关接口。 */
import { get, post } from './http';
import type { SddArtifact } from './types';
import type { SpecGatePhase } from '@ai-agent/common';

/** 拉取指定 feature / 阶段的产物内容，用于预览 */
export function fetchSddArtifact(
  featureId: string,
  phase: SpecGatePhase,
): Promise<SddArtifact> {
  return get<SddArtifact>('/sdd/artifact', { featureId, phase });
}

/** 批准某阶段产物，落库 approvedAt */
export function approveSddPhase(
  featureId: string,
  phase: SpecGatePhase,
): Promise<unknown> {
  return post('/sdd/approve', { featureId, phase });
}
