import {MatrixEvent} from "./event";
import AsyncLock from "async-lock";
import {FederationClient} from "../FederationClient";
import {getDomainFromId} from "../util/id";
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

    private async doInsert(event: MatrixEvent, recursionDepth = 0): Promise<void> {
        console.log(`Attempting to insert ${event.event_id} (${event.type})`);
        if (this.eventsCopy.length === 0) {
            this.roomVersion.checkAuth(event, []);
            this.eventsCopy.push(event);
            this.queueEventEmit(event);
            return;
        }

        const depthLimit = 50;
        if (recursionDepth > depthLimit) {
            throw new Error(
                `Recursion error: Hit arbitrary recursion limit ${depthLimit} when trying to insert ${event.event_id}`,
            );
        }

        if (this.seenIdsCopy.has(event.event_id)) {
            console.warn(`${event.event_id} has reordered rather than inserted - finding new position`);
            this.eventsCopy = this.eventsCopy.filter(e => e.event_id !== event.event_id);
            this.seenIdsCopy.delete(event.event_id);
        }

        // TODO: Support "newly-rejected" event where `insert_after` is null
        // https://github.com/matrix-org/eigen-server/issues/28
        let insertAfterId = event.unsigned?.["insert_after"] as string;
        // noinspection SuspiciousTypeOfGuard
        if (typeof insertAfterId !== "string") {
            if (event.prev_events.length === 1 && this.eventsCopy.length > 0) {
                insertAfterId = event.prev_events[0];
            } else {
                throw new Error(
                    `Unable to locate single parent for ${event.event_id} - there must be a single event ID in prev_events or an unsigned.insert_after string`,
                );
            }
        }

        if (insertAfterId === event.event_id) {
            throw new Error(`Recursion error: ${event.event_id} calls to be inserted after itself`);
        }

        // Try to insert the event
        const buffer: MatrixEvent[] = [];
        for (let i = 0; i < this.eventsCopy.length; i++) {
            const ev = this.eventsCopy[i];
            buffer.push(ev);
            if (ev.event_id === insertAfterId) {
                this.roomVersion.checkAuth(event, buffer);
                this.seenIdsCopy.add(event.event_id);
                this.eventsCopy.splice(i + 1, 0, event);
                this.queueEventEmit(event);
                return;
            }
        }

        // we weren't able to insert the event. Maybe we just don't know what
        // the parent is?
        console.log(
            `No valid position for ${event.event_id} (insertAfterId=${insertAfterId}) - trying to find parent event`,
        );
        try {
            const client = new FederationClient(getDomainFromId(event.sender));
            const ev = await client.getEvent(insertAfterId, this.roomVersion);
            await this.doInsert(ev, ++recursionDepth);
        } catch (e) {
            throw new Error(`Error while handling ${event.event_id}: ${e}`);
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
