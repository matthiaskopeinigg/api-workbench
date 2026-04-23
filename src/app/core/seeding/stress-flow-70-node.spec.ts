import {
  buildSeventyNodeStressFlowArtifact,
  stressFlowEdgeCount,
  stressFlowNodeCount,
} from './stress-flow-70-node';

describe('buildSeventyNodeStressFlowArtifact', () => {
  it('builds a linear flow with at least 70 nodes and connected edges', () => {
    const f = buildSeventyNodeStressFlowArtifact('test-flow-id', 1);
    expect(stressFlowNodeCount(f)).toBeGreaterThanOrEqual(70);
    expect(f.nodes[0]!.kind).toBe('start');
    expect(f.nodes[f.nodes.length - 1]!.kind).toBe('terminate');
    expect(stressFlowEdgeCount(f)).toBe(f.nodes.length - 1);
    const ids = new Set(f.nodes.map((n) => n.id));
    for (const e of f.edges) {
      expect(ids.has(e.fromNodeId)).toBeTrue();
      expect(ids.has(e.toNodeId)).toBeTrue();
    }
  });
});
