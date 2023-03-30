import WebSocket from "ws";
import {Express} from "express";
import crypto from "crypto";
import {
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
import {Room} from "../models/Room";
import {RoomStore} from "../RoomStore";
import {MatrixEvent} from "../models/event";

interface ChatClient {
    ws: WebSocket;
    userId: string;
}

export class ClientServerApi {
    private clients: ChatClient[] = [];

    public constructor(private serverName: string, private roomServer: RoomStore) {}

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
                }
            });
        });
    }

    private sendToClient(client: ChatClient, packet: Packet) {
        client.ws.send(JSON.stringify(packet));
    }

    private sendToClients(room: Room, packet: Packet) {
        const userIds = room.joinedUserIds;
        for (const client of this.clients) {
            if (userIds.includes(client.userId)) {
                this.sendToClient(client, packet);
            }
        }
    }

    private sendEventsToClients(room: Room, events: MatrixEvent[]) {
        const userIds = room.joinedUserIds;
        for (const client of this.clients) {
            if (userIds.includes(client.userId)) {
                for (const event of events) {
                    this.sendEventToClient(client, event);
                }
            }
        }
    }

    private sendEventToClient(client: ChatClient, event: MatrixEvent) {
        if (event.type === "m.room.member") {
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
        this.sendToClient(client, {type: PacketType.Event, event: event} as EventPacket);
    }

    private userCreateRoom(client: ChatClient) {
        const room = this.roomServer.createRoom(client.userId);
        console.log(`${client.userId} | Room created: ${room.roomId}`);
        this.sendEventsToClients(room, room.orderedEvents);
    }

    private userJoinRoom(client: ChatClient, packet: JoinPacket) {
        const room = this.roomServer.getRoom(packet.targetRoomId);
        if (!room) {
            this.sendToClient(client, {
                type: PacketType.Error,
                message: "Unknown room",
                originalPacket: packet,
            } as ErrorPacket);
        } else {
            try {
                const membershipEvent = room.joinHelper(client.userId);
                if (!membershipEvent) {
                    this.sendToClient(client, {
                        type: PacketType.Error,
                        message: "Unable to join room",
                        originalPacket: packet,
                    } as ErrorPacket);
                } else {
                    this.sendEventsToClients(room, [membershipEvent]);
                }
            } catch (e) {
                this.sendToClient(client, {
                    type: PacketType.Error,
                    message: (e as Error)?.message ?? "Unknown error",
                    originalPacket: packet,
                } as ErrorPacket);
            }
        }
    }

    private userInviteRoom(client: ChatClient, packet: InvitePacket) {
        const room = this.roomServer.getRoom(packet.targetRoomId);
        if (!room) {
            this.sendToClient(client, {
                type: PacketType.Error,
                message: "Unknown room",
                originalPacket: packet,
            } as ErrorPacket);
        } else {
            try {
                const membershipEvent = room.inviteHelper(client.userId, packet.targetUserId);
                if (!membershipEvent) {
                    this.sendToClient(client, {
                        type: PacketType.Error,
                        message: "Unable to invite user to room",
                        originalPacket: packet,
                    } as ErrorPacket);
                } else {
                    this.sendEventsToClients(room, [membershipEvent]);

                    const targetClient = this.clients.find(c => c.userId === packet.targetUserId);
                    if (targetClient) {
                        this.sendEventToClient(targetClient, membershipEvent);
                    }
                }
            } catch (e) {
                this.sendToClient(client, {
                    type: PacketType.Error,
                    message: (e as Error)?.message ?? "Unknown error",
                    originalPacket: packet,
                } as ErrorPacket);
            }
        }
    }

    private userSend(client: ChatClient, packet: SendPacket) {
        const room = this.roomServer.getRoom(packet.roomId);
        if (!room) {
            this.sendToClient(client, {
                type: PacketType.Error,
                message: "Unknown room",
                originalPacket: packet,
            } as ErrorPacket);
        } else {
            const event = room.createEventFrom({
                type: packet.eventType,
                state_key: packet.stateKey,
                sender: client.userId,
                content: packet.content,
            });
            try {
                room.sendEvent(event);
                this.sendToClients(room, {type: PacketType.Event, event: event} as EventPacket);
            } catch (e) {
                this.sendToClient(client, {
                    type: PacketType.Error,
                    message: (e as Error)?.message ?? "Unknown error",
                    originalPacket: packet,
                } as ErrorPacket);
            }
        }
    }
}
