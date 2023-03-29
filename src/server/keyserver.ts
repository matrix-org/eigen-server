import express, {Express} from "express";
import * as fs from "fs";
import {unpaddedBase64Decode, unpaddedBase64Encode} from "../util/b64";
import {canonicalSerialize} from "../util/canonical_json";
import * as forge from "node-forge";

export class Keyserver {
    private privateKey: any;
    private publicKey: any;
    private keyId = process.env["LM_SIGNING_KEY_ID"] || "1";

    public constructor(private serverName: string) {
        const signingKeyPath = process.env["LM_SIGNING_KEY_PATH"] || "./signing.key";
        if (fs.existsSync(signingKeyPath)) {
            this.privateKey = fs.readFileSync(signingKeyPath);
            this.publicKey = forge.pki.ed25519.publicKeyFromPrivateKey({privateKey: this.privateKey});
        } else {
            const pair = forge.pki.ed25519.generateKeyPair();
            this.privateKey = pair.privateKey;
            this.publicKey = pair.publicKey;
            fs.writeFileSync(signingKeyPath, pair.privateKey);
        }
    }

    public useKeyFromSeed(b64seed: string) {
        const pair = forge.pki.ed25519.generateKeyPair({seed: unpaddedBase64Decode(b64seed)});
        this.privateKey = pair.privateKey;
        this.publicKey = pair.publicKey;
    }

    public registerRoutes(app: Express) {
        app.get("/_matrix/key/v2/server", this.onSelfKeyRequest.bind(this));
    }

    public signJson(json: any): any {
        const clone = JSON.parse(JSON.stringify(json));
        const signatures = clone["signatures"];
        const unsigned = clone["unsigned"];
        delete clone["signatures"];
        delete clone["unsigned"];
        const canonical = canonicalSerialize(clone);
        const signature = unpaddedBase64Encode(
            Buffer.from(forge.pki.ed25519.sign({message: Buffer.from(canonical), privateKey: this.privateKey})),
        );
        if (signatures !== undefined) {
            clone["signatures"] = signatures;
        }
        if (unsigned !== undefined) {
            clone["unsigned"] = unsigned;
        }
        if (!clone["signatures"]) {
            clone["signatures"] = {};
        }
        clone["signatures"][this.serverName] = {["ed25519:" + this.keyId]: signature};
        return clone;
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
            this.signJson({
                old_verify_keys: {},
                server_name: this.serverName,
                valid_until_ts: new Date().getTime() + 2 * 60 * 60 * 1000,
                verify_keys: {
                    [`ed25519:${this.keyId}`]: {
                        key: unpaddedBase64Encode(Buffer.from(this.publicKey)),
                    },
                },
            }),
        );
    }
}
