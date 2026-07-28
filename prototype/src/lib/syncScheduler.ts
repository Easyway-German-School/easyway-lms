/**
 * Background sync scheduler for LMS connectors
 * Implements hybrid auto-sync with configurable intervals
 */

interface SyncTask {
  connectorId: string;
  lastSync?: Date;
  nextSync?: Date;
  status: 'idle' | 'syncing' | 'error';
  errorMessage?: string;
  itemsSync?: number;
}

interface SyncScheduleConfig {
  connectorId: string;
  intervalMinutes?: number;
  autoSync?: boolean;
}

class ConnectorSyncScheduler {
  private syncTasks = new Map<string, SyncTask>();
  private syncIntervals = new Map<string, NodeJS.Timeout>();
  private readonly DEFAULT_SYNC_INTERVAL = 30; // 30 minutes
  private readonly MIN_SYNC_INTERVAL = 15; // 15 minutes minimum

  /**
   * Initialize sync for a connector
   */
  initializeSync(config: SyncScheduleConfig) {
    const { connectorId, intervalMinutes = this.DEFAULT_SYNC_INTERVAL, autoSync = true } = config;

    if (this.syncTasks.has(connectorId)) {
      return; // Already initialized
    }

    this.syncTasks.set(connectorId, {
      connectorId,
      status: 'idle',
      lastSync: undefined,
      nextSync: new Date(Date.now() + 5000), // Start in 5 seconds
      itemsSync: 0,
    });

    if (autoSync) {
      this.scheduleSync(connectorId, Math.max(intervalMinutes, this.MIN_SYNC_INTERVAL));
    }
  }

  /**
   * Schedule periodic sync for a connector
   */
  private scheduleSync(connectorId: string, intervalMinutes: number) {
    // Clear existing interval if any
    if (this.syncIntervals.has(connectorId)) {
      clearInterval(this.syncIntervals.get(connectorId));
    }

    // Initial sync after 5 seconds
    setTimeout(() => this.triggerSync(connectorId), 5000);

    // Recurring sync at interval
    const interval = setInterval(() => this.triggerSync(connectorId), intervalMinutes * 60 * 1000);
    this.syncIntervals.set(connectorId, interval);
  }

  /**
   * Trigger a sync for a specific connector
   */
  async triggerSync(connectorId: string) {
    const task = this.syncTasks.get(connectorId);
    if (!task) return;

    task.status = 'syncing';
    try {
      const response = await fetch(`/api/admin/integrations?connectorId=${encodeURIComponent(connectorId)}&action=sync`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.statusText}`);
      }

      const data = await response.json();
      task.status = 'idle';
      task.lastSync = new Date();
      task.itemsSync = data.result?.itemsSynced || 0;
      task.nextSync = new Date(Date.now() + this.DEFAULT_SYNC_INTERVAL * 60 * 1000);
      task.errorMessage = undefined;
    } catch (error) {
      task.status = 'error';
      task.errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Get current sync status for a connector
   */
  getSyncStatus(connectorId: string): SyncTask | null {
    return this.syncTasks.get(connectorId) || null;
  }

  /**
   * Get all sync statuses
   */
  getAllSyncStatuses(): SyncTask[] {
    return Array.from(this.syncTasks.values());
  }

  /**
   * Manually trigger sync (override schedule)
   */
  async manualSync(connectorId: string): Promise<boolean> {
    try {
      await this.triggerSync(connectorId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stop sync for a connector
   */
  stopSync(connectorId: string) {
    if (this.syncIntervals.has(connectorId)) {
      clearInterval(this.syncIntervals.get(connectorId)!);
      this.syncIntervals.delete(connectorId);
    }
  }

  /**
   * Stop all syncs
   */
  stopAllSyncs() {
    for (const [connectorId] of this.syncIntervals) {
      this.stopSync(connectorId);
    }
  }

  /**
   * Get sync metrics
   */
  getMetrics() {
    const statuses = this.getAllSyncStatuses();
    return {
      totalConnectors: statuses.length,
      syncingCount: statuses.filter((s) => s.status === 'syncing').length,
      errorCount: statuses.filter((s) => s.status === 'error').length,
      idleCount: statuses.filter((s) => s.status === 'idle').length,
      totalItemsSynced: statuses.reduce((sum, s) => sum + (s.itemsSync || 0), 0),
    };
  }
}

// Singleton instance
export const syncScheduler = new ConnectorSyncScheduler();

export type { SyncTask, SyncScheduleConfig };
