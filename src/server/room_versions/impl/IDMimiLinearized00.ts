import {RoomVersion} from "../RoomVersion";
import {MatrixEvent} from "../../../models/event";
import {CurrentRoomState} from "../../../models/CurrentRoomState";
import {getDomainFromId} from "../../../util/id";
import {PowerLevels} from "../../../models/PowerLevels";

export class IDMimiLinearized00 implements RoomVersion {
    public static readonly Identifier = "org.matrix.i-d.ralston-mimi-linearized-matrix.00";

    public isValid(event: MatrixEvent): boolean {
        if (event.type === "m.room.create" && event.content["room_version"] !== IDMimiLinearized00.Identifier) {
            return false;
        }

        // TODO: This. https://github.com/matrix-org/linearized-matrix/issues/6
        return true;
    }

    public isAllowed(event: MatrixEvent, allEvents: MatrixEvent[]): boolean {
        // First we need to establish "current state"
        const currentState = new CurrentRoomState(allEvents);

        // Now we run the auth rules. These are v10's rules with some modifications
        // and without DAG bits.
        // https://spec.matrix.org/v1.6/rooms/v10/#authorization-rules

        if (event.type === "m.room.create") {
            if (allEvents.length) return false; // there are "previous events"; reject
            return true;
        }

        const createEvent = currentState.get("m.room.create", "");
        if (!createEvent) throw new Error("Invalid state: no room create event");
        if (createEvent.content["m.federate"] === false) {
            if (getDomainFromId(event.sender) != getDomainFromId(createEvent.sender)) {
                return false; // disallowed federation
            }
        }

        const joinRulesEv = currentState.get("m.room.join_rules", "");
        // TODO: Verify default state - https://github.com/matrix-org/linearized-matrix/issues/7
        const joinRule = joinRulesEv?.content["join_rule"] ?? "invite";

        const powerLevelsEv = currentState.get("m.room.power_levels", "");
        const powerLevels = new PowerLevels(powerLevelsEv);

        const senderMembershipEv = currentState.get("m.room.member", event.sender);
        const senderMembership = senderMembershipEv?.content["membership"] ?? "leave";

        if (event.type === "m.room.member") {
            if (!event.state_key || !event.content["membership"]) {
                return false; // missing a useful state key or membership field; reject
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
                    return true; // first member (the creator); allow
                }
                if (event.sender !== event.state_key) {
                    return false; // invalid membership transition; reject
                }
                if (senderMembership === "ban") {
                    return false; // they're banned; reject
                }
                if (joinRule === "invite" || joinRule === "knock") {
                    if (senderMembership === "invite" || senderMembership === "join") {
                        return true; // legal transition; allow
                    }
                }
                if (joinRule === "restricted" || joinRule === "knock_restricted") {
                    if (senderMembership === "invite" || senderMembership === "join") {
                        return true; // legal transition; allow
                    }
                    if (typeof event.content["join_authorised_via_users_server"] === "string") {
                        const authingUser = event.content["join_authorised_via_users_server"];
                        const authedUserEv = currentState.get("m.room.member", authingUser);
                        if (authedUserEv?.content["membership"] !== "join") {
                            return false; // authing user isn't in the room; reject
                        }
                        if (!powerLevels.canUserDo(authingUser, "invite")) {
                            return false; // authing user can't send invites here; reject
                        }
                    }
                    return true;
                }
                return joinRule === "public"; // allow if public, otherwise reject
            } else if (event.content["membership"] === "invite") {
                if (event.content["third_party_invite"] !== undefined) {
                    // TODO: Validate 3pid invite (4.4.1 of auth rules)
                    // https://github.com/matrix-org/linearized-matrix/issues/4
                    return false;
                }

                if (senderMembership !== "join") return false; // not joined; reject
                if (currentTargetMembership === "join" || currentTargetMembership === "ban") {
                    return false; // already joined or banned; reject
                }

                // allow if the sender can invite, otherwise reject
                return powerLevels.canUserDo(event.sender, "invite");
            } else if (event.content["membership"] === "leave") {
                if (event.state_key === event.sender) {
                    return senderMembership === "invite" || senderMembership === "join" || senderMembership === "knock";
                }

                if (senderMembership !== "join") return false; // not joined; reject

                if (currentTargetMembership === "ban" && !powerLevels.canUserDo(event.sender, "ban")) {
                    return false; // can't unban
                }
                const senderLevel = powerLevels.getUserLevel(event.sender);
                const targetLevel = powerLevels.getUserLevel(event.state_key);
                return powerLevels.canUserDo(event.sender, "kick") && targetLevel < senderLevel; // user can kick
            } else if (event.content["membership"] === "ban") {
                const senderMembership =
                    currentState.get("m.room.member", event.sender)?.content["membership"] ?? "leave";
                if (senderMembership !== "join") return false; // not joined; reject

                const senderLevel = powerLevels.getUserLevel(event.sender);
                const targetLevel = powerLevels.getUserLevel(event.state_key);
                return powerLevels.canUserDo(event.sender, "ban") && targetLevel < senderLevel; // user can ban
            } else if (event.content["membership"] === "knock") {
                if (joinRule !== "knock" && joinRule !== "knock_restricted") {
                    return false; // can't knock here; reject
                }
                if (event.sender !== event.state_key) return false; // wrong user; reject
                return senderMembership !== "ban" && senderMembership !== "join"; // able to knock
            } else {
                return false; // unknown membership; reject
            }
        }

