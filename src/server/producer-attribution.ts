/**
 * wave26-c — tracks which service names have *actually* published each event,
 * separate from the declared producer field. Surfaces undeclared producers
 * (publishing to an event they don't own) and dead declared producers
 * (declared but never published).
 */
export class ProducerAttributionStore {
  private readonly observed = new Map<string, Set<string>>();

  record(eventName: string, actualProducer: string): void {
    let producers = this.observed.get(eventName);
    if (!producers) {
      producers = new Set();
      this.observed.set(eventName, producers);
    }
    producers.add(actualProducer);
  }

  getObserved(eventName: string): string[] {
    return [...(this.observed.get(eventName) ?? [])];
  }

  getAll(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [name, producers] of this.observed) {
      result[name] = [...producers];
    }
    return result;
  }

  clear(): void {
    this.observed.clear();
  }
}
