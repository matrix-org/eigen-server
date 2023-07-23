import WebSocket from "ws";
import {DSRequestPacket, DSResponsePacket, Packet, PacketType} from "../server/client_server_api/packets";
import {DSResponse} from "../server/client_server_api/MIMIDSProtocol";

export let ws: WebSocket;

export function setupWs() {
    ws = new WebSocket(
        `ws://${process.env["ES_HOSTNAME"] || "localhost"}:${
            process.env["ES_PORT"] ?? 3000
        }/client?preferredLocalpart=${encodeURIComponent(process.env["ES_LOCALPART"] ?? "")}`,
    );
}

export function wsSend(payload: any) {
    ws.send(JSON.stringify(payload));
}

export function wsSendDsRequest<T extends DSResponse>(request: DSRequestPacket): Promise<T> {
    return new Promise<T>(resolve => {
        const listenForMyRequest = (data: WebSocket.RawData) => {
            const packet = JSON.parse(data as unknown as string) as Packet;
            if (packet.type === PacketType.DSResponse) {
                const dsResponse = packet as DSResponsePacket;
                if (dsResponse.requestId === request.requestId) {
                    ws.off("message", listenForMyRequest);
                    resolve(dsResponse.responseBody as T);
                }
            }
        };
        ws.on("message", listenForMyRequest);
        wsSend(request);
    });
}
