import {FederationConnectionCache, FederationUrl} from "./FederationConnectionCache";
import {LinearizedPDU, MatrixEvent, PDU} from "./models/event";
import {getRoomVersionImpl, getSupportedVersions} from "./room_versions/map";
import {calculateReferenceHash} from "./util/hashing";
import {createHash} from "crypto";
import {Runtime} from "./Runtime";
import {RoomVersion} from "./room_versions/RoomVersion";

export class FederationClient {
    private url?: FederationUrl;

    public constructor(private forDomain: string) {}

    private async getUrl(): Promise<FederationUrl> {
        if (this.url) {
            return this.url;
        }
        this.url = await FederationConnectionCache.getFederationUrl(this.forDomain);
        return this.url;
    }

    public async getSigningKeys(): Promise<{
        old_verify_keys: Record<string, string>;
        server_name: string;
        signatures: Record<string, Record<string, string>>;
        valid_until_ts: number;
        verify_keys: Record<string, {key: string}>;
    }> {
        // TODO: Support https properly - https://github.com/matrix-org/linearized-matrix/issues/14
        // TODO: Handle http errors - https://github.com/matrix-org/linearized-matrix/issues/15
        return await (await fetch(`${(await this.getUrl()).httpsUrl}/_matrix/key/v2/server`)).json();
    }

    private getAuthHeader(method: string, uri: string, content: any | undefined = undefined): string {
        const json: any = {
            method: method,
            uri: uri,
            origin: Runtime.signingKey.serverName,
            destination: this.forDomain,
        };
        if (content !== undefined) {
            json.content = content;
        }
        const signed = Runtime.signingKey.signJson(json);
        const signature = signed["signatures"][Runtime.signingKey.serverName]["ed25519:" + Runtime.signingKey.keyId];
        return `X-Matrix origin="${Runtime.signingKey.serverName}",destination="${this.forDomain}",key="ed25519:${Runtime.signingKey.keyId}",sig="${signature}"`;
    }

    public async sendInvite(event: PDU, roomVersion: string): Promise<PDU> {
        const version = getRoomVersionImpl(roomVersion)!;
        const eventId = `$${calculateReferenceHash(version.redact(event))}`;
        const path = `/_matrix/federation/v2/invite/${encodeURIComponent(event.room_id)}/${encodeURIComponent(
            eventId,
        )}`;
        const content = {event: event, room_version: roomVersion};

        const res = await fetch(`${(await this.getUrl()).httpsUrl}${path}`, {
            method: "PUT",
            body: JSON.stringify(content),
            headers: {
                "Content-Type": "application/json",
                // TODO Support multiple keys.
                Authorization: this.getAuthHeader("PUT", path, content),
            },
        });
        if (res.status !== 200) {
            throw new Error("Failed to send invite to server: " + (await res.text()));
        }
        return (await res.json()).event;
    }

    public async sendEvents(events: MatrixEvent[]): Promise<void> {
        const txnId = `${new Date().getTime()}${createHash("sha256")
            .update(events.map(e => e.event_id).join("|"))
            .digest()
            .toString("hex")}`;
        const path = `/_matrix/federation/v1/send/${encodeURIComponent(txnId)}`;
        const content = {
            pdus: events.map(e => {
                const p: PDU & {event_id?: string} = JSON.parse(JSON.stringify(e)); // clone
                delete p["event_id"];
                return p;
            }),
        };
        const res = await fetch(`${(await this.getUrl()).httpsUrl}${path}`, {
            method: "PUT",
            body: JSON.stringify(content),
            headers: {
                "Content-Type": "application/json",
                // TODO Support multiple keys.
                Authorization: this.getAuthHeader("PUT", path, content),
            },
        });
        if (res.status !== 200) {
            throw new Error("Failed to send events to server: " + (await res.text()));
        }
        await res.text(); // consume response
    }

    public async sendLinearizedPdus(events: LinearizedPDU[]): Promise<void> {
        return this.sendEvents(events as MatrixEvent[]); // yes, we cheat badly here
    }

    public async acceptInvite(inviteEvent: PDU): Promise<[PDU[], PDU]> {
        const makeJoinPath = `/_matrix/federation/v1/make_join/${encodeURIComponent(
            inviteEvent.room_id,
        )}/${encodeURIComponent(inviteEvent.state_key!)}?${getSupportedVersions()
            .map(v => `ver=${encodeURIComponent(v)}`)
            .join("&")}`;
        let res = await fetch(`${(await this.getUrl()).httpsUrl}${makeJoinPath}`, {
            method: "GET",
            headers: {
                // TODO Support multiple keys.
                Authorization: this.getAuthHeader("GET", makeJoinPath),
            },
        });
        let json = await res.json();
        const event: PDU = json.event;
        const roomVersion = json.room_version;
        const version = getRoomVersionImpl(roomVersion);
        if (!version) {
            throw new Error("Cannot accept invite: invalid room version");
        }
        if (typeof event !== "object") {
            throw new Error("Invalid response");
        }
        if (
            event.type !== "m.room.member" ||
            event.sender !== inviteEvent.state_key! ||
            event.state_key !== inviteEvent.state_key ||
            event.content["membership"] !== "join"
        ) {
            throw new Error("make_join produced invalid join event");
        }

        // create the LPDU
        event.hub_server = this.forDomain; // XXX: We're assuming they're a hub
        const lpdu = JSON.parse(JSON.stringify(event));
        delete lpdu["auth_events"];
        delete lpdu["prev_events"];
        delete lpdu["hashes"];

        // sign it
        const redacted = version.redact(lpdu);
        const redactedPdu = version.redact(event);
        const signed = Runtime.signingKey.signJson(redacted);
        const eventId = `$${calculateReferenceHash(redactedPdu)}`;

        // submit it
        const sendJoinPath = `/_matrix/federation/v2/send_join/${encodeURIComponent(
            inviteEvent.room_id,
        )}/${encodeURIComponent(eventId)}`;
        const content = {...event, signatures: signed.signatures};
        res = await fetch(`${(await this.getUrl()).httpsUrl}${sendJoinPath}`, {
            method: "PUT",
            body: JSON.stringify(content),
            headers: {
                "Content-Type": "application/json",
                // TODO Support multiple keys.
                Authorization: this.getAuthHeader("PUT", sendJoinPath, content),
            },
        });
        json = await res.json();
        const finalEvent = json["event"] ?? event;
        const stateBefore = json["state"];
        // TODO: We assume stateBefore is ordered
        // https://github.com/matrix-org/linearized-matrix/issues/27
        return [stateBefore, finalEvent];
    }

    public async getEvent(eventId: string, roomVersion: RoomVersion): Promise<MatrixEvent> {
        const requestPath = `/_matrix/federation/v1/event/${encodeURIComponent(eventId)}`;
        const res = await fetch(`${(await this.getUrl()).httpsUrl}${requestPath}`, {
            method: "GET",
            headers: {
                // TODO Support multiple keys.
                Authorization: this.getAuthHeader("GET", requestPath),
            },
        });
        const json = await res.json();
        if (!!json["errcode"]) {
            // TODO: Raise a better error
            throw new Error(JSON.stringify(json));
        }

        const pdu: PDU = json["pdus"][0]; // it's a transaction response for some reason
        const redacted = roomVersion.redact(pdu);
        const actualEventId = `$${calculateReferenceHash(redacted)}`;
        if (actualEventId !== eventId) {
            throw new Error(`Server returned ${actualEventId} when we were expecting ${eventId}`);
        }

        return {...pdu, event_id: actualEventId};
    }
}
