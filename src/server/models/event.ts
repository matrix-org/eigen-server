export interface MatrixEvent {
    room_id: string;
    type: string;
    state_key?: string | undefined;
    sender: string;
    origin_server_ts: number;
    owner_server?: string;
    delegated_server?: string;
    content: Record<string, any>;
    hashes: {
        sha256: string;
    };
    signatures: {
        [domain: string]: {
            [keyId: string]: string;
        };
    };
}

export interface StateEvent extends MatrixEvent {
    state_key: string;
}

export interface ClientFriendlyMatrixEvent
    extends Omit<MatrixEvent, "delegated_server" | "owner_server" | "hashes" | "signatures"> {
    // event_id: string; // normally we'd have this here, but we don't use it on our CS API example
}

export interface V4PDU extends MatrixEvent {
    auth_events: string[];
    depth: number;
    prev_events: string[];
}
