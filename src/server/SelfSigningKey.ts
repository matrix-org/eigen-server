import fs from "fs";
import forge from "node-forge";
import {unpaddedBase64Decode, unpaddedBase64Encode} from "./util/b64";
import {canonicalSerialize} from "./util/canonical_json";

export class SelfSigningKey {
    private privateKey: forge.pki.ed25519.NativeBuffer;
    private internalPublicKey: forge.pki.ed25519.NativeBuffer;
    public readonly keyId = process.env["ES_SIGNING_KEY_ID"] || "1";

    public constructor(public readonly serverName: string) {
        const signingKeyPath = process.env["ES_SIGNING_KEY_PATH"] || "./signing.key";
        if (fs.existsSync(signingKeyPath)) {
            this.privateKey = fs.readFileSync(signingKeyPath);
            this.internalPublicKey = forge.pki.ed25519.publicKeyFromPrivateKey({privateKey: this.privateKey});
        } else {
            const pair = forge.pki.ed25519.generateKeyPair();
            this.privateKey = pair.privateKey;
            this.internalPublicKey = pair.publicKey;
            fs.writeFileSync(signingKeyPath, pair.privateKey);
        }
    }

    public get publicKey(): forge.pki.ed25519.NativeBuffer {
        return this.internalPublicKey;
    }

    public useKeyFromSeed(b64seed: string) {
        const pair = forge.pki.ed25519.generateKeyPair({seed: unpaddedBase64Decode(b64seed)});
        this.privateKey = pair.privateKey;
        this.internalPublicKey = pair.publicKey;
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
}
