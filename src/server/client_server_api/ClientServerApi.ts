import WebSocket from "ws";
import express, {Express} from "express";
import crypto from "crypto";
import {DSRequestPacket, DSResponsePacket, LoginPacket, Packet, PacketType} from "./packets";
import expressWs from "express-ws";
import {RoomStore} from "../RoomStore";
import {MatrixEvent, PDU} from "../models/event";
import {InviteStore} from "../InviteStore";
import {ParticipantRoom} from "../models/room/ParticipantRoom";
import {HubRoom} from "../models/room/HubRoom";
import {CreateGroupBody, CreateGroupResponse, DSResponse} from "./MIMIDSProtocol";
import {tryAddRoom} from "../ds/store";
import {DSRoom} from "../ds/room";

interface ChatClient {
    ws: WebSocket;
    userId: string;
}

export class ClientServerApi {
    private clients: ChatClient[] = [];

    public constructor(private serverName: string, private roomStore: RoomStore, private inviteStore: InviteStore) {
        this.roomStore.on("room", this.onRoom.bind(this));
        this.inviteStore.on("invite", this.onInvite.bind(this));
    }

    private onRoom(room: ParticipantRoom): void {
        room.on("event", ev => {
            this.sendEventsToClients(room, [ev]);

            if (ev.type === "m.room.member" && ev.content["membership"] === "invite") {
                const targetClient = this.clients.find(c => c.userId === ev.state_key);
                if (targetClient) {
                    this.sendEventToClient(targetClient, ev);
                }
            }
        });
    }

    private onInvite(invite: PDU): void {
        const targetUser = invite.state_key!;
        const client = this.clients.find(c => c.userId === targetUser);
        if (client) {
            const event: MatrixEvent = {
                ...invite,
                event_id: "~generated", // TODO: Populate with real event ID?
            };
            this.sendEventToClient(client, event);
        }
    }

    public registerRoutes(app: Express) {
        const wsApp = expressWs(app).app;
        wsApp.ws("/client", (ws, req) => {
            let localpart: string = crypto.randomUUID();
            if (req.query["preferredLocalpart"]) {
                if (typeof req.query["preferredLocalpart"] === "string") {
                    localpart = req.query["preferredLocalpart"];
                }
            }
            let userId = `@${localpart}:${this.serverName}`;
            if (this.clients.some(c => c.userId === userId)) {
                userId = `@${crypto.randomUUID()}:${this.serverName}`;
            }
            const client = {ws, userId: userId};
            ws.on("close", () => {
                this.clients = this.clients.filter(c => c.ws != ws);
                console.log(`${client.userId} disconnected`);
            });
            console.log(`${client.userId} connected`);
            this.clients.push(client);
            // TODO: @TR: Proper multi-device
            this.sendToClient(client, {deviceId: "ABCD", userId: client.userId, type: PacketType.Login} as LoginPacket);
            ws.on("message", data => {
                // console.log(`${client.userId} | ${data}`);
                const packet = JSON.parse(data as unknown as string) as Packet;
                console.log(`${client.userId} | ${JSON.stringify(packet)}`);
                switch (packet.type) {
                    case PacketType.DSRequest:
                        return this.userDSRequest(client, packet as DSRequestPacket);
                }
            });
        });
        app.get("/dump/:roomId", this.userWantsRoomDumpHttp.bind(this));
    }

    private sendToClient(client: ChatClient, packet: Packet) {
        client.ws.send(JSON.stringify(packet));
    }

    private sendEventsToClients(room: ParticipantRoom, events: MatrixEvent[]) {
        const userIds = room.joinedUserIds;
        for (const client of this.clients) {
            if (userIds.includes(client.userId)) {
                for (const event of events) {
                    this.sendEventToClient(client, event);
                }
            }
        }
    }

    private sendEventToClient(client: ChatClient, event: MatrixEvent, raw = false) {
        // if (event.type === "m.room.member" && !raw) {
        //     const membership = event.content["membership"];
        //     if (membership === "join") {
        //         this.sendToClient(client, {
        //             type: PacketType.RoomJoined,
        //             roomId: event.room_id,
        //             targetUserId: event.state_key,
        //         } as RoomJoinedPacket);
        //         return; // skip remaining processing
        //     } else if (membership === "invite") {
        //         this.sendToClient(client, {
        //             type: PacketType.RoomInvited,
        //             roomId: event.room_id,
        //             targetUserId: event.state_key,
        //         } as RoomInvitedPacket);
        //         return; // skip remaining processing
        //     }
        // }
        // this.sendToClient(client, {type: PacketType.Event, event: event, rawFormat: raw} as EventPacket);
    }

    private async userWantsRoomDumpHttp(req: express.Request, res: express.Response) {
        // TODO: Some sort of authentication on this endpoint
        const room = this.roomStore.getRoom(req.params["roomId"]);
        if (!room) {
            return res.status(404).json({errcode: "M_NOT_FOUND"});
        } else {
            if (room instanceof HubRoom) {
                return res.status(200).json(room.orderedEvents);
            } else {
                return res
                    .status(500)
                    .json({errcode: "M_UNKNOWN", error: "Room is not a HubRoom and cannot be introspected"});
            }
        }
    }

    private async userDSRequest(client: ChatClient, packet: DSRequestPacket) {
        let waitPromise: Promise<DSResponse> | undefined;
        switch (packet.requestBody.type) {
            case "create_group":
                waitPromise = this.userDSCreateGroup(client, packet.requestBody as CreateGroupBody);
                break;
            default:
                console.log("Unknown DS request");
                return;
        }

        if (waitPromise) {
            const resp = await waitPromise;
            this.sendToClient(client, <DSResponsePacket>{
                type: PacketType.DSResponse,
                requestId: packet.requestId,
                responseBody: resp,
            });
        }
    }

    private async userDSCreateGroup(client: ChatClient, body: CreateGroupBody): Promise<CreateGroupResponse> {
        let dsRoom: DSRoom;
        try {
            dsRoom = tryAddRoom(body.groupId);
        } catch (e) {
            console.error(e);
            return {error: "invalid_group_id"};
        }

        dsRoom.mlsPublicState = body.groupInfo;
        const memberUserIds = dsRoom.getMemberUserIds();
        if (memberUserIds)
    }
}
