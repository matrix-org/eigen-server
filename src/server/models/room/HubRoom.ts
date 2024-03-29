import * as crypto from "crypto";
import {getDomainFromId} from "../../util/id";
import {InterstitialLPDU, LinearizedPDU, MatrixEvent, PDU} from "../event";
import {DefaultRoomVersion, getRoomVersionImpl} from "../../room_versions/map";
import {calculateContentHash, calculateReferenceHash} from "../../util/hashing";
import {Runtime} from "../../Runtime";
import {KeyStore} from "../../KeyStore";
import {FederationClient} from "../../FederationClient";
import {ParticipantRoom} from "./ParticipantRoom";
import {CurrentRoomState} from "../CurrentRoomState";

export class HubRoom extends ParticipantRoom {
    public get orderedEvents(): MatrixEvent[] {
        return this.timeline.currentEvents; // clones array internally
    }

    public async sendEvent(event: MatrixEvent | LinearizedPDU): Promise<void> {
        if (this.hubDomain !== Runtime.signingKey.serverName) {
            throw new Error("Runtime error: Asked to send an event as a hub but we're not the hub");
        }

        // We're the hub, so we need to convert this to a PDU and sign it
        const fullEvent = this.formalizeEvent(event);

        await this.reallySendEvent(fullEvent);
    }

    private formalizeEvent(event: PDU | LinearizedPDU): MatrixEvent {
        const pdu: PDU = {
            ...event,
            auth_events: [],
            prev_events: [],
            hashes: {
                sha256: "",
                lpdu: event.hashes.lpdu,
            },
        };

        // First: auth & prev events selection
        if (event.type !== "m.room.create") {
            const state = this.currentState;
            const authIds: string[] = [state.get("m.room.create", "")!.event_id];

            const powerLevelsEvent = state.get("m.room.power_levels", "");
            if (powerLevelsEvent) {
                authIds.push(powerLevelsEvent.event_id);
            }

            const senderEvent = state.get("m.room.member", event.sender);
            if (senderEvent) {
                authIds.push(senderEvent.event_id);
            }

            if (event.type === "m.room.member") {
                const targetEvent = state.get("m.room.member", event.state_key!);
                if (targetEvent && event.state_key !== event.sender) {
                    authIds.push(targetEvent.event_id);
                }

                if (event.content["membership"] === "invite" || event.content["membership"] === "join") {
                    const joinRulesEvent = state.get("m.room.join_rules", "");
                    if (joinRulesEvent) {
                        authIds.push(joinRulesEvent.event_id);
                    }
                }

                // We skip third party invite event selection here

                if (typeof event.content["join_authorised_via_users_server"] === "string") {
                    authIds.push(
                        state.get("m.room.member", event.content["join_authorised_via_users_server"])!.event_id,
                    );
                }
            }

            // TODO: This is horrible for performance
            const prevIds: string[] = [this.timeline.lastEvent!.event_id];

            pdu.auth_events = Array.from(new Set(authIds));
            pdu.prev_events = prevIds;
        }

        const hashed = calculateContentHash(pdu);
        const realPdu: PDU = {...pdu, hashes: {...hashed.hashes, lpdu: pdu.hashes.lpdu}};

        if ((realPdu.hashes.lpdu?.sha256?.length ?? 0) === 0) {
            delete realPdu.hashes.lpdu;
        }

        const redacted = this.roomVersion.redact(realPdu);
        const signed = Runtime.signingKey.signJson(redacted);
        realPdu.signatures = signed.signatures;

        return {
            ...realPdu,
            event_id: `$${calculateReferenceHash(redacted)}`,
        };
    }

    public async receivePdu(event: PDU): Promise<void> {
        const fullEvent: MatrixEvent = {
            ...event,
            event_id: `$${calculateReferenceHash(this.roomVersion.redact(event))}`,
        };

        await this.reallySendEvent(fullEvent);
    }

    public async reallySendEvent(event: MatrixEvent): Promise<void> {
        if (event.type === "m.room.member" && event.content["membership"] === "invite") {
            const remote = getDomainFromId(event.state_key!);
            if (remote !== this.hubDomain) {
                const isJoined = this.joinedUserIds.some(i => i.endsWith(`:${remote}`));
                if (!isJoined) {
                    const federation = new FederationClient(remote);
                    const initPdu: PDU & Partial<Omit<MatrixEvent, keyof PDU>> = {...event};
                    delete initPdu.event_id;
                    const pdu = await federation.sendInvite(initPdu, this.version);
                    const redacted = this.roomVersion.redact(pdu);

                    // Sanity check the returned PDU
                    if (
                        pdu.type !== "m.room.member" ||
                        pdu.content["membership"] !== "invite" ||
                        pdu.state_key !== event.state_key ||
                        pdu.sender !== event.sender
                    ) {
                        throw new Error("Failed post-invite validation: field mismatch");
                    }
                    if (!(await this.keyStore.validateDomainSignature(redacted, Runtime.signingKey.serverName))) {
                        throw new Error("Failed post-invite validation: event not signed by us");
                    }

                    const eventId = `$${calculateReferenceHash(redacted)}`;
                    event = {...pdu, event_id: eventId};
                }
            }
        }

        await this.inject(event);

        // fanout
        const joinedServers = new Set(this.joinedUserIds.map(m => getDomainFromId(m)));
        joinedServers.delete(this.hubDomain); // we don't want to send to ourselves

        for (const domain of joinedServers) {
            try {
                console.log(`Sending ${event.type} to ${domain}`);
                const federation = new FederationClient(domain);
                await federation.sendEvents([event]);
            } catch (e) {
                console.error(e);
            }
        }
    }

