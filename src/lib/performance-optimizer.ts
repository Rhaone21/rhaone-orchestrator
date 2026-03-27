/**
 * Rhaone Orchestrator - Performance Optimization Utilities
 * Caching, memoization, and async utilities for performance
 */

import { EventEmitter } from 'events';

/**
 * Optimized Cache with TTL support - used by CI Poller and other components
 */
export interface OptimizedCacheOptions<V> {
  defaultTTL?: number;
  maxSize?: number;
}

export class OptimizedCache<V> extends EventEmitter {
  private cache: Map<string, { value: V; timestamp: number; ttl: number }>;
  private maxSize: number;
  private defaultTTL: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(options: OptimizedCacheOptions<V> = {}) {
    super();
    this.maxSize = options.maxSize || 100;
    this.defaultTTL = options.defaultTTL || 30000;
    this.cache = new Map();
  }

  get(key: string): V | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.missCount++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.missCount++;
      return undefined;
    }

    this.hitCount++;
    return entry.value;
  }

  set(key: string, value: V, ttl?: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.emit('evict', oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.emit('clear');
  }

  size(): number {
    return this.cache.size;
  }

  getMetrics(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hitCount + this.missCount;
    return {
      size: this.cache.size,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }

  destroy(): void {
    this.clear();
    this.removeAllListeners();
  }
}

/**
 * LRU Cache implementation with TTL support
 */
export interface CacheOptions<K, V> {
  maxSize: number;
  ttlMs?: number;
  onEvict?: (key: K, value: V) => void;
}

interface CacheEntry<V> {
  value: V;
  timestamp: number;
  accessCount: number;
}

export class LRUCache<K, V> extends EventEmitter {
  private cache: Map<K, CacheEntry<V>>;
  private maxSize: number;
  private ttlMs?: number;
  private onEvict?: (key: K, value: V) => void;

  constructor(options: CacheOptions<K, V>) {
    super();
    this.cache = new Map();
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
    this.onEvict = options.onEvict;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }

    // Check TTL
    if (this.ttlMs && Date.now() - entry.timestamp > this.ttlMs) {
      this.delete(key);
      return undefined;
    }

    // Update access count (LRU)
    entry.accessCount++;
    
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(key: K, value: V): void {
    // If key exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldestEntry = this.cache.get(oldestKey);
        this.cache.delete(oldestKey);
        if (this.onEvict && oldestEntry) {
          this.onEvict(oldestKey, oldestEntry.value);
        }
        this.emit('evict', oldestKey, oldestEntry?.value);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 0,
    });
  }

  delete(key: K): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key);
      this.emit('delete', key, entry.value);
      return true;
    }
    return false;
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (this.ttlMs && Date.now() - entry.timestamp > this.ttlMs) {
      this.delete(key);
      return false;
    }
    
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.emit('clear');
  }

  size(): number {
    return this.cache.size;
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  values(): V[] {
    return Array.from(this.cache.values()).map(e => e.value);
  }

  entries(): [K, V][] {
    return Array.from(this.cache.entries()).map(([k, e]) => [k, e.value]);
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    if (!this.ttlMs) return 0;

    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}

/**
 * Create a cache instance
 */
export function createCache<K, V>(options: CacheOptions<K, V>): LRUCache<K, V> {
  return new LRUCache(options);
}

/**
 * Memoize a function with LRU cache
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  options: {
    maxSize?: number;
    ttlMs?: number;
    keyGenerator?: (...args: Parameters<T>) => string;
  } = {}
): T {
  const cache = new LRUCache<string, ReturnType<T>>({
    maxSize: options.maxSize || 100,
    ttlMs: options.ttlMs,
  });

  const keyGenerator = options.keyGenerator || 
    ((...args: Parameters<T>) => JSON.stringify(args));

  return function (...args: Parameters<T>): ReturnType<T> {
    const key = keyGenerator(...args);
    const cached = cache.get(key);
    
    if (cached !== undefined) {
      return cached;
    }

    const result = fn(...args);
    cache.set(key, result);
    return result;
  } as T;
}

/**
 * Async memoize for async functions
 */
export function asyncMemoize<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: {
    maxSize?: number;
    ttlMs?: number;
    keyGenerator?: (...args: Parameters<T>) => string;
  } = {}
): T {
  const cache = new LRUCache<string, Promise<ReturnType<T>>>({
    maxSize: options.maxSize || 100,
    ttlMs: options.ttlMs,
  });

  const keyGenerator = options.keyGenerator || 
    ((...args: Parameters<T>) => JSON.stringify(args));

  return async function (...args: Parameters<T>): Promise<ReturnType<T>> {
    const key = keyGenerator(...args);
    const cached = cache.get(key);
    
    if (cached !== undefined) {
      return cached;
    }

    const promise = fn(...args);
    cache.set(key, promise);
    
    try {
      const result = await promise;
      return result;
    } catch (error) {
      // Remove failed promise from cache
      cache.delete(key);
      throw error;
    }
  } as T;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  waitMs: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): T {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastCallTime: number | null = null;

  const { leading = false, trailing = true } = options;

  return function (...args: Parameters<T>): void {
    lastArgs = args;
    const now = Date.now();

    if (leading && !lastCallTime) {
      fn(...args);
      lastCallTime = now;
    }

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      if (trailing && lastArgs) {
        fn(...lastArgs);
      }
      timeoutId = null;
      lastArgs = null;
      lastCallTime = null;
    }, waitMs);
  } as T;
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limitMs: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): T {
  let lastCallTime: number | null = null;
  let timeoutId: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;

  const { leading = true, trailing = true } = options;

  return function (...args: Parameters<T>): void {
    const now = Date.now();
    lastArgs = args;

    if (!lastCallTime || now - lastCallTime >= limitMs) {
      if (leading) {
        fn(...args);
        lastCallTime = now;
      }
    } else if (trailing && !timeoutId) {
      const remaining = limitMs - (now - lastCallTime);
      timeoutId = setTimeout(() => {
        if (lastArgs) {
          fn(...lastArgs);
          lastCallTime = Date.now();
        }
        timeoutId = null;
        lastArgs = null;
      }, remaining);
    }
  } as T;
}

