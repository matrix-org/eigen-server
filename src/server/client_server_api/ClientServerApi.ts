import WebSocket from "ws";
import express, {Express} from "express";
import crypto from "crypto";
import {
    DumpRoomInfoPacket,
    ErrorPacket,
    EventPacket,
    InvitePacket,
    JoinPacket,
    LoginPacket,
    Packet,
    PacketType,
    RoomInvitedPacket,
    RoomJoinedPacket,
    SendPacket,
} from "./packets";
import expressWs from "express-ws";
import {RoomStore} from "../RoomStore";
import {MatrixEvent, PDU} from "../models/event";
import {InviteStore} from "../InviteStore";
import {ParticipantRoom} from "../models/room/ParticipantRoom";
import {HubRoom} from "../models/room/HubRoom";

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
            const client = {ws, userId: `@${crypto.randomUUID()}:${this.serverName}`};
            ws.on("close", () => {
                this.clients = this.clients.filter(c => c.ws != ws);
                console.log(`${client.userId} disconnected`);
            });
            console.log(`${client.userId} connected`);
            this.clients.push(client);
            this.sendToClient(client, {userId: client.userId, type: PacketType.Login} as LoginPacket);
            ws.on("message", data => {
                // console.log(`${client.userId} | ${data}`);
                const packet = JSON.parse(data as unknown as string) as Packet;
                console.log(`${client.userId} | ${JSON.stringify(packet)}`);
                switch (packet.type) {
                    case PacketType.CreateRoom:
                        return this.userCreateRoom(client);
                    case PacketType.Join:
                        return this.userJoinRoom(client, packet as JoinPacket);
                    case PacketType.Invite:
                        return this.userInviteRoom(client, packet as InvitePacket);
                    case PacketType.Send:
                        return this.userSend(client, packet as SendPacket);
                    case PacketType.DumpRoomInfo:
                        return this.userWantsRoomDump(client, packet as DumpRoomInfoPacket);
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
        if (event.type === "m.room.member" && !raw) {
            const membership = event.content["membership"];
            if (membership === "join") {
                this.sendToClient(client, {
                    type: PacketType.RoomJoined,
                    roomId: event.room_id,
                    targetUserId: event.state_key,
                } as RoomJoinedPacket);
                return; // skip remaining processing
            } else if (membership === "invite") {
                this.sendToClient(client, {
                    type: PacketType.RoomInvited,
                    roomId: event.room_id,
                    targetUserId: event.state_key,
                } as RoomInvitedPacket);
                return; // skip remaining processing
            }
        }
        this.sendToClient(client, {type: PacketType.Event, event: event, rawFormat: raw} as EventPacket);
    }

    private async userCreateRoom(client: ChatClient) {
        const room = await this.roomStore.createRoom(client.userId);
        console.log(`${client.userId} | Room created: ${room.roomId}`);
        this.sendEventsToClients(room, room.orderedEvents);
    }

    private async userJoinRoom(client: ChatClient, packet: JoinPacket) {
        const room = this.roomStore.getRoom(packet.targetRoomId);
        try {
            if (!room) {
                await this.inviteStore.acceptInvite(packet.targetRoomId, client.userId);
            } else {
                await room.doJoin(client.userId);
            }
        } catch (e) {
            console.error(e);
            this.sendToClient(client, {
                type: PacketType.Error,
                message: "Unknown room",
                originalPacket: packet,
            } as ErrorPacket);
        }
    }

    private async userInviteRoom(client: ChatClient, packet: InvitePacket) {
        const room = this.roomStore.getRoom(packet.targetRoomId);
        if (!room) {
            this.sendToClient(client, {
                type: PacketType.Error,
                message: "Unknown room",
                originalPacket: packet,
            } as ErrorPacket);
        } else {
            try {
                await room.doInvite(client.userId, packet.targetUserId);
            } catch (e) {
                console.error(e);
                this.sendToClient(client, {
                    type: PacketType.Error,
                    message: (e as Error)?.message ?? "Unknown error",
                    originalPacket: packet,
                } as ErrorPacket);
            }
        }
    }

    private async userSend(client: ChatClient, packet: SendPacket) {
        const room = this.roomStore.getRoom(packet.roomId);
        if (!room) {
            this.sendToClient(client, {
                type: PacketType.Error,
                message: "Unknown room",
                originalPacket: packet,
            } as ErrorPacket);
        } else {
            try {
                await room.sendEvent(
                    room.createEvent({
                        type: packet.eventType,
                        state_key: packet.stateKey,
                        sender: client.userId,
                        content: packet.content,
                    }),
                );
            } catch (e) {
                console.error(e);
                this.sendToClient(client, {
                    type: PacketType.Error,
                    message: (e as Error)?.message ?? "Unknown error",
                    originalPacket: packet,
                } as ErrorPacket);
            }
        }
    }

    private async userWantsRoomDump(client: ChatClient, packet: DumpRoomInfoPacket) {
        const room = this.roomStore.getRoom(packet.roomId);
        if (!room) {
            this.sendToClient(client, {
                type: PacketType.Error,
                message: "Unknown room",
                originalPacket: packet,
            } as ErrorPacket);
        } else {
            if (room instanceof HubRoom) {
                for (const event of room.orderedEvents) {
                    this.sendEventToClient(client, event, true);
                }
            } else {
                this.sendToClient(client, {
                    type: PacketType.Error,
                    message: "Room is not a HubRoom and cannot be introspected",
                    originalPacket: packet,
                } as ErrorPacket);
            }
        }
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
}
