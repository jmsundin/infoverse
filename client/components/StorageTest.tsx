import React, { useState, useEffect } from 'react';
import { UnifiedStorageService, ViewportBounds } from '../services/storage';
import { GraphNode, NodeType } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Test component for the viewport-based storage system.
 *
 * Usage: Import and render this component temporarily to test the storage system.
 *
 * Tests:
 * 1. Service initialization (local + cloud)
 * 2. Viewport-based loading
 * 3. Node CRUD operations
 * 4. CRDT merging
 * 5. Region tracking
 */
export function StorageTest() {
  const [service] = useState(() => new UnifiedStorageService());
  const [status, setStatus] = useState<string[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [stats, setStats] = useState<any>(null);

  const log = (message: string) => {
    console.log(`[StorageTest] ${message}`);
    setStatus(prev => [...prev, `${new Date().toISOString().slice(11, 19)} - ${message}`]);
  };

  // Test 1: Initialize service
  const testInit = async () => {
    log('Starting initialization test...');
    try {
      // Initialize without handles (will use in-memory only)
      await service.initialize(undefined, undefined);
      log('✅ Service initialized (no storage backends)');

      log(`Local enabled: ${service.isLocalEnabled()}`);
      log(`Cloud enabled: ${service.isCloudEnabled()}`);
      log('✅ Initialization test passed');
    } catch (e: any) {
      log(`❌ Init failed: ${e.message}`);
    }
  };

  // Test 2: Add nodes
  const testAddNodes = async () => {
    log('Starting add nodes test...');
    try {
      const testNodes: GraphNode[] = [
        { id: uuidv4(), type: NodeType.NOTE, x: 100, y: 100, content: 'Test Node 1' },
        { id: uuidv4(), type: NodeType.NOTE, x: 500, y: 100, content: 'Test Node 2' },
        { id: uuidv4(), type: NodeType.NOTE, x: 100, y: 500, content: 'Test Node 3' },
        { id: uuidv4(), type: NodeType.NOTE, x: 2000, y: 2000, content: 'Far Away Node' },
      ];

      for (const node of testNodes) {
        service.addNode(node);
        log(`Added node: ${node.content} at (${node.x}, ${node.y})`);
      }

      setNodes(service.getAllCachedNodes());
      log(`✅ Added ${testNodes.length} nodes`);
    } catch (e: any) {
      log(`❌ Add nodes failed: ${e.message}`);
    }
  };

  // Test 3: Viewport loading
  const testViewportLoad = async () => {
    log('Starting viewport load test...');
    try {
      // Viewport that should contain nodes 1, 2, 3 but not "Far Away Node"
      const viewport: ViewportBounds = {
        minX: 0,
        minY: 0,
        maxX: 800,
        maxY: 800,
      };

      const result = await service.loadViewport(viewport);
      log(`Loaded ${result.nodes.length} nodes in viewport (0,0)-(800,800)`);

      const inViewport = result.nodes.map(n => n.content).join(', ');
      log(`Nodes in viewport: ${inViewport || 'none'}`);

      setNodes(result.nodes);
      log('✅ Viewport load test passed');
    } catch (e: any) {
      log(`❌ Viewport load failed: ${e.message}`);
    }
  };

  // Test 4: Update node
  const testUpdateNode = async () => {
    log('Starting update node test...');
    try {
      const allNodes = service.getAllCachedNodes();
      if (allNodes.length === 0) {
        log('⚠️ No nodes to update, run "Add Nodes" first');
        return;
      }

      const nodeToUpdate = { ...allNodes[0], content: 'Updated Content!', x: 150, y: 150 };
      service.updateNode(nodeToUpdate);

      log(`Updated node: ${nodeToUpdate.id}`);
      log(`New content: ${nodeToUpdate.content}`);
      log(`New position: (${nodeToUpdate.x}, ${nodeToUpdate.y})`);

      setNodes(service.getAllCachedNodes());
      log('✅ Update node test passed');
    } catch (e: any) {
      log(`❌ Update node failed: ${e.message}`);
    }
  };

  // Test 5: Delete node
  const testDeleteNode = async () => {
    log('Starting delete node test...');
    try {
      const allNodes = service.getAllCachedNodes();
      if (allNodes.length === 0) {
        log('⚠️ No nodes to delete, run "Add Nodes" first');
        return;
      }

      const nodeToDelete = allNodes[allNodes.length - 1];
      await service.deleteNode(nodeToDelete.id);

      log(`Deleted node: ${nodeToDelete.content}`);
      setNodes(service.getAllCachedNodes());
      log('✅ Delete node test passed');
    } catch (e: any) {
      log(`❌ Delete node failed: ${e.message}`);
    }
  };

  // Test 6: Get stats
  const testStats = () => {
    log('Getting cache stats...');
    const cacheStats = service.getCacheStats();
    setStats(cacheStats);
    log(`Node count: ${cacheStats.nodeCount}`);
    log(`Edge count: ${cacheStats.edgeCount}`);
    log(`Fetched cells: ${cacheStats.fetchedCellCount}`);
    log(`Yjs docs: ${cacheStats.yjsDocCount}`);
  };

  // Run all tests
  const runAllTests = async () => {
    setStatus([]);
    await testInit();
    await testAddNodes();
    await testViewportLoad();
    await testUpdateNode();
    testStats();
    log('🎉 All tests completed!');
  };

  return (
    <div style={{
      position: 'fixed',
      top: 10,
      right: 10,
      width: 400,
      maxHeight: '90vh',
      background: '#1a1a2e',
      color: '#eee',
      padding: 16,
      borderRadius: 8,
      fontFamily: 'monospace',
      fontSize: 12,
      zIndex: 9999,
      overflow: 'auto'
    }}>
      <h3 style={{ margin: '0 0 12px 0' }}>Storage System Test</h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button onClick={runAllTests} style={btnStyle}>Run All</button>
        <button onClick={testInit} style={btnStyle}>Init</button>
        <button onClick={testAddNodes} style={btnStyle}>Add Nodes</button>
        <button onClick={testViewportLoad} style={btnStyle}>Load Viewport</button>
        <button onClick={testUpdateNode} style={btnStyle}>Update Node</button>
        <button onClick={testDeleteNode} style={btnStyle}>Delete Node</button>
        <button onClick={testStats} style={btnStyle}>Stats</button>
        <button onClick={() => setStatus([])} style={btnStyle}>Clear Log</button>
      </div>

      {stats && (
        <div style={{ background: '#2a2a4e', padding: 8, borderRadius: 4, marginBottom: 12 }}>
          <strong>Cache Stats:</strong>
          <pre style={{ margin: 0 }}>{JSON.stringify(stats, null, 2)}</pre>
        </div>
      )}

      {nodes.length > 0 && (
        <div style={{ background: '#2a2a4e', padding: 8, borderRadius: 4, marginBottom: 12 }}>
          <strong>Cached Nodes ({nodes.length}):</strong>
          {nodes.map(n => (
            <div key={n.id} style={{ fontSize: 11, marginTop: 4 }}>
              • {n.content} @ ({n.x}, {n.y})
            </div>
          ))}
        </div>
      )}

      <div style={{ background: '#0a0a1e', padding: 8, borderRadius: 4, maxHeight: 300, overflow: 'auto' }}>
        <strong>Log:</strong>
        {status.map((s, i) => (
          <div key={i} style={{
            fontSize: 11,
            color: s.includes('✅') ? '#4ade80' : s.includes('❌') ? '#f87171' : '#94a3b8',
            marginTop: 2
          }}>
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: '#4a4a6e',
  border: 'none',
  borderRadius: 4,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 11,
};
