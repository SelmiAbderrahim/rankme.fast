/**
 * Post-model contract for `cluster_labels`.
 *
 * The AI may NAME a cluster and nothing else. Membership, ordering, size, and
 * evidence are already frozen by the deterministic pass, and the profile's
 * output schema carries no field that could express them — so the only attacks
 * left are an unknown cluster id, a repeated cluster id, and an over-long
 * label. Any of those rejects the WHOLE response; the run then completes
 * unlabeled rather than partially trusting the model.
 */
import { clusterLabelsAiOutputSchema, type ClusterLabelsAiOutput, } from '../../shared/ai-profiles/index.js';
import { KEYWORD_CLUSTER_MAX_LABEL_CODE_POINTS, codePointLength, keywordClusterSetSchema, type KeywordCluster, } from './keyword-clusters.schemas.js';
export class KeywordClusterAiOutputContractError extends Error {
    constructor() {
        super('cluster_labels_ai_output_rejected');
        this.name = 'KeywordClusterAiOutputContractError';
    }
}
/**
 * Reject the complete hostile output; never partially trust it. A returned
 * value means every row names a distinct cluster that was actually sent.
 */
export function validateClusterLabelsAiOutput(raw: unknown, clusters: readonly KeywordCluster[]): ClusterLabelsAiOutput {
    const parsed = clusterLabelsAiOutputSchema.safeParse(raw);
    if (!parsed.success)
        throw new KeywordClusterAiOutputContractError();
    const known = new Set(clusters.map((cluster) => cluster.id));
    const seen = new Set<string>();
    for (const row of parsed.data.labels) {
        if (!known.has(row.clusterId) ||
            seen.has(row.clusterId) ||
            codePointLength(row.label) > KEYWORD_CLUSTER_MAX_LABEL_CODE_POINTS) {
            throw new KeywordClusterAiOutputContractError();
        }
        seen.add(row.clusterId);
    }
    return parsed.data;
}
/**
 * Attach accepted labels. Every other field of every cluster is copied through
 * untouched, so a label can never move, add, or drop a keyword — the
 * membership invariant `keyword-clusters.ai-contract.test.ts` pins by
 * byte-comparing the cluster array before and after.
 */
export function applyClusterLabelsAiOutput(output: ClusterLabelsAiOutput, clusters: readonly KeywordCluster[]): KeywordCluster[] {
    const labels = new Map(output.labels.map((row) => [row.clusterId, row.label] as const));
    return keywordClusterSetSchema.parse(clusters.map((cluster) => {
        const label = labels.get(cluster.id);
        if (label === undefined)
            return cluster;
        return { ...cluster, label, labelSource: 'ai' as const };
    }));
}
