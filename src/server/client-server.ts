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
} from "../client-server-api/packets";
import expressWs from "express-ws";
import {Room} from "../models/room";
import {RoomServer} from "./room-server";

interface ChatClient {
    ws: WebSocket;
    userId: string;
}

export class ClientServerApi {
    private clients: ChatClient[] = [];

    public constructor(private serverName: string, private roomServer: RoomServer) {}

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
        const userIds = [...room.joined];
        for (const client of this.clients) {
            if (userIds.includes(client.userId)) {
                this.sendToClient(client, packet);
            }
        }
    }

    private userCreateRoom(client: ChatClient) {
        const room = this.roomServer.createRoom(client.userId);
        this.sendToClient(client, {
            type: PacketType.RoomJoined,
            roomId: room.roomId,
            targetUserId: client.userId,
        } as RoomJoinedPacket);
        console.log(`${client.userId} | Room created: ${room.roomId}`);
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
                room.join(client.userId);
                this.sendToClients(room, {
                    type: PacketType.RoomJoined,
                    roomId: room.roomId,
                    targetUserId: client.userId,
                } as RoomJoinedPacket);
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
        if (!room || !room.isJoined(client.userId)) {
            this.sendToClient(client, {
                type: PacketType.Error,
                message: "Unknown room (to you)",
                originalPacket: packet,
            } as ErrorPacket);
        } else {
            try {
                room.invite(packet.targetUserId);
                const invitePacket: RoomInvitedPacket = {
                    type: PacketType.RoomInvited,
                    roomId: room.roomId,
                    targetUserId: packet.targetUserId,
                };
                this.sendToClients(room, invitePacket);

                const targetClient = this.clients.find(c => c.userId === packet.targetUserId);
                if (targetClient) {
                    this.sendToClient(targetClient, invitePacket);
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
        if (!room || !room.isJoined(client.userId)) {
            this.sendToClient(client, {
                type: PacketType.Error,
                message: "Unknown room (to you)",
                originalPacket: packet,
            } as ErrorPacket);
        } else {
            this.sendToClients(room, {...packet, type: PacketType.Event, sender: client.userId} as EventPacket);
        }
    }
}
