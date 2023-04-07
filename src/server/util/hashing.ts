import {LinearizedPDU, PDU} from "../models/event";
import {canonicalSerialize} from "./canonical_json";
import {createHash} from "crypto";
import {unpaddedBase64Encode} from "./b64";

export function calculateContentHash(
    event: Omit<LinearizedPDU, "hashes" | "signatures">,
): Omit<PDU, "auth_events" | "prev_events" | "signatures">;
export function calculateContentHash(event: Omit<PDU, "hashes" | "signatures">): Omit<PDU, "signatures">;
export function calculateContentHash(
    event: Omit<LinearizedPDU | PDU, "hashes" | "signatures">,
): Omit<LinearizedPDU | PDU, "signatures"> {
    // Step 1: clone the thing
    const clone = JSON.parse(JSON.stringify(event));

    // Step 2: remove fields we don't want to hash
    const unsigned = clone["unsigned"];
    const signatures = clone["signatures"];
    delete clone["unsigned"];
    delete clone["signatures"];
    delete clone["hashes"];

    // Step 3: canonicalize
    const canonical = canonicalSerialize(clone);

    // Step 4: hash it
    const hash = createHash("sha256").update(canonical).digest();

    // Step 5: append base64'd hash and return
    clone["unsigned"] = unsigned;
    clone["signatures"] = signatures;
    clone["hashes"] = {
        sha256: unpaddedBase64Encode(hash),
    };
    return clone;
}

export function calculateReferenceHash(redactedEvent: object): string {
    // Step 1: clone the thing
    const clone = JSON.parse(JSON.stringify(redactedEvent));

    // Step 2: remove fields we don't want to hash
    delete clone["unsigned"];
    delete clone["signatures"];
    delete clone["age_ts"]; // https://github.com/matrix-org/matrix-spec/issues/1489

    // Step 3: canonicalize
    const canonical = canonicalSerialize(clone);

    // Step 4: hash it
    const hash = createHash("sha256").update(canonical).digest();

    // Turn into a web-safe base 64.
    return unpaddedBase64Encode(hash).replace(/\+/g, "-").replace(/\//g, "_");
}