    private async inject(event: MatrixEvent): Promise<void> {
        const pdu: PDU & Partial<Omit<MatrixEvent, keyof PDU>> = {...event};
        delete pdu["event_id"];
        await this.roomVersion.checkValidity(pdu, this.keyStore);
        await this.timeline.insertEvents([event]); // checks auth internally
    }

    public createJoinTemplate(userId: string): InterstitialLPDU | undefined {
        const ev = this.formalizeEvent(
            this.createEvent({
                type: "m.room.member",
                state_key: userId,
                sender: userId,
                content: {
                    membership: "join",
                },
            }),
        );
        try {
            this.roomVersion.checkAuth(ev, this.timeline.currentEvents);
        } catch (e) {
            console.error(e);
            return undefined;
        }

        const lpdu: PDU & Partial<Omit<MatrixEvent, keyof LinearizedPDU>> = ev;

        // Remove the event ID, hashes, and signatures
        // TODO: @@TR: FIX TS
        delete lpdu["event_id"];
        // @ts-ignore
        delete lpdu["signatures"];
        // @ts-ignore
        delete lpdu["hashes"];

        // We don't know if the server asking to join uses a hub or not.
        delete lpdu["hub_server"];

        // TODO: Return a correct template/type
        return lpdu as any;
    }

    public async doSendJoin(join: PDU): Promise<{chain: PDU[]; event: PDU; state: PDU[]}> {
        // Append the PDU fields
        const event = this.formalizeEvent(join);

        // Create the event and add it to the room.
        await this.reallySendEvent(event);

        // TODO: This is horribly inefficient
        const authChain = this.timeline.currentEvents.filter(e => event.auth_events.includes(e.event_id));
        // const stateEvents = this.currentState.events;

        const toPdu = (e: MatrixEvent): PDU => {
            const clone = JSON.parse(JSON.stringify(e));
            delete clone["event_id"];
            return clone;
        };

        const pdu: PDU & Partial<Omit<MatrixEvent, keyof PDU>> = JSON.parse(JSON.stringify(event));
        delete pdu.event_id;

        return {
            chain: authChain.map(e => toPdu(e)),
            // TODO: This is not how we're supposed to handle `state`
            // TODO: https://github.com/matrix-org/eigen-server/issues/27
            // state: stateEvents.map(e => toPdu(e)),
            state: this.timeline.currentEvents.filter(e => e.event_id !== event.event_id).map(e => toPdu(e)),

            event: pdu,
        };
    }

    public static async createRoomFromCreateEvent(
        event: MatrixEvent,
        keyStore: KeyStore,
    ): Promise<HubRoom | undefined> {
        const version = event["content"]?.["room_version"];
        const impl = getRoomVersionImpl(version);
        if (!impl) {
            return undefined;
        }

        const room = new HubRoom(event["room_id"], impl, keyStore);
        await room.sendEvent(event);
        return room;
    }

    public static async create(creatorUserId: string, keyStore: KeyStore): Promise<HubRoom> {
        // TODO: Validate that the creator is on our server
        const serverName = getDomainFromId(creatorUserId);
        const localpart = crypto.randomUUID();
        const roomId = `!${localpart}:${serverName}`;
        const room = new HubRoom(roomId, getRoomVersionImpl(DefaultRoomVersion), keyStore);
        await room.sendEvent(
            room.createEvent({
                type: "m.room.create",
                state_key: "",
                sender: creatorUserId,
                content: {
                    room_version: DefaultRoomVersion,
                },
            }),
        );
        await room.doJoin(creatorUserId);
        await room.sendEvent(
            room.createEvent({
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
            room.createEvent({
                type: "m.room.join_rules",
                state_key: "",
                sender: creatorUserId,
                content: {
                    join_rule: "invite",
                },
            }),
        );
        await room.sendEvent(
            room.createEvent({
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

    public static async createRoomFromState(pdus: PDU[], keyStore: KeyStore): Promise<HubRoom | undefined> {
        const currentState = new CurrentRoomState(pdus as MatrixEvent[]); // unsafe cast, but we know what we're doing here
        const createEvent = currentState.get("m.room.create", "")! as PDU;
        const version = getRoomVersionImpl(createEvent.content["room_version"]);
        if (!version) {
            return undefined;
        }

        // Now that we know the room version, give everything some event IDs
        const events: MatrixEvent[] = pdus.map(e => ({
            ...e,
            event_id: `$${calculateReferenceHash(version.redact(e))}`,
        }));

        const room = new HubRoom(createEvent.room_id, version, keyStore);
        for (const ev of events) {
            await room.inject(ev);
        }
        return room;
    }
}
