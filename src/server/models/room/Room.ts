import {ClientFriendlyMatrixEvent, LinearizedPDU, MatrixEvent} from "../event";

export interface Room {
    readonly version: string;
    readonly roomId: string;
    readonly hubDomain: string;
    readonly joinedUserIds: string[];
    sendEvent(event: LinearizedPDU): Promise<void>;
    createEvent(partial: Omit<ClientFriendlyMatrixEvent, "room_id" | "origin_server_ts" | "event_id">): LinearizedPDU;
    doJoin(userId: string): Promise<void>;
    doInvite(senderUserId: string, targetUserId: string): Promise<void>;

    // Event handlers
    on(event: "event", fn: (event: MatrixEvent) => void): void;
    off(event: "event", fn: (event: MatrixEvent) => void): void;
}
