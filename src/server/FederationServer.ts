import express, {Express} from "express";
import {RoomStore} from "./RoomStore";
import {MatrixEvent, PDU} from "./models/event";
import {getRoomVersionImpl} from "./room_versions/map";
import {KeyStore} from "./KeyStore";
import {HubRoom} from "./models/room/HubRoom";
import {getDomainFromId} from "./util/id";
import {Runtime} from "./Runtime";
import {calculateReferenceHash} from "./util/hashing";
import {InviteStore} from "./InviteStore";

export class FederationServer {
    public constructor(private roomStore: RoomStore, private keyStore: KeyStore, private inviteStore: InviteStore) {}

    public registerRoutes(app: Express) {
        app.put("/_matrix/federation/v1/send/:txnId", this.onTransactionRequest.bind(this));
        app.put("/_matrix/federation/v2/invite/:roomId/:eventId", this.onInviteRequest.bind(this));
        app.get("/_matrix/federation/v1/make_join/:roomId/:userId", this.onMakeJoinRequest.bind(this));
        app.put("/_matrix/federation/v2/send_join/:roomId/:eventId", this.onSendJoinRequest.bind(this));
        app.get("/_matrix/federation/v1/event_auth/:roomId/:eventId", this.onEventAuthRequest.bind(this));
        app.get("/_matrix/federation/v1/query/profile", this.onQueryProfile.bind(this));
    }

    private async onInviteRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17

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

        const roomId = req.params["roomId"];
        const eventId = req.params["eventId"];

        const room = this.roomStore.getRoom(roomId);
        if (room) {
            return res.status(400).json({errcode: "M_UNKNOWN", error: "Already know of this room"});
        }

        try {
            const event = req.body["event"] as PDU;

            // Validate the event
            await version.checkValidity(event, this.keyStore);

            // Check event ID
            const redacted = version.redact(event);
            const calcEventId = `$${calculateReferenceHash(redacted)}`;
            if (calcEventId !== eventId) {
                return res.status(400).json({errcode: "M_UNKNOWN", error: "Event ID doesn't match"});
            }

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
                    room.receiveEvent(event);
                }
            } catch (e) {
                console.error(e);
                return res.status(500).json({
                    errcode: "M_UNKNOWN",
                    error: `${e && typeof e === "object" ? (e as any).message ?? `${e}` : e}`,
                });
            }
        }

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

        const room = this.roomStore.getRoom(req.params["roomId"]);
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
            const response = await room.doSendJoin(event, req.params["eventId"]);
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

        console.error(`Received event_auth request for ${req.params["roomId"]} for ${req.params["eventId"]}`);

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
        // TODO: Check that server can receive this event.

        console.error(`Received event_auth request for ${req.params["roomId"]} for ${req.params["eventId"]}`);

        if (typeof req.body !== "object") {
            return res.status(400).json({errcode: "M_BAD_JSON"}); // we assume it was JSON, at least
        }

        // TODO Actually calculate if the user exists / support user profiles.
        // @ts-ignore
        const userId = req.params["user_id"];
        res.status(200).json({});
    }
}