/**
 * Rate limiter (token bucket)
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number;
  private refillIntervalMs: number;

  constructor(options: {
    maxTokens: number;
    refillRate: number;
    refillIntervalMs?: number;
  }) {
    this.maxTokens = options.maxTokens;
    this.tokens = options.maxTokens;
    this.refillRate = options.refillRate;
    this.refillIntervalMs = options.refillIntervalMs || 1000;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillIntervalMs) * this.refillRate;
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  tryConsume(tokens: number = 1): boolean {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    return false;
  }

  async consume(tokens: number = 1): Promise<void> {
    while (!this.tryConsume(tokens)) {
      const waitMs = this.refillIntervalMs / this.refillRate;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * Batch processor for efficient batching
 */
export class BatchProcessor<T, R> {
  private queue: Array<{ item: T; resolve: (result: R) => void; reject: (error: Error) => void }> = [];
  private processor: (items: T[]) => Promise<R[]>;
  private maxBatchSize: number;
  private flushIntervalMs: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private processing = false;

  constructor(options: {
    processor: (items: T[]) => Promise<R[]>;
    maxBatchSize: number;
    flushIntervalMs: number;
  }) {
    this.processor = options.processor;
    this.maxBatchSize = options.maxBatchSize;
    this.flushIntervalMs = options.flushIntervalMs;
  }

  async add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      
      if (this.queue.length >= this.maxBatchSize) {
        this.flush();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const batch = this.queue.splice(0, this.maxBatchSize);
    const items = batch.map(b => b.item);

    try {
      const results = await this.processor(items);
      
      batch.forEach((b, i) => {
        if (results[i] !== undefined) {
          b.resolve(results[i]);
        } else {
          b.reject(new Error('No result for item'));
        }
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error : new Error(String(error));
      batch.forEach(b => b.reject(errorMsg));
    } finally {
      this.processing = false;
      
      // Flush remaining items
      if (this.queue.length > 0) {
        this.flush();
      }
    }
  }

  async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Process remaining items
    while (this.queue.length > 0) {
      await this.flush();
    }
  }
}

/**
 * Connection pool for managing connections
 */
export class ConnectionPool<T> {
  private pool: T[] = [];
  private inUse: Set<T> = new Set();
  private factory: () => Promise<T>;
  maxSize: number;
  minSize: number;

  constructor(options: {
    factory: () => Promise<T>;
    maxSize: number;
    minSize?: number;
  }) {
    this.factory = options.factory;
    this.maxSize = options.maxSize;
    this.minSize = options.minSize || 0;
  }

  async acquire(): Promise<T> {
    // Return available connection
    if (this.pool.length > 0) {
      const conn = this.pool.pop()!;
      this.inUse.add(conn);
      return conn;
    }

    // Create new if under max
    if (this.inUse.size < this.maxSize) {
      const conn = await this.factory();
      this.inUse.add(conn);
      return conn;
    }

    // Wait for connection to be released
    return new Promise((resolve) => {
      const check = () => {
        if (this.pool.length > 0) {
          const conn = this.pool.pop()!;
          this.inUse.add(conn);
          resolve(conn);
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }

  release(connection: T): void {
    if (this.inUse.has(connection)) {
      this.inUse.delete(connection);
      this.pool.push(connection);
    }
  }

  async destroy(): Promise<void> {
    this.pool = [];
    this.inUse.clear();
  }
}

/**
 * Performance metrics collector
 */
export class PerformanceMetrics {
  private metrics: Map<string, number[]> = new Map();
  private labels: Map<string, string> = new Map();

  record(name: string, value: number, label?: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);
    
    if (label) {
      this.labels.set(name, label);
    }
  }

  getStats(name: string): { count: number; mean: number; min: number; max: number; p95: number } | null {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const mean = sorted.reduce((a, b) => a + b, 0) / count;
    const min = sorted[0];
    const max = sorted[count - 1];
    const p95Index = Math.floor(count * 0.95);
    const p95 = sorted[Math.min(p95Index, count - 1)];

    return { count, mean, min, max, p95 };
  }

  getAllStats(): Record<string, { count: number; mean: number; min: number; max: number; p95: number; label?: string }> {
    const result: Record<string, { count: number; mean: number; min: number; max: number; p95: number; label?: string }> = {};
    
    for (const name of this.metrics.keys()) {
      const stats = this.getStats(name);
      if (stats) {
        result[name] = { ...stats, label: this.labels.get(name) };
      }
    }
    
    return result;
  }

  clear(): void {
    this.metrics.clear();
    this.labels.clear();
  }

  export(): string {
    const stats = this.getAllStats();
    return JSON.stringify(stats, null, 2);
  }
}

// Global metrics instance
export const globalMetrics = new PerformanceMetrics();