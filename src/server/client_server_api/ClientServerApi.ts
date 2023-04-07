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
import {HubRoom} from "../models/room/HubRoom";
import {RoomStore} from "../RoomStore";
import {MatrixEvent, PDU} from "../models/event";
import {InviteStore} from "../InviteStore";

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

    private onRoom(room: HubRoom): void {
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
                }
            });
        });
    }

    private sendToClient(client: ChatClient, packet: Packet) {
        client.ws.send(JSON.stringify(packet));
    }

    private sendEventsToClients(room: HubRoom, events: MatrixEvent[]) {
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
                room.createEvent({
                    type: packet.eventType,
                    state_key: packet.stateKey,
                    sender: client.userId,
                    content: packet.content,
                });
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
}
