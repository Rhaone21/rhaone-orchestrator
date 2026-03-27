/**
 * Rhaone Orchestrator - Resource Manager
 * Handle resource limits and parallel execution coordination
 */

import { EventEmitter } from 'events';
import { withErrorHandling, withRetry, withCircuitBreaker, errorHandler } from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export interface ResourceConfig {
  maxConcurrentAgents: number;
  maxTotalAgents: number;
  maxRetries: number;
  timeoutMs: number;
  cooldownMs: number;
}

export interface AgentSlot {
  id: string;
  issueId: string;
  startTime: number;
  status: 'active' | 'releasing' | 'released';
}

export interface ResourceUsage {
  activeSlots: number;
  availableSlots: number;
  totalSlots: number;
  utilization: number;
}

export interface ResourceReservation {
  issueId: string;
  reservedAt: number;
  expiresAt: number;
}

/**
 * Resource Manager - manages concurrent agent slots and resource allocation
 */
export class ResourceManager extends EventEmitter {
  private config: ResourceConfig;
  private slots: Map<string, AgentSlot> = new Map();
  private reservations: Map<string, ResourceReservation> = new Map();
  private waitQueue: Map<string, () => void> = new Map();
  private releaseCooldowns: Set<string> = new Set();
  // Cache for usage calculations
  private usageCache: LRUCache<string, ResourceUsage>;
  // Memoized health check
  private memoizedGetHealth: () => ReturnType<ResourceManager['getHealth']>;

  constructor(config?: Partial<ResourceConfig>) {
    super();
    this.config = {
      maxConcurrentAgents: config?.maxConcurrentAgents || 5,
      maxTotalAgents: config?.maxTotalAgents || 20,
      maxRetries: config?.maxRetries || 3,
      timeoutMs: config?.timeoutMs || 30 * 60 * 1000,
      cooldownMs: config?.cooldownMs || 5000,
    };

    // Initialize caches
    this.usageCache = new LRUCache({ maxSize: 1, ttlMs: 100 }); // 100ms TTL for usage
    
    // Memoize health check with 1 second TTL
    this.memoizedGetHealth = memoize(
      () => this.calculateHealth(),
      { maxSize: 1, ttlMs: 1000 }
    );
  }

  /**
   * Get current resource usage with caching
   */
  getUsage(): ResourceUsage {
    const cacheKey = 'usage';
    const cached = this.usageCache.get(cacheKey);
    if (cached) return cached;

    const usage = this.calculateUsage();
    this.usageCache.set(cacheKey, usage);
    return usage;
  }

  private calculateUsage(): ResourceUsage {
    const activeSlots = Array.from(this.slots.values()).filter(s => s.status === 'active').length;
    const totalSlots = this.config.maxConcurrentAgents;
    const availableSlots = totalSlots - activeSlots;

    return {
      activeSlots,
      availableSlots: Math.max(0, availableSlots),
      totalSlots,
      utilization: totalSlots > 0 ? activeSlots / totalSlots : 0,
    };
  }

  /**
   * Check if there's capacity for a new agent with error handling
   */
  hasCapacity(issueId?: string): boolean {
    return withErrorHandling(
      () => Promise.resolve(this.hasCapacityInternal(issueId)),
      {
        operation: 'resource-manager.hasCapacity',
        fallback: async () => false,
      }
    ) as unknown as boolean;
  }

  private hasCapacityInternal(issueId?: string): boolean {
    const usage = this.getUsage();
    
    if (issueId) {
      const existingSlot = Array.from(this.slots.values()).find(s => s.issueId === issueId);
      if (existingSlot) {
        return usage.activeSlots < this.config.maxConcurrentAgents;
      }
    }
    
    return usage.availableSlots > 0;
  }

  /**
   * Reserve a slot for an agent with error handling and retry
   */
  async reserve(issueId: string, timeoutMs?: number): Promise<boolean> {
    return withErrorHandling(
      async () => this.reserveInternal(issueId, timeoutMs),
      {
        operation: 'resource-manager.reserve',
        issueId,
        retry: {
          maxRetries: this.config.maxRetries,
          backoffMs: 500,
          backoffMultiplier: 1.5,
          maxBackoffMs: 5000,
          retryableErrors: ['timeout', 'busy', 'lock'],
        },
        fallback: async () => false,
      }
    );
  }

