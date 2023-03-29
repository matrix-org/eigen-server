export function unpaddedBase64Encode(data: Buffer, urlSafe = false): string {
    const str = data.toString("base64").replace(/=*$/g, "");
    if (urlSafe) {
        return str.replace(/\+/g, "-").replace(/\//g, "_");
    }
    return str;
}

export function unpaddedBase64Decode(str: string, urlSafe = false): Buffer {
    if (urlSafe) {
        str = str.replace(/-/g, "+").replace(/_/g, "/");
    }
    return Buffer.from(str, "base64");
}
