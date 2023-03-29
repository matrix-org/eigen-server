import {Keyserver} from "../../src/server/keyserver";

describe("Keyserver", () => {
    describe("signing", () => {
        let keyserver: Keyserver;

        beforeEach(() => {
            keyserver = new Keyserver("domain");
            keyserver.useKeyFromSeed("YJDBA9Xnr2sVqXD9Vj7XVUnmFZcZrlw8Md7kMW+3XA1");
        });

        it("should sign according to the spec", () => {
            function expectSignature(obj: any, signature: string) {
                const signed = keyserver.signJson(obj);
                expect(signed.signatures["domain"]["ed25519:1"]).toBe(signature);
                expect(signed).toMatchObject(obj);
            }

            expectSignature(
                {},
                "K8280/U9SSy9IVtjBuVeLr+HpOB4BQFWbg+UZaADMtTdGYI7Geitb76LTrr5QV/7Xg4ahLwYGYZzuHGZKM5ZAQ",
            );
            expectSignature(
                {
                    one: 1,
                    two: "Two",
                },
                "KqmLSbO39/Bzb0QIYE82zqLwsA+PDzYIpIRA2sRQ4sL53+sN6/fpNSoqE7BP7vBZhG6kYdD13EIMJpvhJI+6Bw",
            );
        });

        it("should verify signatures", () => {
            expect(
                keyserver.validateSignature(
                    {
                        old_verify_keys: {},
                        server_name: "localhost",
                        signatures: {
                            localhost: {
                                "ed25519:a_nZvP":
                                    "CbY2mXwsGodsukBEKKNpEfPYvSjRGQBT4mRTMjhhncHMS3j2smJ3k7iDUozptKEcmj+5/OUs8W6bkDVkxSuEAg",
                            },
                        },
                        valid_until_ts: 1680137146829,
                        verify_keys: {"ed25519:a_nZvP": {key: "yQu5j901mUG/Osohy9xFiyWXqX9lr4MgqCr8lLrfxlY"}},
                    },
                    "localhost",
                    "ed25519:a_nZvP",
                    "yQu5j901mUG/Osohy9xFiyWXqX9lr4MgqCr8lLrfxlY",
                ),
            ).toBe(true);
        });
    });
});
