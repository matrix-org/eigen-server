import * as crypto from "crypto";
import {getDomainFromId} from "../util/id";
import {RoomVersion} from "../room_versions/RoomVersion";
import {ClientFriendlyMatrixEvent, MatrixEvent} from "./event";
import {CurrentRoomState} from "./CurrentRoomState";
import {DefaultRoomVersion, getRoomVersionImpl} from "../room_versions/map";
import {calculateContentHash} from "../util/hashing";
import {Runtime} from "../Runtime";
import {KeyStore} from "../KeyStore";

export class Room {
    private events: MatrixEvent[] = [];

    private constructor(public roomId: string, private roomVersion: RoomVersion, private keyStore: KeyStore) {}

    public get versionString(): string {
        return this.roomVersion.id;
    }

    public get currentState(): CurrentRoomState {
        return new CurrentRoomState(this.events);
    }

    public get orderedEvents(): MatrixEvent[] {
        return [...this.events];
    }

    public get joinedUserIds(): string[] {
        const state = this.currentState;
        return state
            .getAll("m.room.member")
            .filter(e => e.content["membership"] === "join")
            .map(e => e.state_key!);
    }

    public get ownerDomain(): string {
        // TODO: Support owner transfer
        // https://github.com/matrix-org/linearized-matrix/issues/11
        const createEvent = this.currentState.get("m.room.create", "");
        if (createEvent === undefined) {
            return Runtime.signingKey.serverName; // we'll be creating this room
        }
        return getDomainFromId(createEvent.sender);
    }

    public get gatewayDomain(): string | undefined {
        const dagJoin = this.currentState
            .getAll("m.room.member")
            .filter(e => e.content["membership"] === "join")
            .find(e => e.owner_server === undefined);
        return dagJoin ? getDomainFromId(dagJoin.sender) : undefined;
    }

    /**
     * Sends an event to the room. Throws if there's a problem with that
     * (missing permission, illegal state, etc).
     *
     * Operates asynchronously.
     * @param event The event to send
     */
    public async sendEvent(event: MatrixEvent): Promise<void> {
        await this.roomVersion.checkValidity(event, this.keyStore);
        this.roomVersion.checkAuth(event, this.events);
        this.events.push(event);
    }

    public createEventFrom(
        partial: Omit<ClientFriendlyMatrixEvent, "room_id" | "origin_server_ts" | "event_id">,
    ): MatrixEvent {
        const template: Omit<MatrixEvent, "hashes" | "signatures"> = {
            room_id: this.roomId,
            type: partial.type,
            state_key: partial.state_key,
            sender: partial.sender,
            origin_server_ts: new Date().getTime(),
            owner_server: this.ownerDomain,
            content: partial.content,
        };
        if (this.ownerDomain === Runtime.signingKey.serverName) {
            template.delegated_server = this.gatewayDomain;
        }
        const hashed = calculateContentHash(template);
        const redacted = this.roomVersion.redact(hashed);
        const signed = Runtime.signingKey.signJson(redacted);
        return {
            ...hashed,
            signatures: signed.signatures,
        };
    }

    public async joinHelper(userId: string): Promise<MatrixEvent> {
        const membershipEvent: MatrixEvent = this.createEventFrom({
            type: "m.room.member",
            state_key: userId,
            sender: userId,
            content: {
                membership: "join",
            },
        });
        await this.sendEvent(membershipEvent);
        return membershipEvent;
    }

    public async inviteHelper(senderUserId: string, targetUserId: string): Promise<MatrixEvent> {
        const membershipEvent: MatrixEvent = this.createEventFrom({
            type: "m.room.member",
            state_key: targetUserId,
            sender: senderUserId,
            content: {
                membership: "invite",
            },
        });
        await this.sendEvent(membershipEvent);
        return membershipEvent;
    }

    public static async createRoomForRemoteJoin(
        userId: string,
        roomId: string,
        version: RoomVersion,
        keyStore: KeyStore,
    ): Promise<Room> {
        const room = new Room(roomId, version, keyStore);
        // We force the create event and sender member event into the "room" because we
        // already know they'll fail signature checks: we don't care about those checks.
        // The room created by this function is temporary and not stored.
        room.events.push(
            room.createEventFrom({
                type: "m.room.create",
                state_key: "",
                sender: userId,
                content: {
                    room_version: version.id,
                },
            }),
        );
        return room;
    }

    public static async createRoomForInvite(
        event: MatrixEvent,
        version: RoomVersion,
        keyStore: KeyStore,
    ): Promise<Room> {
        const room = new Room(event.room_id, version, keyStore);
        // We force the create event and sender member event into the "room" because we
        // already know they'll fail signature checks: we don't care about those checks.
        // The room created by this function is temporary and not stored.
        room.events.push(
            room.createEventFrom({
                type: "m.room.create",
                state_key: "",
                sender: event.sender,
                content: {
                    room_version: version.id,
                },
            }),
        );
        room.events.push(
            room.createEventFrom({
                type: "m.room.member",
                state_key: event.sender,
                sender: event.sender,
                content: {
                    membership: "join",
                },
            }),
        );
        await room.sendEvent(event);
        return room;
    }

    public static async create(creatorUserId: string, keyStore: KeyStore): Promise<Room> {
        // TODO: Validate that the creator is on our server
        const serverName = getDomainFromId(creatorUserId);
        const localpart = crypto.randomUUID();
        const roomId = `!${localpart}:${serverName}`;
        const room = new Room(roomId, getRoomVersionImpl(DefaultRoomVersion), keyStore);
        await room.sendEvent(
            room.createEventFrom({
                type: "m.room.create",
                state_key: "",
                sender: creatorUserId,
                content: {
                    room_version: DefaultRoomVersion,
                },
            }),
        );
        await room.joinHelper(creatorUserId);
        await room.sendEvent(
            room.createEventFrom({
                type: "m.room.power_levels",
                state_key: "",
                sender: creatorUserId,
                content: {
                    // Note: these values are deliberately non-default and are a best value approximation
                    ban: 50,
                    kick: 50,
                    invite: 50, // default 0
                    redact: 50,
                    notifications: {
                        room: 50,
                    },
                    event_default: 0,
                    state_default: 50,
                    events: {
                        // by default no events are specified in this map
                        "m.room.encryption": 100,
                        "m.room.history_visibility": 100,
                        "m.room.power_levels": 100,
                        "m.room.server_acl": 100,
                        "m.room.tombstone": 100,
                    },
                    users_default: 0,
                    users: {
                        // by default no users are specified in this map
                        [creatorUserId]: 100,
                    },
                },
            }),
        );
        await room.sendEvent(
            room.createEventFrom({
                type: "m.room.join_rules",
                state_key: "",
                sender: creatorUserId,
                content: {
                    join_rule: "invite",
                },
            }),
        );
        await room.sendEvent(
            room.createEventFrom({
                type: "m.room.history_visibility",
                state_key: "",
                sender: creatorUserId,
                content: {
                    history_visibility: "shared",
                },
            }),
        );
        return room;
    }
}
