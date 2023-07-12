// XXX: Arguably this definition should be part of the room version for format reasons
export interface MatrixEvent {
    event_id: string;
    room_id: string;
    type: string;
    state_key?: string | undefined;
    sender: string;
    origin_server_ts: number;
    hub_server?: string;
    content: Record<string, any>;
    hashes: {
        sha256: string;
        lpdu?: {
            sha256: string;
        };
    };
    signatures: {
        [domain: string]: {
            [keyId: string]: string;
        };
    };
    auth_events: string[];
    prev_events: string[];
}

export interface StateEvent extends MatrixEvent {
    state_key: string;
}

export interface ClientFriendlyMatrixEvent
    extends Omit<MatrixEvent, "hub_server" | "hashes" | "signatures" | "auth_events" | "prev_events"> {
    // no additional fields
}

export interface LinearizedPDU extends Omit<MatrixEvent, "event_id" | "auth_events" | "prev_events" | "hashes"> {
    hashes: {
        lpdu: {
            sha256: string;
        };
    };
}

export interface PDU extends Omit<MatrixEvent, "event_id"> {
    // no additional fields
}

export type AnyPDU = LinearizedPDU | PDU;

export type InterstitialLPDU = LinearizedPDU & Partial<Exclude<Omit<PDU, "hashes">, keyof LinearizedPDU>>;

export interface StrippedRoomEvent {
    type: string;
    sender: string;
    content: Record<string, any>;
    state_key?: string;
}

export interface StrippedStateEvent extends StrippedRoomEvent {
    state_key: string;
}
