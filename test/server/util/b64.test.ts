import {unpaddedBase64Decode, unpaddedBase64Encode} from "../../../src/server/util/b64";
import {Buffer} from "buffer";

describe("unpaddedBase64Encode", () => {
    it("should encode per spec", () => {
        expect(unpaddedBase64Encode(Buffer.from(""))).toBe("");
        expect(unpaddedBase64Encode(Buffer.from("f"))).toBe("Zg");
        expect(unpaddedBase64Encode(Buffer.from("fo"))).toBe("Zm8");
        expect(unpaddedBase64Encode(Buffer.from("foo"))).toBe("Zm9v");
        expect(unpaddedBase64Encode(Buffer.from("foob"))).toBe("Zm9vYg");
        expect(unpaddedBase64Encode(Buffer.from("fooba"))).toBe("Zm9vYmE");
        expect(unpaddedBase64Encode(Buffer.from("foobar"))).toBe("Zm9vYmFy");
    });
    it("should result in URL-safe strings", () => {
        expect(unpaddedBase64Encode(Buffer.from("😀🍕🍔🍟🌭"))).toBe("8J+YgPCfjZXwn42U8J+Nn/CfjK0");
        expect(unpaddedBase64Encode(Buffer.from("😀🍕🍔🍟🌭"), true)).toBe("8J-YgPCfjZXwn42U8J-Nn_CfjK0");
    });
});

describe("unpaddedBase64Decode", () => {
    it("should decode per spec", () => {
        expect(unpaddedBase64Decode("").toString("utf-8")).toBe("");
        expect(unpaddedBase64Decode("Zg").toString("utf-8")).toBe("f");
        expect(unpaddedBase64Decode("Zm8").toString("utf-8")).toBe("fo");
        expect(unpaddedBase64Decode("Zm9v").toString("utf-8")).toBe("foo");
        expect(unpaddedBase64Decode("Zm9vYg").toString("utf-8")).toBe("foob");
        expect(unpaddedBase64Decode("Zm9vYmE").toString("utf-8")).toBe("fooba");
        expect(unpaddedBase64Decode("Zm9vYmFy").toString("utf-8")).toBe("foobar");
    });
    it("should decode URL-safe strings", () => {
        expect(unpaddedBase64Decode("8J+YgPCfjZXwn42U8J+Nn/CfjK0").toString("utf-8")).toBe("😀🍕🍔🍟🌭");
        expect(unpaddedBase64Decode("8J-YgPCfjZXwn42U8J-Nn_CfjK0", true).toString("utf-8")).toBe("😀🍕🍔🍟🌭");
    });
    it("should accept base64 with padding", () => {
        expect(unpaddedBase64Decode("Zg==").toString("utf-8")).toBe("f");
    });
});
