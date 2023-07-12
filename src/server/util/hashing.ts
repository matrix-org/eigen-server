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
    const signatures = clone["signatures"];
    delete clone["signatures"];

    if (clone["hashes"]?.["sha256"] !== undefined) {
        clone["hashes"] = {lpdu: clone["hashes"]["lpdu"]};
    } else {
        delete clone["hashes"];
    }

    // Step 3: canonicalize
    const canonical = canonicalSerialize(clone);

    // Step 4: hash it
    const hash = createHash("sha256").update(canonical).digest();

    // Step 5: append base64'd hash and return
    clone["signatures"] = signatures;
    clone["hashes"] = {
        sha256: unpaddedBase64Encode(hash),
        lpdu: clone["hashes"]?.["lpdu"],
    };
    return clone;
}

export function calculateReferenceHash(redactedEvent: object): string {
    // Step 1: clone the thing
    const clone = JSON.parse(JSON.stringify(redactedEvent));

    // Step 2: remove fields we don't want to hash
    delete clone["signatures"];

    // Step 3: canonicalize
    const canonical = canonicalSerialize(clone);

    // Step 4: hash it
    const hash = createHash("sha256").update(canonical).digest();

    return unpaddedBase64Encode(hash, true);
}
