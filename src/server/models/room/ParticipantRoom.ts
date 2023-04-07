import {Room} from "./Room";
import {ClientFriendlyMatrixEvent, LinearizedPDU, MatrixEvent, PDU} from "../event";
import EventEmitter from "events";
import {RoomVersion} from "../../room_versions/RoomVersion";
import {KeyStore} from "../../KeyStore";
import {calculateReferenceHash} from "../../util/hashing";
import {Runtime} from "../../Runtime";
import {CurrentRoomState} from "../CurrentRoomState";
import {getDomainFromId} from "../../util/id";
import {FederationClient} from "../../FederationClient";
import {getRoomVersionImpl} from "../../room_versions/map";

export class ParticipantRoom implements Room {
    protected emitter = new EventEmitter();
    protected events: MatrixEvent[] = [];

    protected constructor(public roomId: string, protected roomVersion: RoomVersion, protected keyStore: KeyStore) {}

    public get hubDomain(): string {
        const state = this.currentState;
        const hubEvent = state.get("m.room.hub", "");
        if (!!hubEvent) {
            return getDomainFromId(hubEvent.sender);
        }

        const createEvent = state.get("m.room.create", "");
        if (!!createEvent) {
            return getDomainFromId(createEvent.sender);
        }

        return Runtime.signingKey.serverName; // no creator yet, which we assume will be us
    }

    protected get currentState(): CurrentRoomState {
        return new CurrentRoomState(this.events);
    }

    public get version(): string {
        return this.roomVersion.id;
    }

    public get joinedUserIds(): string[] {
        return this.currentState
            .getAll("m.room.member")
            .filter(m => m.content["membership"] === "join")
            .map(m => m.state_key!);
    }

    public createEvent(
        partial: Omit<ClientFriendlyMatrixEvent, "room_id" | "origin_server_ts" | "event_id">,
    ): LinearizedPDU {
        const template: Omit<LinearizedPDU, "signatures"> = {
            room_id: this.roomId,
            type: partial.type,
            state_key: partial.state_key,
            sender: partial.sender,
            origin_server_ts: new Date().getTime(),
            hub_server: this.hubDomain,
            content: partial.content,
        };
        const redacted = this.roomVersion.redact(template);
        const signed = Runtime.signingKey.signJson(redacted);
        return {
            ...template,
            signatures: signed.signatures,
        };
    }

    public doInvite(senderUserId: string, targetUserId: string): Promise<void> {
        return this.sendEvent(
            this.createEvent({
                type: "m.room.member",
                state_key: targetUserId,
                sender: senderUserId,
                content: {
                    membership: "invite",
                },
            }),
        );
    }

    public doJoin(userId: string): Promise<void> {
        return this.sendEvent(
            this.createEvent({
                type: "m.room.member",
                state_key: userId,
                sender: userId,
                content: {
                    membership: "join",
                },
            }),
        );
    }

    public sendEvent(event: LinearizedPDU): Promise<void> {
        if (this.hubDomain === Runtime.signingKey.serverName) {
            throw new Error("Runtime error: Trying to send events to hub but we are the hub");
        }
        return new FederationClient(this.hubDomain).sendLinearizedPdus([event]);
    }

    public receiveEvent(event: LinearizedPDU): void {
        if (this.hubDomain === Runtime.signingKey.serverName) {
            throw new Error("Runtime error: Override issue - not receiving events in a HubRoom");
        }

        // otherwise it should be a PDU
        const fullEvent: MatrixEvent = {
            ...(event as PDU),
            event_id: `$${calculateReferenceHash(this.roomVersion.redact(event))}`,
        };
        this.events.push(fullEvent); // TODO: Splice properly - https://github.com/matrix-org/linearized-matrix/issues/24
        this.emitter.emit("event", fullEvent);
    }

    public getEvent(eventId: string): MatrixEvent | null {
        for (const event of this.events) {
            if (event.event_id == eventId) {
                return event;
            }
        }
        return null;
    }

    public on(event: "event", fn: (event: MatrixEvent) => void): void;
    public on(event: string, fn: (...args: any[]) => void): void {
        this.emitter.on(event, fn);
    }

    public off(event: "event", fn: (event: MatrixEvent) => void): void;
    public off(event: string, fn: (...args: any[]) => void): void {
        this.emitter.off(event, fn);
    }

    public static async createRoomFromCreateEvent(
        event: MatrixEvent,
        keyStore: KeyStore,
    ): Promise<ParticipantRoom | undefined> {
        const version = event["content"]?.["room_version"];
        const impl = getRoomVersionImpl(version);
        if (!impl) {
            return undefined;
        }

        const room = new ParticipantRoom(event["room_id"], impl, keyStore);
        await room.sendEvent(event);
        return room;
    }

    public static createFromOtherRoom(room: ParticipantRoom): ParticipantRoom {
        const newRoom = new ParticipantRoom(room.roomId, room.roomVersion, room.keyStore);
        newRoom.events = room.events;
        return newRoom;
    }
}
