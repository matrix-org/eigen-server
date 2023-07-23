import {DSProtocolVersion, DSRequestBody, DSResponse} from "./MIMIDSProtocol";

export enum PacketType {
    Login, // Server -> Client
    DSRequest, // Client -> Server
    DSResponse, // Server -> Client
}

export interface Packet {
    type: PacketType;
}

export interface LoginPacket extends Packet {
    type: PacketType.Login;
    userId: string;
    deviceId: string;
}

export interface DSRequestPacket extends Packet {
    type: PacketType.DSRequest;
    requestId: string; // not part of the I-D, but needed for sequencing

    groupId: string; // aka room ID

    requestBody: DSRequestBody;
    protocolVersion: DSProtocolVersion;

    // authData is a ClientSignatureTBS, using JSON
    // Unpadded base64 when defined, anonymous (no auth) when undefined.
    authData: string | undefined;
}

export interface DSResponsePacket extends Packet {
    type: PacketType.DSResponse;
    requestId: string; // not part of I-D, needed for sequencing
    responseBody: DSResponse;
}
