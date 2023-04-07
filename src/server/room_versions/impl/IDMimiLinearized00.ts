import {RoomVersion} from "../RoomVersion";
import {AnyPDU, LinearizedPDU, MatrixEvent, PDU} from "../../models/event";
import {CurrentRoomState} from "../../models/CurrentRoomState";
import {getDomainFromId} from "../../util/id";
import {PowerLevels} from "../../models/PowerLevels";
import {RedactConfig, redactObject} from "../../util/redaction";
import Ajv, {Schema} from "ajv";
import AjvErrors from "ajv-errors";
import {KeyStore} from "../../KeyStore";
import {calculateContentHash} from "../../util/hashing";

const PduKeepFields: RedactConfig = {
    // https://spec.matrix.org/v1.6/rooms/v10/#redactions
    keepTopLevel: [
        "event_id",
        "type",
        "room_id",
        "sender",
        "state_key",
        "content",
        "hashes",
        "signatures",
        "prev_events",
        "auth_events",
        "origin_server_ts",
    ],
    keepUnder: {
        "m.room.member": {
            content: ["membership", "join_authorised_via_users_server"],
        },
        "m.room.create": {
            content: ["room_version"], // TODO: Other fields too
        },
        "m.room.join_rules": {
            content: ["join_rule", "allow"],
        },
        "m.room.power_levels": {
            content: ["ban", "events", "events_default", "kick", "redact", "state_default", "users", "users_default"],
        },
        "m.room.history_visibility": {
            content: ["history_visibility"],
        },
    },
};

const ajv = new Ajv({allErrors: true});
AjvErrors(ajv);

const EventSchema: Schema = {
    type: "object",
    properties: {
        event_id: {
            type: "string",
            minLength: 2, // sigil + characters, in theory
            pattern: "^\\$.+$",
            nullable: false,
        },
        room_id: {
            type: "string",
            minLength: 4, // sigil + colon + characters, in theory
            pattern: "^!.+:.+$",
            nullable: false,
        },
        type: {
            type: "string",
            nullable: false,
        },
        state_key: {
            type: "string",
            nullable: false,
        },
        sender: {
            type: "string",
            minLength: 4, // sigil + colon + characters, in theory
            pattern: "^@.+:.+$",
            nullable: false,
        },
        content: {
            type: "object",
            nullable: false,
            additionalProperties: true,
        },
        origin_server_ts: {
            type: "integer",
            // Ideally we'd specify our 2^56 limit here, but it's a bit too
            // weird for JSON Schema.
            nullable: false,
        },
        hub_server: {
            type: "string",
            nullable: false,
            minLength: 3, // "a.b" at a minimum
        },
        hashes: {
            type: "object",
            nullable: false,
            properties: {
                sha256: {
                    type: "string",
                    nullable: false,
                    minLength: 1, // probably more, honestly
                },
            },
            required: ["sha256"],
            errorMessage: {
                properties: {
                    sha256: "The sha256 hash is required and should be a non-empty string",
                },
            },
        },
        signatures: {
            type: "object",
            nullable: false,
            additionalProperties: false,
            patternProperties: {
                ".+": {
                    // domain name
                    type: "object",
                    nullable: false,
                    additionalProperties: false,
                    patternProperties: {
                        "ed25519:.+": {
                            // key ID
                            type: "string", // signature
                            nullable: false,
                            minLength: 1,
                        },
                    },
                },
            },
        },
        unsigned: {
            type: "object",
            nullable: false,
            additionalProperties: true,
        },
        auth_events: {
            type: "array",
            nullable: false,
            items: {
                type: "string",
            },
        },
        prev_events: {
            type: "array",
            nullable: false,
            items: {
                type: "string",
            },
        },
    },
    required: [
        "room_id",
        "type",
        "sender",
        "content",
        "origin_server_ts",
        "hashes",
        "signatures",
        "auth_events",
        "prev_events",
    ],
    errorMessage: {
        properties: {
            event_id: "The event ID should be a string prefixed with `$` and is required",
            room_id: "The room ID should be a string prefixed with `!` and contain a `:`, and is required",
            type: "The event type should be a string of zero or more characters, and is required",
            state_key: "The state key should be a string of zero or more characters",
            sender: "The sender should be a string prefixed with `@` and contain a `:`, and is required",
            content: "The event content should at least be a defined object, and is required",
            origin_server_ts: "The event timestamp should be a number, and is required",
            unsigned: "The event's unsigned content should be a defined object",
            hub_server: "The hub server should be a string representing a domain and is required",
            hashes: "Hashes should be an object with a sha256 field",
            signatures: "Signatures should be an object mapping domain to key ID to signature",
            auth_events: "Auth events must be an array of strings and is required",
            prev_events: "Previous events must be an array of strings and is required",
        },
    },
};
const TestEventFormatFn = ajv.compile(EventSchema);

