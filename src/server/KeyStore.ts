import express, {Express} from "express";
import {unpaddedBase64Decode, unpaddedBase64Encode} from "../util/b64";
import {canonicalSerialize} from "../util/canonical_json";
import * as forge from "node-forge";
import {Runtime} from "./Runtime";

export class KeyStore {
    public registerRoutes(app: Express) {
        app.get("/_matrix/key/v2/server", this.onSelfKeyRequest.bind(this));
    }

    public validateSignature(json: any, domain: string, keyId: string, keyb64: string): boolean {
        const clone = JSON.parse(JSON.stringify(json));

        const signatures = clone["signatures"];
        delete clone["signatures"];
        delete clone["unsigned"];

        if (!signatures?.[domain]?.[keyId]) {
            throw new Error(`Missing signatures from domain: ${domain} (${keyId})`);
        }
        const signature = signatures[domain][keyId] as string;
        return forge.pki.ed25519.verify({
            message: Buffer.from(canonicalSerialize(clone)),
            publicKey: unpaddedBase64Decode(keyb64),
            signature: unpaddedBase64Decode(signature),
        });
    }

    private onSelfKeyRequest(req: express.Request, res: express.Response) {
        // We probably shouldn't be generating this response *every* time
        res.json(
            Runtime.signingKey.signJson({
                old_verify_keys: {},
                server_name: Runtime.signingKey.serverName,
                valid_until_ts: new Date().getTime() + 2 * 60 * 60 * 1000,
                verify_keys: {
                    [`ed25519:${Runtime.signingKey.keyId}`]: {
                        key: unpaddedBase64Encode(Buffer.from(Runtime.signingKey.publicKey)),
                    },
                },
            }),
        );
    }
}
