import * as crypto from "crypto";
import {getDomainFromId} from "../util/id";
import {RoomVersion} from "../server/room_versions/RoomVersion";
import {ClientFriendlyMatrixEvent, MatrixEvent} from "./event";
import {CurrentRoomState} from "./CurrentRoomState";
import {DefaultRoomVersion, getRoomVersionImpl} from "../server/room_versions/map";

export class Room {
    private events: MatrixEvent[] = [];

    private constructor(public roomId: string, private roomVersion: RoomVersion) {}

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

    public trySendEvent(event: MatrixEvent): boolean {
        if (!this.roomVersion.isValid(event)) return false;
        if (!this.roomVersion.isAllowed(event, this.events)) return false;
        this.events.push(event);
        return true;
    }

    public createEventFrom(partial: Omit<ClientFriendlyMatrixEvent, "room_id" | "origin_server_ts">): MatrixEvent {
        return {
            room_id: this.roomId,
            type: partial.type,
            state_key: partial.state_key,
            sender: partial.sender,
            origin_server_ts: new Date().getTime(),
            // authorized_sending_server: "", // TODO: Figure out room owner, if not us
            content: partial.content,
            hashes: {
                // TODO: Calculate event hash properly
                sha256: "TODO",
            },
            signatures: {
                // TODO: Calculate event signature properly
                "example.org": {
                    "ed25519:1": "TODO",
                },
            },
        };
    }

    public joinHelper(userId: string): MatrixEvent | null {
        const membershipEvent: MatrixEvent = this.createEventFrom({
            type: "m.room.member",
            state_key: userId,
            sender: userId,
            content: {
                membership: "join",
            },
        });
        return this.trySendEvent(membershipEvent) ? membershipEvent : null;
    }

    public inviteHelper(senderUserId: string, targetUserId: string): MatrixEvent | null {
        const membershipEvent: MatrixEvent = this.createEventFrom({
            type: "m.room.member",
            state_key: targetUserId,
            sender: senderUserId,
            content: {
                membership: "invite",
            },
        });
        return this.trySendEvent(membershipEvent) ? membershipEvent : null;
    }

    public static create(creatorUserId: string): Room {
        // TODO: Validate that the creator is on our server
        const serverName = getDomainFromId(creatorUserId);
        const localpart = crypto.randomUUID();
        const roomId = `!${localpart}:${serverName}`;
        const room = new Room(roomId, getRoomVersionImpl(DefaultRoomVersion));
        if (
            !room.trySendEvent(
                room.createEventFrom({
                    type: "m.room.create",
                    state_key: "",
                    sender: creatorUserId,
                    content: {
                        room_version: DefaultRoomVersion,
                    },
                }),
            )
        ) {
            throw new Error("Unable to send initial m.room.create event");
        }
        if (!room.joinHelper(creatorUserId)) {
            throw new Error("Unable to send initial m.room.member event");
        }
        if (
            !room.trySendEvent(
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
            )
        ) {
            throw new Error("Unable to send initial m.room.power_levels event");
        }
        if (
            !room.trySendEvent(
                room.createEventFrom({
                    type: "m.room.join_rules",
                    state_key: "",
                    sender: creatorUserId,
                    content: {
                        join_rule: "invite",
                    },
                }),
            )
        ) {
            throw new Error("Unable to send initial m.room.join_rules event");
        }
        if (
            !room.trySendEvent(
                room.createEventFrom({
                    type: "m.room.history_visibility",
                    state_key: "",
                    sender: creatorUserId,
                    content: {
                        history_visibility: "shared",
                    },
                }),
            )
        ) {
            throw new Error("Unable to send initial m.room.history_visibility event");
        }
        return room;
    }
}
