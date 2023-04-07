import {MatrixEvent, StateEvent} from "./event";

export class CurrentRoomState {
    private state = new Map<string, Map<string, StateEvent>>();

    public constructor(deriveFrom?: MatrixEvent[]) {
        if (!deriveFrom) return;
        for (const event of deriveFrom) {
            if (event.state_key === undefined) continue; // not a state event

            if (!this.state.has(event.type)) this.state.set(event.type, new Map());
            const typeMap = this.state.get(event.type)!;
            typeMap.set(event.state_key, event as StateEvent);
        }
    }

    public get events(): StateEvent[] {
        return Array.from(this.state.values()).reduce((p, c) => [...p, ...Array.from(c.values())], [] as StateEvent[]);
    }

    public get(eventType: string, stateKey: string): StateEvent | undefined {
        return this.state.get(eventType)?.get(stateKey);
    }

    public getAll(eventType: string): StateEvent[] {
        const stateMap = this.state.get(eventType);
        if (!stateMap) return [];

        return Array.from(stateMap.values());
    }
}
