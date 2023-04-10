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
    };
    signatures: {
        [domain: string]: {
            [keyId: string]: string;
        };
    };
    auth_events: string[];
    prev_events: string[];
    unsigned?: Record<string, any>;
}

export interface StateEvent extends MatrixEvent {
    state_key: string;
}

export interface ClientFriendlyMatrixEvent
    extends Omit<MatrixEvent, "hub_server" | "hashes" | "signatures" | "auth_events" | "prev_events"> {
    // no additional fields
}

export interface LinearizedPDU extends Omit<MatrixEvent, "event_id" | "auth_events" | "prev_events" | "hashes"> {
    // no additional fields
}

export interface PDU extends Omit<MatrixEvent, "event_id"> {
    // no additional fields
}

export type AnyPDU = LinearizedPDU | PDU;