        if (senderMembership !== "join") {
            return false; // not in room; reject
        }

        if (event.type === "m.room.third_party_invite") {
            return powerLevels.canUserDo(event.sender, "invite"); // only allow if the user can invite others
        }

        if (!powerLevels.canUserSend(event.sender, event.type, event.state_key !== undefined)) {
            return false; // unable to send this event type; reject
        }

        if (event.state_key?.startsWith("@") && event.state_key !== event.sender) {
            return false; // trying to use a state key for another user; reject
        }

        if (event.type === "m.room.power_levels") {
            const intFields = ["users_default", "events_default", "state_default", "ban", "redact", "kick", "invite"];
            for (const field of intFields) {
                const val = event.content[field];
                if (val !== undefined && !Number.isInteger(val)) {
                    return false; // invalid value; reject
                }
            }

            const intMaps = ["events", "notifications"];
            for (const field of intMaps) {
                const val = event.content[field];
                if (val === undefined) continue;
                if (typeof val !== "object") return false; // invalid value; reject
                for (const v of Object.values(val)) {
                    if (!Number.isInteger(v)) {
                        return false; // invalid value; reject
                    }
                }
            }

            const usersMap = event.content["users"];
            if (usersMap !== undefined) {
                if (typeof usersMap !== "object") return false; // invalid value; reject
                for (const [k, v] of Object.entries(usersMap)) {
                    // TODO: Validate that key is a valid user ID properly
                    // We should be using the user ID grammar
                    // https://github.com/matrix-org/linearized-matrix/issues/3
                    if (!k.startsWith("@")) return false;
                    if (!Number.isInteger(v)) {
                        return false;
                    }
                }
            }

            if (powerLevelsEv === undefined) {
                return true; // allow the first power levels event
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
                        return false; // set too high; reject
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
                                if (v > userLevel) return false; // too high to change; reject
                                if (newMapV > userLevel) return false; // too high target; reject
                            }
                        } else {
                            // removed
                            if (v > userLevel) return false; // too high to change; reject
                        }
                    }
                    for (const [k, v] of Object.entries(newMap)) {
                        const oldMapV = oldMap[k];
                        if (oldMapV !== undefined) {
                            // already checked in above loop
                        } else {
                            // added
                            if (v > userLevel) return false; // too high target; reject
                        }
                    }
                } else if (oldMap !== undefined && newMap === undefined) {
                    // everything is being removed here
                    for (const v of Object.values(oldMap)) {
                        if (v > userLevel) return false; // too high to change; reject
                    }
                } else if (oldMap === undefined && newMap !== undefined) {
                    // everything is being added here
                    for (const v of Object.values(newMap)) {
                        if (v > userLevel) return false; // too high target; reject
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
                                if (v >= userLevel) return false; // too high to change; reject
                            }
                            if (newUserV > userLevel) return false; // too high target; reject
                        }
                    } else {
                        // removed
                        if (k !== event.sender) {
                            if (v >= userLevel) return false; // too high to change; reject
                        }
                    }
                }
                for (const [k, v] of Object.entries(newUsers)) {
                    const oldUserV = oldUsers[k];
                    if (oldUserV !== undefined) {
                        // already checked in above loop
                    } else {
                        // added
                        if (v > userLevel) return false; // too high target; reject
                    }
                }
            }

            return true; // allow
        }

        return true; // "otherwise, allow" catch-all
    }

    public redact(event: MatrixEvent): object {
        return {}; // TODO: This. https://github.com/matrix-org/linearized-matrix/issues/8
    }
}