  private async reserveInternal(issueId: string, timeoutMs?: number): Promise<boolean> {
    const timeout = timeoutMs || this.config.timeoutMs;
    const startTime = Date.now();

    // Check if already has a slot
    const existingSlot = Array.from(this.slots.values()).find(s => s.issueId === issueId);
    if (existingSlot && existingSlot.status === 'active') {
      console.log(`[ResourceManager] Issue ${issueId} already has an active slot`);
      return true;
    }

    // Wait for capacity
    while (!this.hasCapacityInternal(issueId)) {
      if (Date.now() - startTime > timeout) {
        console.log(`[ResourceManager] Timeout waiting for slot for ${issueId}`);
        return false;
      }

      console.log(`[ResourceManager] Waiting for slot availability for ${issueId}`);
      await this.waitForSlot(issueId, Math.min(5000, timeout - (Date.now() - startTime)));
    }

    // Create slot
    const slotId = `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const slot: AgentSlot = {
      id: slotId,
      issueId,
      startTime: Date.now(),
      status: 'active',
    };

    this.slots.set(slotId, slot);
    console.log(`[ResourceManager] Reserved slot ${slotId} for ${issueId}. Usage: ${this.getUsage().activeSlots}/${this.getUsage().totalSlots}`);

    this.emit('reserved', { issueId, slotId, usage: this.getUsage() });
    return true;
  }

  private waitForSlot(issueId: string, maxWaitMs: number): Promise<void> {
    return new Promise((resolve) => {
      const waitId = `${issueId}-${Date.now()}`;
      
      const timeout = setTimeout(() => {
        this.waitQueue.delete(waitId);
        resolve();
      }, maxWaitMs);

      this.waitQueue.set(waitId, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Release a slot with error handling
   */
  async release(issueId: string): Promise<void> {
    return withErrorHandling(
      async () => this.releaseInternal(issueId),
      {
        operation: 'resource-manager.release',
        issueId,
        retry: {
          maxRetries: 2,
          backoffMs: 100,
          retryableErrors: ['busy'],
        },
      }
    );
  }

  private async releaseInternal(issueId: string): Promise<void> {
    const slotsToRelease = Array.from(this.slots.entries())
      .filter(([_, slot]) => slot.issueId === issueId && slot.status === 'active');

    for (const [slotId, slot] of slotsToRelease) {
      slot.status = 'releasing';
      console.log(`[ResourceManager] Releasing slot ${slotId} for ${issueId}`);

      this.releaseCooldowns.add(issueId);
      setTimeout(() => {
        this.releaseCooldowns.delete(issueId);
      }, this.config.cooldownMs);

      setTimeout(() => {
        slot.status = 'released';
        this.slots.delete(slotId);
        console.log(`[ResourceManager] Released slot ${slotId}. Usage: ${this.getUsage().activeSlots}/${this.getUsage().totalSlots}`);
        
        this.emit('released', { issueId, slotId, usage: this.getUsage() });
        
        for (const [waitId, resolver] of this.waitQueue) {
          resolver();
          this.waitQueue.delete(waitId);
          break;
        }
      }, 100);
    }
  }

  /**
   * Release all slots (emergency cleanup) with error handling
   */
  releaseAll(): void {
    withErrorHandling(
      async () => {
        console.log(`[ResourceManager] Releasing all ${this.slots.size} slots`);
        
        for (const [slotId, slot] of this.slots) {
          slot.status = 'released';
          this.slots.delete(slotId);
        }
        
        for (const resolver of this.waitQueue.values()) {
          resolver();
        }
        this.waitQueue.clear();

        this.emit('releasedAll', { usage: this.getUsage() });
      },
      {
        operation: 'resource-manager.releaseAll',
        fallback: async () => {
          console.error('[ResourceManager] Failed to release all slots');
        },
      }
    ).catch(() => {});
  }

  getActiveSlots(): AgentSlot[] {
    return Array.from(this.slots.values()).filter(s => s.status === 'active');
  }

  hasActiveSlot(issueId: string): boolean {
    return Array.from(this.slots.values())
      .some(s => s.issueId === issueId && s.status === 'active');
  }

  getSlotCountForIssue(issueId: string): number {
    return Array.from(this.slots.values())
      .filter(s => s.issueId === issueId && s.status === 'active').length;
  }

  /**
   * Update configuration with error handling
   */
  updateConfig(config: Partial<ResourceConfig>): void {
    withErrorHandling(
      async () => {
        const oldConfig = { ...this.config };
        this.config = { ...this.config, ...config };
        console.log(`[ResourceManager] Config updated:`, {
          from: oldConfig,
          to: this.config,
        });
        this.emit('configUpdated', { oldConfig, newConfig: this.config });
        
        // Clear usage cache since config changed
        this.usageCache.clear();
      },
      {
        operation: 'resource-manager.updateConfig',
      }
    ).catch(() => {});
  }

  getConfig(): ResourceConfig {
    return { ...this.config };
  }

  /**
   * Get health status with memoization
   */
  getHealth(): {
    healthy: boolean;
    usage: ResourceUsage;
    activeIssues: string[];
    warnings: string[];
  } {
    return this.memoizedGetHealth();
  }

  private calculateHealth(): {
    healthy: boolean;
    usage: ResourceUsage;
    activeIssues: string[];
    warnings: string[];
  } {
    const usage = this.getUsage();
    const activeIssues = [...new Set(
      Array.from(this.slots.values())
        .filter(s => s.status === 'active')
        .map(s => s.issueId)
    )];

    const warnings: string[] = [];
    
    if (usage.utilization > 0.9) {
      warnings.push('High resource utilization (>90%)');
    }
    
    if (usage.activeSlots >= this.config.maxConcurrentAgents) {
      warnings.push('At maximum capacity');
    }

    const now = Date.now();
    for (const slot of this.slots.values()) {
      if (slot.status === 'active' && now - slot.startTime > this.config.timeoutMs) {
        warnings.push(`Slot ${slot.id} for ${slot.issueId} running >${Math.round(this.config.timeoutMs/60000)}min`);
      }
    }

    return {
      healthy: warnings.length === 0,
      usage,
      activeIssues,
      warnings,
    };
  }

  /**
   * Force cleanup stuck slots with error handling
   */
  cleanupStuckSlots(): number {
    return withErrorHandling(
      async () => {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [slotId, slot] of this.slots) {
          if (slot.status === 'active' && now - slot.startTime > this.config.timeoutMs) {
            console.log(`[ResourceManager] Cleaning up stuck slot ${slotId} for ${slot.issueId}`);
            slot.status = 'released';
            this.slots.delete(slotId);
            cleaned++;
          }
        }

        if (cleaned > 0) {
          this.emit('cleanup', { cleaned, usage: this.getUsage() });
        }

        return cleaned;
      },
      {
        operation: 'resource-manager.cleanupStuckSlots',
        fallback: async () => 0,
      }
    ) as unknown as number;
  }
}

export const resourceManager = new ResourceManager();
