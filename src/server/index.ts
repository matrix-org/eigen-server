import express from "express";
import expressWs from "express-ws";
import * as crypto from "crypto";
import type WebSocket from "ws";
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
import {createRoom, Room} from "../models/room";
import {Keyserver} from "./keyserver";

const port: number = Number(process.env["LM_PORT"] ?? 3000);
const serverName = `localhost:${port}`;
const app = express();
const wsApp = expressWs(app).app;

console.log("Server name: ", serverName);

interface ChatClient {
    ws: WebSocket;
    userId: string;
}

let clients: ChatClient[] = [];
let rooms: Room[] = []; // TODO: Persist

wsApp.ws("/client", (ws, req) => {
    const client = {ws, userId: `@${crypto.randomUUID()}:${serverName}`};
    ws.on("close", () => {
        clients = clients.filter(c => c.ws != ws);
        console.log(`${client.userId} disconnected`);
    });
    console.log(`${client.userId} connected`);
    clients.push(client);
    sendToClient(client, {userId: client.userId, type: PacketType.Login} as LoginPacket);
    ws.on("message", data => {
        // console.log(`${client.userId} | ${data}`);
        const packet = JSON.parse(data as unknown as string) as Packet;
        console.log(`${client.userId} | ${JSON.stringify(packet)}`);
        switch (packet.type) {
            case PacketType.CreateRoom:
                return userCreateRoom(client);
            case PacketType.Join:
                return userJoinRoom(client, packet as JoinPacket);
            case PacketType.Invite:
                return userInviteRoom(client, packet as InvitePacket);
            case PacketType.Send:
                return userSend(client, packet as SendPacket);
        }
    });
});

new Keyserver(serverName).registerRoutes(app);

app.listen(port, () => console.log(`Listening on ${port}`));

function sendToClient(client: ChatClient, packet: Packet) {
    client.ws.send(JSON.stringify(packet));
}

function sendToClients(room: Room, packet: Packet) {
    const userIds = [...room.joined];
    for (const client of clients) {
        if (userIds.includes(client.userId)) {
            sendToClient(client, packet);
        }
    }
}

function userCreateRoom(client: ChatClient) {
    const room = createRoom(client.userId);
    rooms.push(room);
    sendToClient(client, {
        type: PacketType.RoomJoined,
        roomId: room.roomId,
        targetUserId: client.userId,
    } as RoomJoinedPacket);
    console.log(`${client.userId} | Room created: ${room.roomId}`);
}

function userJoinRoom(client: ChatClient, packet: JoinPacket) {
    const room = rooms.find(r => r.roomId === packet.targetRoomId);
    if (!room) {
        sendToClient(client, {type: PacketType.Error, message: "Unknown room", originalPacket: packet} as ErrorPacket);
    } else {
        try {
            room.join(client.userId);
            sendToClients(room, {
                type: PacketType.RoomJoined,
                roomId: room.roomId,
                targetUserId: client.userId,
            } as RoomJoinedPacket);
        } catch (e) {
            sendToClient(client, {
                type: PacketType.Error,
                message: (e as Error)?.message ?? "Unknown error",
                originalPacket: packet,
            } as ErrorPacket);
        }
    }
}

function userInviteRoom(client: ChatClient, packet: InvitePacket) {
    const room = rooms.find(r => r.roomId === packet.targetRoomId);
    if (!room || !room.isJoined(client.userId)) {
        sendToClient(client, {
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
            sendToClients(room, invitePacket);

            const targetClient = clients.find(c => c.userId === packet.targetUserId);
            if (targetClient) {
                sendToClient(targetClient, invitePacket);
            }
        } catch (e) {
            sendToClient(client, {
                type: PacketType.Error,
                message: (e as Error)?.message ?? "Unknown error",
                originalPacket: packet,
            } as ErrorPacket);
        }
    }
}

function userSend(client: ChatClient, packet: SendPacket) {
    const room = rooms.find(r => r.roomId === packet.roomId);
    if (!room || !room.isJoined(client.userId)) {
        sendToClient(client, {
            type: PacketType.Error,
            message: "Unknown room (to you)",
            originalPacket: packet,
        } as ErrorPacket);
    } else {
        sendToClients(room, {...packet, type: PacketType.Event, sender: client.userId} as EventPacket);
    }
}