export class IDMimiLinearized00 implements RoomVersion {
    public static readonly Identifier = "org.matrix.i-d.ralston-mimi-linearized-matrix.00";

    public get id(): string {
        return IDMimiLinearized00.Identifier;
    }

    public async checkValidity(event: PDU, keyStore: KeyStore): Promise<void> {
        if (!event) {
            throw new Error("Event validation failed: no event supplied");
        }

        if (event.type === "m.room.create" && event.content["room_version"] !== this.id) {
            throw new Error("m.room.create: Invalid room_version field");
        }

        if (!TestEventFormatFn(event)) {
            throw new Error(
                "Event failed validation: " +
                    (TestEventFormatFn.errors?.map(m => (m.message ? m.message : JSON.stringify(m))).join(", ") ??
                        "Validation failed"),
            );
        }

        if (typeof event.hub_server === "string") {
            // Verify the hub's signature
            let redacted = this.redact(event);
            if (!(await keyStore.validateDomainSignature(redacted, event.hub_server))) {
                throw new Error(`${event.type}: Validation Failed: Signature error on hub_server`);
            }

            const origin = getDomainFromId(event.sender);
            if (origin !== event.hub_server) {
                const linearizedPdu: LinearizedPDU & Partial<Exclude<PDU, keyof LinearizedPDU>> = JSON.parse(
                    JSON.stringify(event),
                );
                delete linearizedPdu["auth_events"];
                delete linearizedPdu["prev_events"];

                // Verify LPDU signature from origin
                redacted = this.redact(linearizedPdu);
                if (!(await keyStore.validateDomainSignature(redacted, origin))) {
                    throw new Error(`${event.type}: Validation Failed: Signature error from origin (LPDU)`);
                }
            }
        } else {
            // Verify sender signed PDU
            let redacted = this.redact(event);
            if (!(await keyStore.validateDomainSignature(redacted, origin))) {
                throw new Error(`${event.type}: Validation Failed: Signature error on origin (normal PDU)`);
            }
        }

        // Check content hash
        const hash = calculateContentHash(event).hashes.sha256;
        if (hash !== event.hashes.sha256) {
            throw new Error(`${event.type}: Validation Failed: Invalid content hash`);
        }

        // If we managed to make it here, we passed validation 🎉
    }

