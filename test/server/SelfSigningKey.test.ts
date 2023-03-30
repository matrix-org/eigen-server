import {SelfSigningKey} from "../../src/server/SelfSigningKey";

describe("Keyserver", () => {
    describe("signing", () => {
        let ssk: SelfSigningKey;

        beforeEach(() => {
            ssk = new SelfSigningKey("domain");
            ssk.useKeyFromSeed("YJDBA9Xnr2sVqXD9Vj7XVUnmFZcZrlw8Md7kMW+3XA1");
        });

        it("should sign according to the spec", () => {
            function expectSignature(obj: any, signature: string) {
                const signed = ssk.signJson(obj);
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
    });
});
