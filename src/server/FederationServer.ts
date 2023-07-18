import express, {Express} from "express";
import {RoomStore} from "./RoomStore";
import {MatrixEvent, PDU} from "./models/event";
import {getRoomVersionImpl} from "./room_versions/map";
import {KeyStore} from "./KeyStore";
import {HubRoom} from "./models/room/HubRoom";
import {getDomainFromId} from "./util/id";
import {Runtime} from "./Runtime";
import {InviteStore} from "./InviteStore";
import {CurrentRoomState} from "./models/CurrentRoomState";

export class FederationServer {
    public constructor(private roomStore: RoomStore, private keyStore: KeyStore, private inviteStore: InviteStore) {}

    public registerRoutes(app: Express) {
        app.put("/_matrix/federation/v1/send/:txnId", this.onTransactionRequest.bind(this));
        app.put(
            "/_matrix/federation/unstable/org.matrix.i-d.ralston-mimi-linearized-matrix.02/send/:txnId",
            this.onTransactionRequest.bind(this),
        );
        app.put("/_matrix/federation/v2/invite/:roomId/:eventId", this.onInviteRequest.bind(this));
        app.post(
            "/_matrix/federation/unstable/org.matrix.i-d.ralston-mimi-linearized-matrix.02/invite/:txnId",
            this.onInviteRequest.bind(this),
        );
        app.get("/_matrix/federation/v1/make_join/:roomId/:userId", this.onMakeJoinRequest.bind(this));
        app.put("/_matrix/federation/v2/send_join/:roomId/:eventId", this.onSendJoinRequest.bind(this));
        app.post(
            "/_matrix/federation/unstable/org.matrix.i-d.ralston-mimi-linearized-matrix.02/send_join/:txnId",
            this.onSendJoinRequest.bind(this),
        );
        app.get("/_matrix/federation/v1/event_auth/:roomId/:eventId", this.onEventAuthRequest.bind(this));
        app.get("/_matrix/federation/v1/query/profile", this.onQueryProfile.bind(this));
        app.get("/_matrix/federation/v1/event/:eventId", this.onEventRequestTxn.bind(this));
        app.get(
            "/_matrix/federation/unstable/org.matrix.i-d.ralston-mimi-linearized-matrix.02/event/:eventId",
            this.onEventRequest.bind(this),
        );
        app.get("/_matrix/federation/v1/state/:roomId", this.onRoomStateRequest.bind(this));
        app.get("/_matrix/federation/v1/state_ids/:roomId", this.onRoomStateIdsRequest.bind(this));
        app.get(
            "/_matrix/federation/unstable/org.matrix.i-d.ralston-mimi-linearized-matrix.02/backfill/:roomId",
            this.onBackfillRequest.bind(this),
        );
    }

    private async onInviteRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17
        // TODO: Handle transaction IDs - https://github.com/matrix-org/eigen-server/issues/32
        // TODO: Handle new invite logic flow (proxy send) - https://github.com/matrix-org/eigen-server/issues/33

        if (typeof req.body !== "object") {
            return res.status(400).json({errcode: "M_BAD_JSON"}); // we assume it was JSON, at least
        }

        const claimedRoomVersion = req.body["room_version"];
        if (typeof claimedRoomVersion !== "string") {
            return res.status(400).json({errcode: "M_UNSUPPORTED_ROOM_VERSION"});
        }

        const version = getRoomVersionImpl(claimedRoomVersion);
        if (!version) {
            return res.status(400).json({errcode: "M_UNSUPPORTED_ROOM_VERSION"});
        }