    public checkAuth(event: PDU, allEvents: MatrixEvent[]): void {
        // First we need to establish "current state"
        const currentState = new CurrentRoomState(allEvents);

        // Now we run the auth rules. These are v10's rules with some modifications.
        // https://spec.matrix.org/v1.6/rooms/v10/#authorization-rules

        if (event.type === "m.room.create") {
            if (allEvents.length) {
                // this isn't technically an auth rule, but a logic gate on our part
                throw new Error(`${event.type}: can't send a second create event`);
            }
            if (event.prev_events.length > 0) {
                throw new Error(`${event.type}: create event cannot have prev_events`);
            }
            if (getDomainFromId(event.sender) !== getDomainFromId(event.room_id)) {
                throw new Error(`${event.type}: create event sender must match room ID namespace`);
            }
            return; // allow
        }

        // Validate the auth events
        // TODO: Auth rule 2 - https://github.com/matrix-org/linearized-matrix/issues/23

        // TODO: Validate the event was sent by the hub server if a hub_server is set
        // https://github.com/matrix-org/linearized-matrix/issues/25

        const createEvent = currentState.get("m.room.create", "");
        if (!createEvent) throw new Error(`${event.type}: invalid state - no room create event`);
        if (createEvent.content["m.federate"] === false) {
            if (getDomainFromId(event.sender) != getDomainFromId(createEvent.sender)) {
                throw new Error(`${event.type}: federation disallowed`);
            }
        }

        const joinRulesEv = currentState.get("m.room.join_rules", "");
        // TODO: Verify default state - https://github.com/matrix-org/linearized-matrix/issues/7
        const joinRule = joinRulesEv?.content["join_rule"] ?? "invite";

        const powerLevelsEv = currentState.get("m.room.power_levels", "");
        const powerLevels = new PowerLevels(powerLevelsEv, createEvent);

        const senderMembershipEv = currentState.get("m.room.member", event.sender);
        const senderMembership = senderMembershipEv?.content["membership"] ?? "leave";

        if (event.type === "m.room.member") {
            if (!event.state_key || !event.content["membership"]) {
                throw new Error(`${event.type}: invalid or missing state_key`);
            }

            const currentTargetMembershipEv = currentState.get("m.room.member", event.state_key);
            const currentTargetMembership = currentTargetMembershipEv?.content["membership"] ?? "leave";

            if (event.content["join_authorised_via_users_server"]) {
                // TODO: Validate signature (should we do this as part of `isValid`?)
                // https://github.com/matrix-org/linearized-matrix/issues/5
                // if (!validSignature(event, getDomainFromId(event.content["join_authorised_via_users_server"]))) {
                //   return false; // invalid
                // }
            }

            if (event.content["membership"] === "join") {
                if (allEvents.length === 1 && createEvent.sender === event.sender) {
                    return; // first member (the creator); allow
                }
                if (event.sender !== event.state_key) {
                    throw new Error(`${event.type}: cannot send join event for someone else`);
                }
                if (senderMembership === "ban") {
                    throw new Error(`${event.type}: target user is banned`);
                }
                if (joinRule === "invite" || joinRule === "knock") {
                    if (senderMembership === "invite" || senderMembership === "join") {
                        return; // legal transition; allow
                    }
                }
                if (joinRule === "restricted" || joinRule === "knock_restricted") {
                    if (senderMembership === "invite" || senderMembership === "join") {
                        return; // legal transition; allow
                    }
                    if (typeof event.content["join_authorised_via_users_server"] === "string") {
                        const authingUser = event.content["join_authorised_via_users_server"];
                        const authedUserEv = currentState.get("m.room.member", authingUser);
                        if (authedUserEv?.content["membership"] !== "join") {
                            throw new Error(`${event.type}: user that is authenticating the join is not in the room`);
                        }
                        if (!powerLevels.canUserDo(authingUser, "invite")) {
                            throw new Error(`${event.type}: user that is authenticating the join cannot send invites`);
                        }
                    }
                    return; // allow
                }
                if (joinRule !== "public") {
                    throw new Error(`${event.type}: unknown join rule or operation not permitted with this join rule`);
                }
                return; // allow
            } else if (event.content["membership"] === "invite") {
                if (event.content["third_party_invite"] !== undefined) {
                    // TODO: Validate 3pid invite (4.4.1 of auth rules)
                    // https://github.com/matrix-org/linearized-matrix/issues/4
                    throw new Error(`${event.type}: third_party_invite support not implemented`);
                }

                if (senderMembership !== "join") {
                    throw new Error(`${event.type}: sender not in room`);
                }
                if (currentTargetMembership === "join" || currentTargetMembership === "ban") {
                    throw new Error(`${event.type}: already joined or banned from room`);
                }

                if (!powerLevels.canUserDo(event.sender, "invite")) {
                    throw new Error(`${event.type}: cannot send invites`);
                }
                return; // allow
            } else if (event.content["membership"] === "leave") {
                if (event.state_key === event.sender) {
                    if (senderMembership === "invite" || senderMembership === "join" || senderMembership === "knock") {
                        return; // allow
                    } else {
                        throw new Error(`${event.type}: cannot transition from ${senderMembership} to leave`);
                    }
                }

                if (senderMembership !== "join") {
                    throw new Error(`${event.type}: sender not in room`);
                }

                if (currentTargetMembership === "ban" && !powerLevels.canUserDo(event.sender, "ban")) {
                    throw new Error(`${event.type}: cannot unban user`);
                }
                const senderLevel = powerLevels.getUserLevel(event.sender);
                const targetLevel = powerLevels.getUserLevel(event.state_key);
                if (powerLevels.canUserDo(event.sender, "kick") && targetLevel < senderLevel) {
                    return; // allow
                } else {
                    throw new Error(`${event.type}: cannot kick user`);
                }
            } else if (event.content["membership"] === "ban") {
                const senderMembership =
                    currentState.get("m.room.member", event.sender)?.content["membership"] ?? "leave";
                if (senderMembership !== "join") {
                    throw new Error(`${event.type}: sender not in room`);
                }

                const senderLevel = powerLevels.getUserLevel(event.sender);
                const targetLevel = powerLevels.getUserLevel(event.state_key);
                if (powerLevels.canUserDo(event.sender, "ban") && targetLevel < senderLevel) {
                    return; // allow
                } else {
                    throw new Error(`${event.type}: cannot ban user`);
                }
            } else if (event.content["membership"] === "knock") {
                if (joinRule !== "knock" && joinRule !== "knock_restricted") {
                    throw new Error(`${event.type}: join rules do not permit knocking`);
                }
                if (event.sender !== event.state_key) {
                    throw new Error(`${event.type}: cannot knock on behalf of another user`);
                }
                if (senderMembership !== "ban" && senderMembership !== "join") {
                    return; // allow
                } else {
                    throw new Error(`${event.type}: cannot knock while banned or already joined to room`);
                }
            } else {
                throw new Error(`${event.type}: unknown membership state`);
            }
        }

        if (senderMembership !== "join") {
            throw new Error(`${event.type}: sender not in room`);
        }

        if (event.type === "m.room.third_party_invite") {
            if (powerLevels.canUserDo(event.sender, "invite")) {
                return; // allow
            } else {
                throw new Error(`${event.type}: cannot invite other users`);
            }
        }

        // TODO: Check m.room.hub rules - https://github.com/matrix-org/linearized-matrix/issues/26

        if (!powerLevels.canUserSend(event.sender, event.type, event.state_key !== undefined)) {
            throw new Error(`${event.type}: power levels do not permit sending this event`);
        }

        if (event.state_key?.startsWith("@") && event.state_key !== event.sender) {
            throw new Error(`${event.type}: cannot set a user ID-like state key for a user other than yourself`);
        }

        if (event.type === "m.room.power_levels") {
            const intFields = ["users_default", "events_default", "state_default", "ban", "redact", "kick", "invite"];
            for (const field of intFields) {
                const val = event.content[field];
                if (val !== undefined && !Number.isInteger(val)) {
                    throw new Error(`${event.type}: "${field}" must be an integer`);
                }
            }

            const intMaps = ["events", "notifications"];
            for (const field of intMaps) {
                const val = event.content[field];
                if (val === undefined) continue;
                if (typeof val !== "object") {
                    throw new Error(`${event.type}: "${field}" must be an object/map`);
                }
                for (const v of Object.values(val)) {
                    if (!Number.isInteger(v)) {
                        throw new Error(`${event.type}: values under "${field}" must be an integer`);
                    }
                }
            }

            const usersMap = event.content["users"];
            if (usersMap !== undefined) {
                if (typeof usersMap !== "object") {
                    throw new Error(`${event.type}: "users" must be an object/map`);
                }
                for (const [k, v] of Object.entries(usersMap)) {
                    // TODO: Validate that key is a valid user ID properly
                    // We should be using the user ID grammar
                    // https://github.com/matrix-org/linearized-matrix/issues/3
                    if (!k.startsWith("@")) {
                        throw new Error(`${event.type}: "${k}" under "users" must be a user ID`);
                    }
                    if (!Number.isInteger(v)) {
                        throw new Error(`${event.type}: "${k}" under "users" must have an integer value`);
                    }
                }
            }

            if (powerLevelsEv === undefined) {
                return; // allow the first power levels event
            }

            const userLevel = powerLevels.getUserLevel(event.sender);
            const modifyFields = [
                "users_default",
                "events_default",
                "state_default",
                "ban",
                "redact",
                "kick",
                "invite",
            ];
            for (const field of modifyFields) {
                const defaultLevel = ["events_default", "invite", "users_default"].includes(field) ? 0 : 50;
                if (event.content[field] !== powerLevelsEv.content[field]) {
                    const newLevel = event.content[field] ?? defaultLevel;
                    const oldLevel = powerLevelsEv.content[field] ?? defaultLevel;
                    if (newLevel > userLevel || oldLevel > userLevel) {
                        throw new Error(
                            `${event.type}: "${field}" has too high of a new/old value for this user to change`,
                        );
                    }
                }
            }
            const mapModifyFields = ["events", "notifications"];
            for (const map of mapModifyFields) {
                const oldMap = powerLevelsEv.content[map] as Record<string, number>;
                const newMap = event.content[map] as Record<string, number>;
                if (oldMap !== undefined && newMap !== undefined) {
                    // everything is changing in here (adding, removing, mutating)
                    for (const [k, v] of Object.entries(oldMap)) {
                        const newMapV = newMap[k];
                        if (newMapV !== undefined) {
                            if (newMapV !== v) {
                                // changing
                                if (v > userLevel) {
                                    throw new Error(
                                        `${event.type}: "${k}" under "${map}" has too high of an old value for this user to change`,
                                    );
                                }
                                if (newMapV > userLevel) {
                                    throw new Error(
                                        `${event.type}: "${k}" under "${map}" has too high of a new value for this user to change`,
                                    );
                                }
                            }
                        } else {
                            // removed
                            if (v > userLevel) {
                                throw new Error(
                                    `${event.type}: "${k}" under "${map}" has too high of an old value for this user to change`,
                                );
                            }
                        }
                    }
                    for (const [k, v] of Object.entries(newMap)) {
                        const oldMapV = oldMap[k];
                        if (oldMapV !== undefined) {
                            // already checked in above loop
                        } else {
                            // added
                            if (v > userLevel) {
                                throw new Error(
                                    `${event.type}: "${k}" under "${map}" has too high of a new value for this user to change`,
                                );
                            }
                        }
                    }
                } else if (oldMap !== undefined && newMap === undefined) {
                    // everything is being removed here
                    for (const [k, v] of Object.entries(oldMap)) {
                        if (v > userLevel) {
                            throw new Error(
                                `${event.type}: "${k}" under "${map}" has too high of an old value for this user to change`,
                            );
                        }
                    }
                } else if (oldMap === undefined && newMap !== undefined) {
                    // everything is being added here
                    for (const [k, v] of Object.entries(newMap)) {
                        if (v > userLevel) {
                            throw new Error(
                                `${event.type}: "${k}" under "${map}" has too high of a new value for this user to change`,
                            );
                        }
                    }
                }
            }

            const oldUsers = powerLevelsEv.content["users"] as Record<string, number>;
            const newUsers = event.content["users"] as Record<string, number>;
            if (oldUsers !== undefined && newUsers !== undefined) {
                // everything is changing here (adding, removing, mutating)
                for (const [k, v] of Object.entries(oldUsers)) {
                    const newUserV = newUsers[k];
                    if (newUserV !== undefined) {
                        if (newUserV !== v) {
                            // changing
                            if (k !== event.sender) {
                                if (v >= userLevel) {
                                    throw new Error(
                                        `${event.type}: "${k}" under "users" has too high of an old value for this user to change`,
                                    );
                                }
                            }
                            if (newUserV > userLevel) {
                                throw new Error(
                                    `${event.type}: "${k}" under "users" has too high of a new value for this user to change`,
                                );
                            }
                        }
                    } else {
                        // removed
                        if (k !== event.sender) {
                            if (v >= userLevel) {
                                throw new Error(
                                    `${event.type}: "${k}" under "users" has too high of an old value for this user to change`,
                                );
                            }
                        }
                    }
                }
                for (const [k, v] of Object.entries(newUsers)) {
                    const oldUserV = oldUsers[k];
                    if (oldUserV !== undefined) {
                        // already checked in above loop
                    } else {
                        // added
                        if (v > userLevel) {
                            throw new Error(
                                `${event.type}: "${k}" under "users" has too high of a new value for this user to change`,
                            );
                        }
                    }
                }
            }

            return; // allow
        }

        return; // "otherwise, allow" catch-all
    }

    public redact(event: AnyPDU | Omit<AnyPDU, "signatures">): object {
        return redactObject(event, PduKeepFields);
    }
}
