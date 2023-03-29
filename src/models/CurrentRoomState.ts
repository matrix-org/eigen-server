import {MatrixEvent} from "./event";

export class CurrentRoomState {
    private state = new Map<string, Map<string, MatrixEvent>>();

    public constructor(deriveFrom?: MatrixEvent[]) {
        if (!deriveFrom) return;
        for (const event of deriveFrom) {
            if (event.state_key === undefined) continue; // not a state event

            if (!this.state.has(event.type)) this.state.set(event.type, new Map());
            const typeMap = this.state.get(event.type)!;
            typeMap.set(event.state_key, event);
        }
    }

    public get(eventType: string, stateKey: string): MatrixEvent | undefined {
        return this.state.get(eventType)?.get(stateKey);
    }
}
