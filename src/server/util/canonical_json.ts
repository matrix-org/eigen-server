import canonicalize from "canonicalize";

export function canonicalSerialize(obj: any): string {
    // XXX: This is not actually the same as our Canonical JSON spec.
    return <string>canonicalize(obj);
}
