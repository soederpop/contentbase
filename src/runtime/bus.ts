export type EventMap = Record<string, any[]>;

type Listener<Args extends any[] = any[]> = (...args: Args) => void;
type WildcardListener = (event: string, ...args: any[]) => void;

export interface EventStats {
    event: string;
    fireCount: number;
    lastFiredAt: number | null;
    timestamps: number[];
    firesPerMinute: number;
}

export class Bus<T extends EventMap = EventMap> {
    private events: Map<string, Listener[]>;
    private wildcardListeners: WildcardListener[];
    private stats: Map<string, { fireCount: number; lastFiredAt: number | null; timestamps: number[] }>;

    constructor() {
        this.events = new Map();
        this.wildcardListeners = [];
        this.stats = new Map();
    }

    private recordEmit(event: string): void {
        const now = Date.now();
        const existing = this.stats.get(event) || { fireCount: 0, lastFiredAt: null, timestamps: [] };
        existing.fireCount++;
        existing.lastFiredAt = now;
        existing.timestamps.push(now);
        this.stats.set(event, existing);
    }

    private computeFiresPerMinute(timestamps: number[]): number {
        if (timestamps.length < 2) return 0;
        const now = Date.now();
        const oneMinuteAgo = now - 60_000;
        const recent = timestamps.filter(t => t >= oneMinuteAgo);
        return recent.length;
    }

    getEventStats<E extends string & keyof T>(event: E): EventStats {
        const raw = this.stats.get(event) || { fireCount: 0, lastFiredAt: null, timestamps: [] };
        return {
            event,
            fireCount: raw.fireCount,
            lastFiredAt: raw.lastFiredAt,
            timestamps: raw.timestamps,
            firesPerMinute: this.computeFiresPerMinute(raw.timestamps),
        };
    }

    get history(): EventStats[] {
        return Array.from(this.stats.keys()).map(event => this.getEventStats(event as any));
    }

    get firedEvents(): string[] {
        return Array.from(this.stats.keys());
    }

    async waitFor<E extends string & keyof T>(event: E): Promise<T[E]> {
        return new Promise(resolve => {
            this.once(event, resolve as any);
        });
    }

    emit<E extends string & keyof T>(event: E, ...args: T[E]): void {
        this.recordEmit(event);
        const listeners = this.events.get(event);
        if (listeners) {
            // Iterate a snapshot: a once() listener removes itself (splices the
            // live array) during dispatch, which would skip the next listener.
            [...listeners].forEach(listener => listener(...args));
        }
        [...this.wildcardListeners].forEach(listener => listener(event, ...args));
    }

    on(event: '*', listener: WildcardListener): void
    on<E extends string & keyof T>(event: E, listener: (...args: T[E]) => void): void
    on<E extends string & keyof T>(event: E | '*', listener: any): void {
        if (event === '*') {
            this.wildcardListeners.push(listener);
            return;
        }
        const listeners = this.events.get(event) || [];
        listeners.push(listener as Listener);
        this.events.set(event, listeners);
    }

    once<E extends string & keyof T>(event: E, listener: (...args: T[E]) => void): void {
        const onceListener: Listener = (...args: any[]) => {
            (listener as Listener)(...args);
            this.off(event, onceListener as any);
        };
        this.on(event, onceListener as any);
    }

    off(event: '*', listener?: WildcardListener): void
    off<E extends string & keyof T>(event: E, listener?: (...args: T[E]) => void): void
    off<E extends string & keyof T>(event: E | '*', listener?: any): void {
        if (event === '*') {
            if (!listener) {
                this.wildcardListeners = [];
                return;
            }
            const index = this.wildcardListeners.indexOf(listener);
            if (index !== -1) this.wildcardListeners.splice(index, 1);
            return;
        }

        const listeners = this.events.get(event);
        if (!listeners) return;

        if (!listener) {
            this.events.delete(event);
            return;
        }

        const index = listeners.indexOf(listener as Listener);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
    }
}
