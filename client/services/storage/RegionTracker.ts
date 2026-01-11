import { ViewportBounds, FetchedRegion } from './types';

/**
 * RegionTracker tracks which spatial regions have been fetched from storage.
 * Uses a grid-based system where each cell represents a fixed-size area.
 * This prevents redundant fetches when the user pans around the canvas.
 */
export class RegionTracker {
  private fetchedRegions: Map<string, FetchedRegion> = new Map();
  private gridSize: number;

  constructor(gridSize: number = 1000) {
    this.gridSize = gridSize;
  }

  /**
   * Convert viewport bounds to grid cell keys that it overlaps
   */
  private boundsToGridCells(bounds: ViewportBounds): string[] {
    const cells: string[] = [];

    const minCellX = Math.floor(bounds.minX / this.gridSize);
    const maxCellX = Math.floor(bounds.maxX / this.gridSize);
    const minCellY = Math.floor(bounds.minY / this.gridSize);
    const maxCellY = Math.floor(bounds.maxY / this.gridSize);

    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        cells.push(`${x},${y}`);
      }
    }

    return cells;
  }

  /**
   * Get the bounds of a grid cell
   */
  private cellToBounds(cellKey: string): ViewportBounds {
    const [x, y] = cellKey.split(',').map(Number);
    return {
      minX: x * this.gridSize,
      minY: y * this.gridSize,
      maxX: (x + 1) * this.gridSize,
      maxY: (y + 1) * this.gridSize,
    };
  }

  /**
   * Check if all cells in a viewport have been fetched
   */
  isRegionFullyFetched(bounds: ViewportBounds): boolean {
    const cells = this.boundsToGridCells(bounds);
    return cells.every((cell) => this.fetchedRegions.has(cell));
  }

  /**
   * Check if a specific cell has been fetched
   */
  isCellFetched(cellKey: string): boolean {
    return this.fetchedRegions.has(cellKey);
  }

  /**
   * Get grid cells that haven't been fetched yet within the given bounds
   */
  getUnfetchedCells(bounds: ViewportBounds): string[] {
    const cells = this.boundsToGridCells(bounds);
    return cells.filter((cell) => !this.fetchedRegions.has(cell));
  }

  /**
   * Get unfetched regions as ViewportBounds (merged where possible)
   */
  getUnfetchedRegions(bounds: ViewportBounds): ViewportBounds[] {
    const unfetchedCells = this.getUnfetchedCells(bounds);
    if (unfetchedCells.length === 0) return [];

    // For simplicity, return individual cell bounds
    // Could optimize with region merging later
    return unfetchedCells.map((cell) => this.cellToBounds(cell));
  }

  /**
   * Get the combined bounds of all unfetched cells
   */
  getUnfetchedBounds(bounds: ViewportBounds): ViewportBounds | null {
    const unfetchedCells = this.getUnfetchedCells(bounds);
    if (unfetchedCells.length === 0) return null;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const cell of unfetchedCells) {
      const cellBounds = this.cellToBounds(cell);
      minX = Math.min(minX, cellBounds.minX);
      minY = Math.min(minY, cellBounds.minY);
      maxX = Math.max(maxX, cellBounds.maxX);
      maxY = Math.max(maxY, cellBounds.maxY);
    }

    return { minX, minY, maxX, maxY };
  }

  /**
   * Mark a region as fetched
   */
  markFetched(
    bounds: ViewportBounds,
    source: 'local' | 'cloud' | 'both',
    nodeIds: Set<string>
  ): void {
    const cells = this.boundsToGridCells(bounds);
    const timestamp = Date.now();

    for (const cellKey of cells) {
      const existing = this.fetchedRegions.get(cellKey);

      if (existing) {
        // Merge node IDs and update source
        const mergedNodeIds = new Set([...existing.nodeIds, ...nodeIds]);
        const mergedSource =
          existing.source === source
            ? source
            : existing.source === 'both' || source === 'both'
            ? 'both'
            : 'both';

        this.fetchedRegions.set(cellKey, {
          cellKey,
          bounds: this.cellToBounds(cellKey),
          timestamp,
          source: mergedSource,
          nodeIds: mergedNodeIds,
        });
      } else {
        this.fetchedRegions.set(cellKey, {
          cellKey,
          bounds: this.cellToBounds(cellKey),
          timestamp,
          source,
          nodeIds: new Set(nodeIds),
        });
      }
    }
  }

  /**
   * Mark specific cells as fetched
   */
  markCellsFetched(
    cellKeys: string[],
    source: 'local' | 'cloud' | 'both',
    nodeIds: Set<string>
  ): void {
    const timestamp = Date.now();

    for (const cellKey of cellKeys) {
      this.fetchedRegions.set(cellKey, {
        cellKey,
        bounds: this.cellToBounds(cellKey),
        timestamp,
        source,
        nodeIds: new Set(nodeIds),
      });
    }
  }

  /**
   * Invalidate a region (e.g., when data changes)
   */
  invalidateRegion(bounds: ViewportBounds): void {
    const cells = this.boundsToGridCells(bounds);
    for (const cell of cells) {
      this.fetchedRegions.delete(cell);
    }
  }

  /**
   * Invalidate a single cell containing a specific point
   */
  invalidatePoint(x: number, y: number): void {
    const cellX = Math.floor(x / this.gridSize);
    const cellY = Math.floor(y / this.gridSize);
    this.fetchedRegions.delete(`${cellX},${cellY}`);
  }

  /**
   * Invalidate all regions
   */
  invalidateAll(): void {
    this.fetchedRegions.clear();
  }

  /**
   * Get all node IDs in a region
   */
  getNodeIdsInRegion(bounds: ViewportBounds): Set<string> {
    const cells = this.boundsToGridCells(bounds);
    const nodeIds = new Set<string>();

    for (const cell of cells) {
      const region = this.fetchedRegions.get(cell);
      if (region) {
        for (const id of region.nodeIds) {
          nodeIds.add(id);
        }
      }
    }

    return nodeIds;
  }

  /**
   * Get region info for a specific cell
   */
  getRegionInfo(cellKey: string): FetchedRegion | undefined {
    return this.fetchedRegions.get(cellKey);
  }

  /**
   * Get all fetched regions (for debugging)
   */
  getAllFetchedRegions(): FetchedRegion[] {
    return Array.from(this.fetchedRegions.values());
  }

  /**
   * Get count of fetched cells
   */
  getFetchedCellCount(): number {
    return this.fetchedRegions.size;
  }

  /**
   * Check if a specific node ID has been fetched in any region
   */
  hasNodeId(nodeId: string): boolean {
    for (const region of this.fetchedRegions.values()) {
      if (region.nodeIds.has(nodeId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove a node ID from all regions (e.g., when deleted)
   */
  removeNodeId(nodeId: string): void {
    for (const region of this.fetchedRegions.values()) {
      region.nodeIds.delete(nodeId);
    }
  }

  /**
   * Update node's region when it moves
   */
  updateNodePosition(
    nodeId: string,
    oldX: number,
    oldY: number,
    newX: number,
    newY: number
  ): void {
    const oldCellX = Math.floor(oldX / this.gridSize);
    const oldCellY = Math.floor(oldY / this.gridSize);
    const newCellX = Math.floor(newX / this.gridSize);
    const newCellY = Math.floor(newY / this.gridSize);

    // If cell changed, update tracking
    if (oldCellX !== newCellX || oldCellY !== newCellY) {
      const oldCellKey = `${oldCellX},${oldCellY}`;
      const newCellKey = `${newCellX},${newCellY}`;

      const oldRegion = this.fetchedRegions.get(oldCellKey);
      if (oldRegion) {
        oldRegion.nodeIds.delete(nodeId);
      }

      const newRegion = this.fetchedRegions.get(newCellKey);
      if (newRegion) {
        newRegion.nodeIds.add(nodeId);
      }
    }
  }

  /**
   * Get grid size
   */
  getGridSize(): number {
    return this.gridSize;
  }
}
