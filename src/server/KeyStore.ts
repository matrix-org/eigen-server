import express, {Express} from "express";
import {unpaddedBase64Decode, unpaddedBase64Encode} from "./util/b64";
import {canonicalSerialize} from "./util/canonical_json";
import * as forge from "node-forge";
import {Runtime} from "./Runtime";
import {FederationClient} from "./FederationClient";

type ServerKeys = {
    expiresAt: number;
    verifyKeys: Record<string, string>;
    // TODO: We should probably support old_verify_keys too
    // https://github.com/matrix-org/linearized-matrix/issues/12
};

export class KeyStore {
    private cachedKeys = new Map<string, ServerKeys>();

    public registerRoutes(app: Express) {
        app.get("/_matrix/key/v2/server", this.onSelfKeyRequest.bind(this));
    }

    private async getServerKeys(domain: string): Promise<ServerKeys> {
        if (domain === Runtime.signingKey.serverName) {
            return {
                expiresAt: 0,
                verifyKeys: {
                    [`ed25519:${Runtime.signingKey.keyId}`]: unpaddedBase64Encode(
                        Buffer.from(Runtime.signingKey.publicKey),
                    ),
                },
            };
        }
        if (this.cachedKeys.has(domain)) {
            const keys = this.cachedKeys.get(domain)!;
            if (new Date().getTime() >= keys.expiresAt) {
                this.cachedKeys.delete(domain);
            } else {
                return keys;
            }
        }

        const res = await new FederationClient(domain).getSigningKeys();

        // validate the returned keys
        if (res.server_name !== domain) {
            throw new Error("Failed key verification check: returned server is different than the one we requested");
        }
        for (const [keyId, obj] of Object.entries(res.verify_keys)) {
            if (!this.validateSignature(res, domain, keyId, obj.key)) {
                throw new Error(`Failed to validate key signature for "${keyId}"`);
            }
        }

        // cache & return
        const keys: ServerKeys = {
            expiresAt: Math.min(res.valid_until_ts, new Date().getTime() + 60 * 60 * 1000),
            verifyKeys: Object.fromEntries(Array.from(Object.entries(res.verify_keys)).map(e => [e[0], e[1].key])),
        };
        this.cachedKeys.set(domain, keys);
        return keys;
    }

    public async validateDomainSignature(json: any, domain: string): Promise<boolean> {
        const keys = await this.getServerKeys(domain);
        const signatures = json["signatures"]?.[domain];
        if (!signatures || typeof signatures !== "object") {
            throw new Error(`Missing valid signatures field for domain: ${domain}`);
        }
        if (!Object.keys(signatures).length) {
            throw new Error(`No signatures for ${domain}`);
        }
        for (const keyId of Object.keys(signatures)) {
            if (!keys.verifyKeys[keyId]) {
                throw new Error(`Unknown key ID ${keyId} for ${domain}`);
            }
            if (!this.validateSignature(json, domain, keyId, keys.verifyKeys[keyId])) {
                return false;
            }
        }

        return true;
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
                "m.linearized": true,
                verify_keys: {
                    [`ed25519:${Runtime.signingKey.keyId}`]: {
                        key: unpaddedBase64Encode(Buffer.from(Runtime.signingKey.publicKey)),
                    },
                },
            }),
        );
    }
}
