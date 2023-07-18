import {MatrixEvent} from "./event";
import AsyncLock from "async-lock";
import {RoomVersion} from "../room_versions/RoomVersion";
import EventEmitter from "events";
import {FunctionQueue} from "../util/FunctionQueue";

const LockKey = "events";

/**
 * A Linearized DAG is just a linked list where nodes (events) point at their
 * parent. We then rely on insertion to modify the order within.
 */
export class LinearizedDAG {
    // We could probably store this reversed for efficiency, but we're optimizing
    // for readability over performance here.
    private events: MatrixEvent[] = [];
    private eventsCopy: MatrixEvent[] = []; // working copy
    private seenIds = new Set<string>();
    private seenIdsCopy = new Set<string>();
    private lock = new AsyncLock();
    private emitter = new EventEmitter();
    private emitQueue = new FunctionQueue();

    public constructor(private roomVersion: RoomVersion) {}

    public get currentEvents(): MatrixEvent[] {
        return [...this.events];
    }

    public get lastEvent(): MatrixEvent | undefined {
        const idx = this.events.length - 1;
        return idx < 0 ? undefined : this.events[idx];
    }

    public async insertEvents(events: MatrixEvent[]): Promise<void> {
        return this.lock.acquire(LockKey, async done => {
            try {
                this.beginTransaction();
                for (const event of events) {
                    await this.doInsert(event);
                }
                this.commitTransaction();
                this.emitQueue.run();
                done();
            } catch (e) {
                if (!(e instanceof Error)) {
                    e = new Error(`Unexpected catch: "${e}" is not an Error`);
                }
                done(e as Error);
            }
        });
    }

    private async doInsert(event: MatrixEvent): Promise<void> {
        console.log(`Attempting to append ${event.event_id} (${event.type})`);
        this.roomVersion.checkAuth(event, this.events);
        this.eventsCopy.push(event);
        this.queueEventEmit(event);
        if (this.eventsCopy.length === 0) {
            return;
        }
    }

    private beginTransaction() {
        this.eventsCopy = [...this.events];
        this.seenIdsCopy = new Set<string>(this.seenIds);
    }

    private commitTransaction() {
        this.events = this.eventsCopy;
        this.seenIds = this.seenIdsCopy;
    }

    private queueEventEmit(event: MatrixEvent) {
        this.emitQueue.add(() => this.emitter.emit("event", event));
    }

    public on(event: "event", fn: (event: MatrixEvent) => void): void;
    public on(event: string, fn: (...args: any[]) => void): void {
        this.emitter.on(event, fn);
    }

    public off(event: "event", fn: (event: MatrixEvent) => void): void;
    public off(event: string, fn: (...args: any[]) => void): void {
        this.emitter.off(event, fn);
    }
}
