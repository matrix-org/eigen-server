import express, {Express} from "express";
import {RoomStore} from "./RoomStore";
import {MatrixEvent} from "./models/event";
import {getRoomVersionImpl} from "./room_versions/map";
import {KeyStore} from "./KeyStore";
import {Room} from "./models/Room";
import {getDomainFromId} from "./util/id";
import {Runtime} from "./Runtime";
import {ClientServerApi} from "./client_server_api/ClientServerApi";

export class FederationServer {
    public constructor(private roomStore: RoomStore, private keyStore: KeyStore, private csApi: ClientServerApi) {}

    public registerRoutes(app: Express) {
        // TODO: Use transaction IDs - https://github.com/matrix-org/linearized-matrix/issues/16
        app.post("/_matrix/linearized/unstable/send", this.onSendRequest.bind(this));
        app.post("/_matrix/linearized/unstable/invite", this.onInviteRequest.bind(this));
    }

    private async onInviteRequest(req: express.Request, res: express.Response) {
        const claimedRoomVersion = req.query["room_version"];
        if (typeof claimedRoomVersion !== "string") {
            return res.status(400).json({errcode: "M_UNSUPPORTED_ROOM_VERSION"});
        }

        const version = getRoomVersionImpl(claimedRoomVersion);
        if (!version) {
            return res.status(400).json({errcode: "M_UNSUPPORTED_ROOM_VERSION"});
        }

        if (typeof req.body !== "object") {
            return res.status(400).json({errcode: "M_BAD_JSON"}); // we assume it was JSON, at least
        }

        try {
            const event = req.body as MatrixEvent;
            await Room.createRoomForInvite(event, version, this.keyStore);

            // We were able to create a holding room and send the event to it, which means the event has a valid structure
            if (event.type !== "m.room.member") {
                return res.status(400).json({errcode: "M_INVALID_PARAM"});
            }
            if (getDomainFromId(event.state_key!) !== Runtime.signingKey.serverName) {
                return res.status(400).json({errcode: "M_INVALID_PARAM"});
            }

            // Inform the client that we have an invite for them
            this.csApi.sendEventToUserId(event.state_key!, event);
        } catch (e) {
            return res.status(500).json({
                errcode: "M_UNKNOWN",
                error: `${e && typeof e === "object" ? (e as any).message ?? `${e}` : e}`,
            });
        }

        res.json({});
    }

    private async onSendRequest(req: express.Request, res: express.Response) {
        // TODO: Validate auth header - https://github.com/matrix-org/linearized-matrix/issues/17

        const events = req.body;
        if (!Array.isArray(events)) {
            return res.status(400).json({errcode: "M_BAD_JSON"}); // we assume it was JSON, at least
        }

        const rejected: any = [];
        for (const event of events) {
            const roomId = event["room_id"];
            if (typeof roomId !== "string") {
                rejected.push(event);
                continue;
            }

            const room = this.roomStore.getRoom(roomId);
            if (!room) {
                rejected.push(event);
                continue;
            }

            // TODO: Ensure we route invites correctly - https://github.com/matrix-org/linearized-matrix/issues/19

            try {
                await room.sendEvent(event);
                this.csApi.sendEventsToClients(room, [event]);
                // TODO: Fan out - https://github.com/matrix-org/linearized-matrix/issues/20
            } catch (e) {
                rejected.push(event);
                return res.status(500).json({
                    errcode: "M_UNKNOWN",
                    error: `${e && typeof e === "object" ? (e as any).message ?? `${e}` : e}`,
                });
            }
        }
    }
}
