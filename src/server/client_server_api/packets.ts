import {ClientFriendlyMatrixEvent} from "../models/event";

export enum PacketType {
    Login, // Server -> Client
    CreateRoom, // Client -> Server
    RoomJoined, // Server -> Client
    Invite, // Client -> Server
    RoomInvited, // Server -> Client
    Join, // Client -> Server
    Error, // Either direction
    Send, // Client -> Server
    Event, // Server -> Client
    DumpRoomInfo, // Client -> Server
}

export interface Packet {
    type: PacketType;
}

export interface LoginPacket extends Packet {
    type: PacketType.Login;
    userId: string;
}

export interface RoomJoinedPacket extends Packet {
    type: PacketType.RoomJoined;
    roomId: string;
    targetUserId: string;
}

export interface InvitePacket extends Packet {
    type: PacketType.Invite;
    targetUserId: string;
    targetRoomId: string;
}

export interface RoomInvitedPacket extends Packet {
    type: PacketType.RoomInvited;
    roomId: string;
    targetUserId: string;
}

export interface JoinPacket extends Packet {
    type: PacketType.Join;
    targetRoomId: string;
}

export interface ErrorPacket extends Packet {
    type: PacketType.Error;
    message: string;
    originalPacket: Packet;
}

export interface SendPacket extends Packet {
    type: PacketType.Send;
    roomId: string;
    eventType: string;
    stateKey?: string;
    content: any;
}

export interface EventPacket extends Packet {
    type: PacketType.Event;
    event: ClientFriendlyMatrixEvent;
}

export interface DumpRoomInfoPacket extends Packet {
    type: PacketType.DumpRoomInfo;
    roomId: string;
}