        try {
            const event = req.body["event"] as PDU;
            const room = this.roomStore.getRoom(event.room_id);
            if (room) {
                return res.status(400).json({errcode: "M_UNKNOWN", error: "Already know of this room"});
            }

            // Validate the event
            await version.checkValidity(event, this.keyStore);

            // Validate event aspects
            if (event.type !== "m.room.member") {
                return res.status(400).json({errcode: "M_INVALID_PARAM", error: "not a membership event"});
            }
            if (getDomainFromId(event.state_key!) !== Runtime.signingKey.serverName) {
                return res.status(400).json({errcode: "M_INVALID_PARAM", error: "event not for local member"});
            }
            if (event.content["membership"] !== "invite") {
                return res.status(400).json({errcode: "M_INVALID_PARAM", error: "not an invite"});
            }

            // It's valid enough - sign it
            const redacted = version.redact(event);
            const signed = Runtime.signingKey.signJson(redacted);

            // Store the invite (will inform clients down the line for us)
            this.inviteStore.addInvite(event);

            // Send the signed event back
            res.status(200).json({event: {...event, signatures: signed.signatures}});
        } catch (e) {
            return res.status(500).json({
                errcode: "M_UNKNOWN",
                error: `${e && typeof e === "object" ? (e as any).message ?? `${e}` : e}`,
            });
        }
    }

    private async onTransactionRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17

        const events = req.body["pdus"];
        if (!Array.isArray(events)) {
            return res.status(400).json({errcode: "M_BAD_JSON"}); // we assume it was JSON, at least
        }

        // TODO: Handle EDUs - https://github.com/matrix-org/eigen-server/issues/30

        for (const event of events) {
            const roomId = event["room_id"];
            if (typeof roomId !== "string") {
                continue;
            }

            let room = this.roomStore.getRoom(roomId);
            if (!room) {
                console.warn(`Ignoring event for ${roomId} because we don't know about that room`);
                continue;
            }

            try {
                if (room instanceof HubRoom) {
                    if (!!event.auth_events) {
                        await room.receivePdu(event);
                    } else {
                        await room.sendEvent(event);
                    }
                } else {
                    await room.receiveEvent(event);
                }
            } catch (e) {
                console.error(e);
                return res.status(500).json({
                    errcode: "M_UNKNOWN",
                    error: `${e && typeof e === "object" ? (e as any).message ?? `${e}` : e}`,
                });
            }
        }

        // TODO: Report failures - https://github.com/matrix-org/eigen-server/issues/31
        res.json({});
    }

    private async onMakeJoinRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17
        // TODO: Check that server could own the requesting user too

        let supportsVersions = req.query["ver"];
        if (!Array.isArray(supportsVersions)) {
            supportsVersions = [supportsVersions as string];
        } else {
            supportsVersions = supportsVersions as string[];
        }

        const room = this.roomStore.getRoom(req.params["roomId"]);
        if (!room) {
            return res.status(404).json({errcode: "M_NOT_FOUND"});
        }
        if (!supportsVersions.includes(room.version)) {
            return res.status(400).json({errcode: "M_INCOMPATIBLE_ROOM_VERSION"});
        }
        if (room.hubDomain !== Runtime.signingKey.serverName) {
            return res.status(400).json({errcode: "M_UNKNOWN", error: "This server is not the hub"});
        }
        if (!(room instanceof HubRoom)) {
            return res
                .status(500)
                .json({errcode: "M_UNKNOWN", error: "Expected to be the hub, but room isn't a hub room"});
        }

        const template = room.createJoinTemplate(req.params["userId"]);
        if (template) {
            res.status(200).json({event: template, room_version: room.version});
        } else {
            res.status(404).json({errcode: "M_NOT_FOUND", error: "Unjoinable with this user"});
        }
    }

    private async onSendJoinRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17
        // TODO: Check that server could own the requesting user too
        // TODO: Handle transaction IDs - https://github.com/matrix-org/eigen-server/issues/32

        if (typeof req.body !== "object") {
            return res.status(400).json({errcode: "M_BAD_JSON"}); // we assume it was JSON, at least
        }

        const event = req.body as PDU;
        if (
            event.type !== "m.room.member" ||
            event.content["membership"] !== "join" ||
            event.state_key !== event.sender ||
            !event.sender
        ) {
            res.status(400).json({errcode: "M_UNKNOWN", error: "Not a join event"});
        }

        const room = this.roomStore.getRoom(event.room_id);
        if (!room) {
            return res.status(404).json({errcode: "M_NOT_FOUND"});
        }
        if (room.hubDomain !== Runtime.signingKey.serverName) {
            return res.status(400).json({errcode: "M_UNKNOWN", error: "This server is not the hub"});
        }
        if (!(room instanceof HubRoom)) {
            return res
                .status(500)
                .json({errcode: "M_UNKNOWN", error: "Expected to be the hub, but room isn't a hub room"});
        }

        try {
            const response = await room.doSendJoin(event);
            res.status(200).json({
                auth_chain: response.chain,
                state: response.state,
                event: response.event,
                members_omitted: false,
                origin: Runtime.signingKey.serverName,
            });
        } catch (e) {
            console.error(e);
            return res.status(500).json({errcode: "M_UNKNOWN", error: "see logs"});
        }
    }

    private async onEventAuthRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17
        // TODO: Check that server can receive this event.

        console.log(`Received event_auth request for ${req.params["roomId"]} for ${req.params["eventId"]}`);

        if (typeof req.body !== "object") {
            return res.status(400).json({errcode: "M_BAD_JSON"}); // we assume it was JSON, at least
        }

        const room = this.roomStore.getRoom(req.params["roomId"]);
        if (!room) {
            return res.status(404).json({errcode: "M_NOT_FOUND"});
        }

        const event = room.getEvent(req.params["eventId"]);
        if (!event) {
            return res.status(404).json({errcode: "M_NOT_FOUND"});
        }

        const toPdu = (e: MatrixEvent): PDU => {
            const clone = JSON.parse(JSON.stringify(e));
            delete clone["event_id"];
            return clone;
        };

        res.status(200).json({
            auth_chain: event.auth_events
                .map(authEventId => room.getEvent(authEventId))
                .filter(e => !!e)
                // @ts-ignore
                .map(toPdu),
        });
    }

    private async onQueryProfile(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17

        // TODO Actually calculate if the user exists / support user profiles.
        // @ts-ignore
        const userId = req.params["user_id"];
        res.status(200).json({});
    }

    private getEvent(eventId: string): MatrixEvent | undefined {
        // We don't know what room this event is in, so let's just query them all
        // TODO: Track event IDs as globally unique
        // TODO: History visibility - https://github.com/matrix-org/eigen-server/issues/21
        for (const room of this.roomStore.allRooms) {
            const event = room.getEvent(eventId);
            if (!!event) {
                return event;
            }
        }

        return undefined;
    }

    private async onEventRequestTxn(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17
        // TODO: Check that server can receive this event - https://github.com/matrix-org/eigen-server/issues/21

        const event = this.getEvent(req.params["eventId"]);
        if (!!event) {
            // XXX: Why is this a transaction!?
            return res.status(200).json({
                origin: Runtime.signingKey.serverName,
                origin_server_ts: new Date().getTime(),
                pdus: [event],
            });
        }

        return res.status(404).json({errcode: "M_NOT_FOUND", error: "Exhausted all attempts to find event"});
    }

    private async onEventRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17
        // TODO: Check that server can receive this event - https://github.com/matrix-org/eigen-server/issues/21

        const event = this.getEvent(req.params["eventId"]);
        if (!!event) {
            return res.status(200).json(event);
        }

        return res.status(404).json({errcode: "M_NOT_FOUND", error: "Exhausted all attempts to find event"});
    }

    private getRoomState(roomId: string): [CurrentRoomState, MatrixEvent[]] | undefined {
        const room = this.roomStore.getRoom(roomId);
        if (!!room && room instanceof HubRoom) {
            // TODO: History visibility - https://github.com/matrix-org/eigen-server/issues/21
            const state = new CurrentRoomState(room.orderedEvents);
            const authChain: MatrixEvent[] = [];
            for (const ev of state.events) {
                for (const id of ev.auth_events) {
                    const authEv = room.getEvent(id);
                    if (!!authEv) {
                        authChain.push(authEv);
                    } else {
                        throw new Error(`Missing auth event: ${id}`);
                    }
                }
            }
            return [state, authChain];
        }
        return undefined;
    }

    private async onRoomStateRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17
        // TODO: Check that server can receive this event - https://github.com/matrix-org/eigen-server/issues/21

        const ret = this.getRoomState(req.params["roomId"]);
        if (!!ret) {
            const [state, chain] = ret;
            return res.status(200).json({
                auth_chain: chain,
                pdus: state.events,
            });
        }

        return res.status(404).json({errcode: "M_NOT_FOUND", error: "Exhausted all attempts to find room state"});
    }

    private async onRoomStateIdsRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17
        // TODO: Check that server can receive this event - https://github.com/matrix-org/eigen-server/issues/21

        const ret = this.getRoomState(req.params["roomId"]);
        if (!!ret) {
            const [state, chain] = ret;
            return res.status(200).json({
                auth_chain_ids: chain.map(e => e.event_id),
                pdus_ids: state.events.map(e => e.event_id),
            });
        }

        return res.status(404).json({errcode: "M_NOT_FOUND", error: "Exhausted all attempts to find room state"});
    }

    private async onBackfillRequest(req: express.Request, res: express.Response) {
        const startAtId = req.query["v"];
        let limit = Number(req.query["limit"]);

        if (!Number.isFinite(limit) || typeof startAtId !== "string") {
            return res.status(400).json({errcode: "M_NOT_JSON", error: "Invalid ID or limit"});
        }

        if (limit < 1 || limit > 10) {
            limit = 10;
        }

        const room = this.roomStore.getRoom(req.params["roomId"]);
        if (!!room && room instanceof HubRoom) {
            const events = room.orderedEvents; // cloned, safe to manipulate
            const idx = events.findIndex(e => e.event_id === startAtId);
            const ret: MatrixEvent[] = [];
            for (let i = idx; i > idx - limit && i >= 0; i--) {
                ret.push(events[i]);
            }
            if (ret.length > 0) {
                return res.status(200).json({pdus: ret});
            }
        }

        return res.status(404).json({errcode: "M_NOT_FOUND", error: "Exhausted all attempts to find room events"});
    }
}
