import {KeyStore} from "../../src/server/KeyStore";

describe("Keyserver", () => {
    describe("signing", () => {
        let keyStore: KeyStore;

        beforeEach(() => {
            keyStore = new KeyStore();
        });

        it("should verify signatures", () => {
            expect(
                keyStore.validateSignature(
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
